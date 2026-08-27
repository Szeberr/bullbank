import { Lock, LockOpen, Loader2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { TickingAmount } from "./HeroBalance";
import { formatUnits, formatDuration, formatDateTime } from "../lib/format";
import { tierByIndex } from "../solana/config";
import {
  claimable,
  currentApr,
  isUnlocked,
  type PoolState,
} from "../solana/accrual";
import type { AccountPosition } from "../hooks/useChainState";
import type { TxState } from "../hooks/useActions";
import { cn } from "../lib/utils";

const TIER_STYLE: Record<number, string> = {
  0: "border-line-strong text-ink-muted",
  1: "border-line-strong text-ink",
  2: "border-accent-dim/50 text-accent/90",
  3: "border-accent/60 text-accent bg-accent/5",
};

function TermProgress({
  unlockTime,
  termDays,
  nowSec,
}: {
  unlockTime: bigint;
  termDays: number;
  nowSec: bigint;
}) {
  const termSecs = BigInt(termDays * 86400);
  const startedAt = unlockTime - termSecs;
  const elapsed = nowSec - startedAt;
  const pct = Number((elapsed * 100n) / termSecs);
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div className="mt-3">
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-[width] duration-1000"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function AccountCard({
  position,
  pool,
  nowSec,
  tx,
  onSettle,
  onWithdraw,
}: {
  position: AccountPosition;
  pool: PoolState;
  nowSec: bigint;
  tx: TxState;
  onSettle: () => void;
  onWithdraw: () => void;
}) {
  const tier = tierByIndex(position.tier);
  const pending = claimable(pool, position, nowSec);
  const apr = currentApr(pool, position, nowSec);
  const unlocked = isUnlocked(position, nowSec);
  const remaining = position.unlockTime > nowSec ? position.unlockTime - nowSec : 0n;

  const busy = tx.stage === "signing" || tx.stage === "confirming";

  return (
    <div className="animate-rise rounded-xl border border-line bg-surface-2/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
              TIER_STYLE[position.tier]
            )}
          >
            {tier.name}
          </span>
          <span className="text-[11px] text-ink-faint">
            {tier.days}-day term · {tier.multiplier.toFixed(1)}× weight
          </span>
        </div>

        <div
          className={cn(
            "flex items-center gap-1 text-[11px]",
            unlocked ? "text-gain" : "text-ink-faint"
          )}
        >
          {unlocked ? <LockOpen size={11} /> : <Lock size={11} />}
          {unlocked ? "Unlocked" : formatDuration(remaining)}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            Principal
          </div>
          <div className="tnum mt-1 text-sm font-semibold text-ink">
            {formatUnits(position.balance, { decimals: 2 })}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            Accrued
          </div>
          <div className="mt-1">
            <TickingAmount base={pending} decimals={6} size="sm" />
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            Rate
          </div>
          <div className="tnum mt-1 text-sm font-semibold text-gain">
            {apr === null ? (
              <span className="text-ink-muted">—</span>
            ) : (
              `${apr.toFixed(1)}%`
            )}
          </div>
        </div>
      </div>

      <TermProgress
        unlockTime={position.unlockTime}
        termDays={tier.days}
        nowSec={nowSec}
      />

      <div className="mt-2 text-[10px] text-ink-faint">
        {unlocked
          ? "Term complete — principal available"
          : `Term ends ${formatDateTime(position.unlockTime)}`}
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={pending === 0n || busy}
          onClick={onSettle}
        >
          {busy && tx.kind === "settle" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : null}
          Settle {pending > 0n ? formatUnits(pending, { decimals: 4 }) : ""}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!unlocked || busy}
          onClick={onWithdraw}
          title={unlocked ? "Withdraw principal" : "Locked until the term ends"}
        >
          Withdraw
        </Button>
      </div>
    </div>
  );
}

export function AccountsPanel({
  positions,
  pool,
  nowSec,
  tx,
  onSettle,
  onWithdraw,
}: {
  positions: AccountPosition[];
  pool: PoolState | null;
  nowSec: bigint;
  tx: TxState;
  onSettle: (tier: number) => void;
  onWithdraw: (tier: number, amount: bigint) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Locked positions</CardTitle>
        <span className="text-[11px] text-ink-faint">
          {positions.length} of 3
        </span>
      </CardHeader>
      <CardBody className="space-y-3">
        {!pool || positions.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-sm text-ink-muted">Nothing locked</div>
            <div className="mt-1 text-xs text-ink-faint">
              Locking is optional — it earns more than holding, but you cannot
              withdraw until the term ends.
            </div>
          </div>
        ) : (
          positions
            .slice()
            .filter((p) => p.tier !== 0)
            .sort((a, b) => a.tier - b.tier)
            .map((p) => (
              <AccountCard
                key={p.tier}
                position={p}
                pool={pool}
                nowSec={nowSec}
                tx={tx}
                onSettle={() => onSettle(p.tier)}
                onWithdraw={() => onWithdraw(p.tier, p.balance)}
              />
            ))
        )}
      </CardBody>
    </Card>
  );
}
