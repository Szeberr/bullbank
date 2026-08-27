import { useMemo, useState } from "react";
import { Loader2, Info } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { formatUnits, toBaseUnits } from "../lib/format";
import { TIERS, TOKEN_SYMBOL } from "../solana/config";
import { previewRatePerSecond, type PoolState } from "../solana/accrual";
import type { AccountPosition } from "../hooks/useChainState";
import type { TxState } from "../hooks/useActions";
import { cn } from "../lib/utils";

export function OpenAccount({
  pool,
  positions,
  walletBalance,
  nowSec,
  tx,
  connected,
  onDeposit,
}: {
  pool: PoolState | null;
  positions: AccountPosition[];
  walletBalance: bigint | null;
  nowSec: bigint;
  tx: TxState;
  connected: boolean;
  onDeposit: (tier: number, base: bigint) => void;
}) {
  const [tier, setTier] = useState<number>(3);
  const [amount, setAmount] = useState("");
  // Locking is irreversible for up to 60 days. A single click is far too little
  // friction for that — during devnet testing a whole balance went into a 60-day
  // term by accident, which on mainnet would be unrecoverable.
  const [acknowledged, setAcknowledged] = useState(false);

  const base = useMemo(() => toBaseUnits(amount), [amount]);
  const existing = positions.find((p) => p.tier === tier);

  const perDay = useMemo(() => {
    if (!pool || base <= 0n) return 0n;
    return previewRatePerSecond(pool, base, tier, nowSec) * 86_400n;
  }, [pool, base, tier, nowSec]);

  const overBalance = walletBalance !== null && base > walletBalance;
  const busy = tx.stage === "signing" || tx.stage === "confirming";
  const canSubmit =
    connected && base > 0n && !overBalance && !busy && !!pool && acknowledged;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open an account</CardTitle>
        {walletBalance !== null && (
          <span className="tnum text-[11px] text-ink-faint">
            Wallet: {formatUnits(walletBalance, { decimals: 2 })} {TOKEN_SYMBOL}
          </span>
        )}
      </CardHeader>

      <CardBody>
        <div className="grid grid-cols-2 gap-2">
          {TIERS.map((t) => {
            const active = t.tier === tier;
            return (
              <button
                key={t.tier}
                onClick={() => {
                  setTier(t.tier);
                  setAcknowledged(false);
                }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-all duration-150",
                  active
                    ? "border-accent/60 bg-accent/[0.07] shadow-[0_0_28px_-14px_rgba(124,232,31,0.7)]"
                    : "border-line bg-surface-2/40 hover:border-line-strong hover:bg-surface-2"
                )}
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className={cn(
                      "text-xs font-semibold uppercase tracking-[0.1em]",
                      active ? "text-accent" : "text-ink"
                    )}
                  >
                    {t.name}
                  </span>
                  <span className="tnum text-[11px] font-medium text-ink-muted">
                    {t.multiplier.toFixed(1)}×
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-ink-faint">
                  {t.days}-day term
                </div>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          {TIERS[tier].blurb}
        </p>

        <div className="mt-5">
          <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            Amount
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-ground px-3 focus-within:border-accent-dim/70">
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
              }}
              className="tnum h-12 flex-1 bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-ink-faint/60"
            />
            <span className="text-sm font-medium text-ink-muted">
              {TOKEN_SYMBOL}
            </span>
            {walletBalance !== null && walletBalance > 0n && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setAmount(formatUnits(walletBalance, { decimals: 6, group: false }))
                }
              >
                Max
              </Button>
            )}
          </div>
          {overBalance && (
            <div className="mt-2 text-[11px] text-loss">
              Exceeds your wallet balance.
            </div>
          )}
        </div>

        {base > 0n && pool && (
          <div className="mt-4 rounded-lg border border-line bg-surface-2/40 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-faint">Projected accrual</span>
              <span className="tnum font-semibold text-gain">
                +{formatUnits(perDay, { decimals: 4 })} {TOKEN_SYMBOL}/day
              </span>
            </div>
            <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-faint">
              <Info size={11} className="mt-px shrink-0" />
              <span>
                Includes the dilution your own deposit causes. Changes as others
                open or close accounts.
              </span>
            </div>
          </div>
        )}

        {existing && (
          <div className="mt-4 rounded-lg border border-accent-dim/30 bg-accent/[0.04] p-3 text-[11px] leading-relaxed text-ink-muted">
            You already hold a {TIERS[tier].name} account. Depositing again adds to
            it and <span className="text-accent">restarts the full {TIERS[tier].days}-day
            term</span> on the combined balance.
          </div>
        )}

        {/*
          The irreversibility gate. Deliberately a deliberate action rather than
          fine print: locking cannot be undone by us, by support, or by the
          program itself, and the amount is restated here so nobody confirms a
          figure they have not re-read.
        */}
        <label
          className={cn(
            "mt-5 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
            acknowledged
              ? "border-accent-dim/50 bg-accent/[0.05]"
              : "border-line-strong bg-surface-2/40 hover:border-line-strong"
          )}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#7ce81f]"
          />
          <span className="text-[11px] leading-relaxed text-ink-muted">
            I understand{" "}
            <span className="text-ink">
              {base > 0n ? formatUnits(base, { decimals: 2 }) : "these"}{" "}
              {TOKEN_SYMBOL}
            </span>{" "}
            will be locked for{" "}
            <span className="text-ink">{TIERS[tier].days} days</span> and{" "}
            <span className="text-accent">cannot be withdrawn early</span> for any
            reason.
          </span>
        </label>

        <Button
          variant="primary"
          size="lg"
          className="mt-3 w-full"
          disabled={!canSubmit}
          onClick={() => onDeposit(tier, base)}
        >
          {busy && tx.kind === "deposit" ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              {tx.stage === "signing" ? "Approve in wallet…" : "Confirming…"}
            </>
          ) : connected ? (
            `Deposit to ${TIERS[tier].name}`
          ) : (
            "Connect a wallet"
          )}
        </Button>

        <p className="mt-3 text-center text-[10px] leading-relaxed text-ink-faint">
          Principal is locked for the full term. There is no early withdrawal.
        </p>
      </CardBody>
    </Card>
  );
}
