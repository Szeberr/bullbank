import { RefreshCw, Check, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { TickingAmount } from "./HeroBalance";
import { formatUnits } from "../lib/format";
import { TOKEN_SYMBOL } from "../solana/config";
import { claimable, type PoolState } from "../solana/accrual";
import type { AccountPosition } from "../hooks/useChainState";
import type { TxState } from "../hooks/useActions";

/**
 * The hold position — the primary surface of the product.
 *
 * Its whole job is making the registered figure and the wallet figure visible
 * side by side, because the gap between them is the one thing a holder can get
 * wrong. Buy more and forget to sync, and the extra earns nothing; sell and
 * forget, and the payout silently drops to the smaller number. Both cases are
 * called out explicitly rather than left for someone to discover from a
 * disappointing claim.
 */
export function HoldingPanel({
  position,
  pool,
  walletBalance,
  nowSec,
  tx,
  onSync,
  onClaim,
}: {
  position: AccountPosition | undefined;
  pool: PoolState | null;
  walletBalance: bigint | null;
  nowSec: bigint;
  tx: TxState;
  onSync: () => void;
  onClaim: () => void;
}) {
  const busy = tx.stage === "signing" || tx.stage === "confirming";
  const registered = position?.weight ?? 0n;
  const wallet = walletBalance ?? 0n;
  const pending = pool && position ? claimable(pool, position, nowSec) : 0n;

  const notSynced = !position || registered === 0n;
  const outOfDate = !notSynced && wallet !== registered;
  const soldDown = outOfDate && wallet < registered;

  return (
    <Card glow={notSynced}>
      <CardHeader>
        <CardTitle>Your holding</CardTitle>
        {!notSynced && !outOfDate && (
          <span className="flex items-center gap-1.5 text-[11px] text-gain">
            <Check size={12} />
            In sync
          </span>
        )}
      </CardHeader>

      <CardBody>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              In your wallet
            </div>
            <div className="tnum mt-1.5 text-xl font-semibold text-ink">
              {formatUnits(wallet, { decimals: 2 })}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              Earning on
            </div>
            <div className="tnum mt-1.5 text-xl font-semibold text-ink">
              {formatUnits(registered, { decimals: 2 })}
            </div>
          </div>
        </div>

        {!notSynced && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              Earned so far
            </div>
            <div className="mt-1">
              <TickingAmount base={pending} decimals={6} size="md" />
              <span className="ml-1.5 text-sm text-ink-muted">{TOKEN_SYMBOL}</span>
            </div>
          </div>
        )}

        {notSynced ? (
          <p className="mt-5 text-[13px] leading-relaxed text-ink-muted">
            Your {TOKEN_SYMBOL} isn't earning yet. Hit sync to register what you
            hold — it stays in your wallet, nothing gets sent anywhere.
          </p>
        ) : outOfDate ? (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-accent-dim/40 bg-accent/[0.06] p-3">
            <AlertCircle size={13} className="mt-px shrink-0 text-accent" />
            <p className="text-[12px] leading-relaxed text-ink-muted">
              {soldDown ? (
                <>
                  You hold less than you registered, so you're now being paid on{" "}
                  <span className="text-ink">
                    {formatUnits(wallet, { decimals: 2 })}
                  </span>
                  , not {formatUnits(registered, { decimals: 2 })}. Sync to tidy
                  this up.
                </>
              ) : (
                <>
                  You've bought more since last syncing.{" "}
                  <span className="text-ink">
                    {formatUnits(wallet - registered, { decimals: 2 })}{" "}
                    {TOKEN_SYMBOL}
                  </span>{" "}
                  isn't earning yet — sync to include it.
                </>
              )}
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            disabled={busy || wallet === 0n}
            onClick={onSync}
          >
            {busy && tx.kind === "sync" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {notSynced ? "Start earning" : "Sync"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending === 0n || busy}
            onClick={onClaim}
          >
            {busy && tx.kind === "settle" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            Claim
          </Button>
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
          Syncing never moves your {TOKEN_SYMBOL}. It only tells the contract what
          you hold, and costs a small network fee in SOL.
        </p>
      </CardBody>
    </Card>
  );
}
