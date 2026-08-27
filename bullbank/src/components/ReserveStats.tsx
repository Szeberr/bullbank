import { ExternalLink, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, Stat } from "./ui/card";
import { formatCompact, formatUnits, formatDuration } from "../lib/format";
import { EXPLORER_ACCOUNT, TOKEN_SYMBOL, ADDRESSES, LAUNCHED } from "../solana/config";
import { scheduleRemaining, type PoolState } from "../solana/accrual";
import { shortAddress } from "../lib/format";

/**
 * The reserve panel. Everything here is read from chain, and it exists to make
 * the mechanism inspectable rather than to advertise: emission rate, how much is
 * left, how long it runs. A user should be able to check that the number in the
 * hero is consistent with the schedule the program is actually running.
 */
export function ReserveStats({
  pool,
  reserveBalance,
  nowSec,
}: {
  pool: PoolState | null;
  reserveBalance: bigint | null;
  nowSec: bigint;
}) {
  if (!pool) return null;

  if (!LAUNCHED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>The reserve</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center">
            <div className="text-sm font-medium text-ink-muted">Not funded yet</div>
            <div className="mt-1 text-[11px] leading-relaxed text-ink-faint">
              The reserve is created and funded at launch. Once it is live, the
              emission rate, the balance remaining and how long it runs will all
              be shown here and verifiable on-chain.
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  const perDay = pool.rewardRatePerSec * 86_400n;
  const remaining = scheduleRemaining(pool, nowSec);
  const over = remaining === 0n;

  return (
    <Card>
      <CardHeader>
        <CardTitle>The reserve</CardTitle>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          <ShieldCheck size={12} className="text-accent/70" />
          No withdrawal path
        </span>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-5">
          <Stat
            label="Emission rate"
            value={
              <span className="tnum">
                {formatUnits(perDay, { decimals: 0 })}
                <span className="ml-1 text-xs font-normal text-ink-faint">
                  {TOKEN_SYMBOL}/day
                </span>
              </span>
            }
            sub="Fixed permanently at launch"
          />
          <Stat
            label="Schedule left"
            value={over ? "Ended" : formatDuration(remaining)}
            sub={over ? "Emissions complete" : "Until the reserve is exhausted"}
            align="right"
          />
          <Stat
            label="Reserve balance"
            value={
              reserveBalance === null ? "—" : formatCompact(reserveBalance)
            }
            sub="Left to pay out"
          />
          <Stat
            label="Total earning"
            value={formatCompact(pool.totalWeighted)}
            sub="Registered across all holders"
            align="right"
          />
        </div>

        <div className="mt-5 space-y-2 border-t border-line pt-4 text-[11px]">
          <p className="leading-relaxed text-ink-faint">
            Every payout is split across all registered holders by weight.
            Locking earns more per token than holding, so it takes a bigger slice
            of the same fixed emission — the rate itself never goes up.
          </p>
          {ADDRESSES.poolPda && (
            <a
              href={EXPLORER_ACCOUNT(ADDRESSES.poolPda.toBase58())}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-ink-muted transition-colors hover:text-accent"
            >
              {shortAddress(ADDRESSES.poolPda.toBase58(), 6)}
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
