import { useMemo, useState } from "react";
import { Calculator as CalcIcon, TrendingUp, Users, Info } from "lucide-react";
import { Card, CardBody } from "./ui/card";
import {
  TIERS,
  TOKEN_SYMBOL,
  TOTAL_SUPPLY,
  LAUNCHED,
  AIRDROP_PERCENT,
} from "../solana/config";
import { TIER_MULT_BPS, BPS_DENOM, type PoolState } from "../solana/accrual";
import { toBaseUnits, formatUnits, formatCompact } from "../lib/format";
import { cn } from "../lib/utils";

/**
 * Reward calculator.
 *
 * The single most important thing this page does is make the dilution visible.
 * Every "APY calculator" in this corner of crypto quotes a rate as though it
 * were a property of your wallet; here it is a property of how many other people
 * showed up, because the reserve pays a fixed amount per day and splits it. So
 * "how much is synced" is a first-class input with a slider, not a footnote —
 * moving it is the whole lesson.
 *
 * It is also arithmetic, not a forecast. The numbers are exactly what the
 * program would pay given the assumptions on screen, and the page says so
 * rather than dressing them up as a projection.
 *
 * Pre-launch the daily payout is an input, because the emission rate genuinely
 * has not been chosen yet. Once live it is read from the chain and locked.
 */

const DAY = 86_400n;

/**
 * Log-scaled slider: 1M .. total supply. Linear would spend nearly the whole
 * track above 100M, which is the range that matters least to a reader.
 */
const MIN_SYNCED = 1_000_000;
function sliderToSynced(v: number): number {
  const lo = Math.log10(MIN_SYNCED);
  const hi = Math.log10(TOTAL_SUPPLY);
  return Math.round(10 ** (lo + (hi - lo) * v));
}
function syncedToSlider(n: number): number {
  const lo = Math.log10(MIN_SYNCED);
  const hi = Math.log10(TOTAL_SUPPLY);
  return (Math.log10(Math.max(n, MIN_SYNCED)) - lo) / (hi - lo);
}

/**
 * What one holding earns per day.
 *
 * Mirrors the program: your weight over total weight, times the daily emission.
 * Everyone else is assumed to be at the 1.0x hold tier — the honest default,
 * since assuming they all lock would flatter your number.
 */
function perDayFor(
  holding: bigint,
  synced: bigint,
  tier: number,
  emissionPerDay: bigint
): { perDay: bigint; sharePct: number } {
  if (holding <= 0n || emissionPerDay <= 0n) return { perDay: 0n, sharePct: 0 };
  const others = synced > holding ? synced - holding : 0n;
  const yours = (holding * TIER_MULT_BPS[tier]) / BPS_DENOM;
  const total = others + yours;
  if (total <= 0n) return { perDay: 0n, sharePct: 0 };
  const perDay = (emissionPerDay * yours) / total;
  return { perDay, sharePct: Number((yours * 1_000_000n) / total) / 10_000 };
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </div>
      <div
        className={cn(
          "tnum mt-1.5 text-2xl font-semibold",
          accent ? "text-accent" : "text-ink"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-faint">{hint}</div>}
    </div>
  );
}

const LEVELS = [5_000_000, 25_000_000, 100_000_000, 500_000_000];

export function Calculator({ pool }: { pool: PoolState | null }) {
  const live = LAUNCHED && pool !== null;

  const [holdingInput, setHoldingInput] = useState("1000000");
  const [tier, setTier] = useState(0);
  const [syncedWhole, setSyncedWhole] = useState(25_000_000);
  const [emissionInput, setEmissionInput] = useState("500000");

  const holding = toBaseUnits(holdingInput);
  const synced = toBaseUnits(syncedWhole);

  // Once live the rate is a chain constant and cannot be typed over.
  const emissionPerDay = live
    ? pool.rewardRatePerSec * DAY
    : toBaseUnits(emissionInput);

  const now = useMemo(
    () => perDayFor(holding, synced, tier, emissionPerDay),
    [holding, synced, tier, emissionPerDay]
  );

  // Same wallet, same tokens, four levels of adoption. This is the point of the
  // page, so it gets its own block rather than a line of prose.
  const ladder = useMemo(
    () =>
      LEVELS.map((whole) => ({
        whole,
        ...perDayFor(holding, toBaseUnits(whole), tier, emissionPerDay),
      })),
    [holding, tier, emissionPerDay]
  );

  const best = ladder[0].perDay;
  const worst = ladder[ladder.length - 1].perDay;
  const advantage = worst > 0n ? Number((best * 100n) / worst) / 100 : null;

  const dailyPctOfHolding =
    holding > 0n ? Number((now.perDay * 1_000_000n) / holding) / 10_000 : 0;

  return (
    <div className="pointer-events-none relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-12">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          What would I earn?
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-muted">
          Not a forecast — just the arithmetic the contract actually does, with
          every assumption in plain sight so you can change it.
        </p>
      </div>

      {/* Inputs */}
      <Card className="pointer-events-auto mt-10">
        <CardBody className="space-y-6 p-5 sm:p-6">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            <CalcIcon size={12} className="text-accent" />
            Your assumptions
          </div>

          <label className="block">
            <span className="text-[13px] font-medium text-ink">
              How much {TOKEN_SYMBOL} you hold
            </span>
            <input
              inputMode="decimal"
              value={holdingInput}
              onChange={(e) =>
                setHoldingInput(e.target.value.replace(/[^\d.]/g, ""))
              }
              className="tnum mt-2 w-full rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent-dim"
            />
          </label>

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-ink">
                How much {TOKEN_SYMBOL} everyone has synced
              </span>
              <span className="tnum text-[13px] text-accent">
                {formatCompact(synced)}
                <span className="ml-1.5 text-[11px] text-ink-faint">
                  {((syncedWhole / TOTAL_SUPPLY) * 100).toFixed(1)}% of supply
                </span>
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={syncedToSlider(syncedWhole)}
              onChange={(e) =>
                setSyncedWhole(sliderToSynced(Number(e.target.value)))
              }
              className="range-accent mt-3 w-full"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              This is the one that matters most. The reserve pays a fixed amount
              per day and splits it between everyone synced, so the more people
              join, the thinner every slice gets — including yours.
            </p>
          </div>

          <div>
            <span className="text-[13px] font-medium text-ink">Your tier</span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIERS.map((t) => (
                <button
                  key={t.tier}
                  onClick={() => setTier(t.tier)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors",
                    tier === t.tier
                      ? "border-accent-dim bg-accent/[0.07]"
                      : "border-line bg-surface-2 hover:border-line-strong"
                  )}
                >
                  <div
                    className={cn(
                      "text-[12px] font-semibold",
                      tier === t.tier ? "text-accent" : "text-ink"
                    )}
                  >
                    {t.name}
                  </div>
                  <div className="tnum mt-0.5 text-[10px] text-ink-faint">
                    {t.multiplier.toFixed(1)}× ·{" "}
                    {t.days === 0 ? "no lock" : `${t.days}d lock`}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-ink">
                {TOKEN_SYMBOL} paid out per day, in total
              </span>
              {live && (
                <span className="rounded-md border border-accent-dim/50 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
                  Live from chain
                </span>
              )}
            </div>
            {live ? (
              <div className="tnum mt-2 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink">
                {formatUnits(emissionPerDay, { decimals: 0 })}
              </div>
            ) : (
              <input
                inputMode="decimal"
                value={emissionInput}
                onChange={(e) =>
                  setEmissionInput(e.target.value.replace(/[^\d.]/g, ""))
                }
                className="tnum mt-2 w-full rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent-dim"
              />
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              {live
                ? "Set once when the contract was deployed. There is no function to change it — not by us, not by anyone."
                : "Not chosen yet. It gets written into the contract at launch and can never be changed afterwards, so the number above is a guess and you are free to change it."}
            </p>
          </div>
        </CardBody>
      </Card>

      {/* Result */}
      <Card className="pointer-events-auto mt-5 border-accent-dim/40">
        <CardBody className="p-5 sm:p-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <Stat
              label="Per day"
              accent
              value={formatUnits(now.perDay, { decimals: 0 })}
              hint={`${TOKEN_SYMBOL}, every day`}
            />
            <Stat
              label="Per month"
              value={formatUnits(now.perDay * 30n, { decimals: 0 })}
              hint="30 days at this rate"
            />
            <Stat
              label="Your share"
              value={`${now.sharePct.toFixed(3)}%`}
              hint="of everything paid out"
            />
          </div>
          <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-muted">
            That is{" "}
            <span className="tnum text-ink">
              {dailyPctOfHolding.toFixed(3)}%
            </span>{" "}
            more {TOKEN_SYMBOL} each day than you started with — measured in
            tokens, not money. It says nothing about what those tokens are worth.
          </p>
        </CardBody>
      </Card>

      {/* The early-holder point */}
      <div className="mt-14">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
          <Users size={18} className="text-accent" />
          Why being early is worth so much
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Same wallet, same {formatCompact(holding)} {TOKEN_SYMBOL}, same tier.
          The only thing changing below is how many other people have shown up.
        </p>

        <div className="mt-5 overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left">
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Total synced
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Your share
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  You earn per day
                </th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((row, i) => (
                <tr
                  key={row.whole}
                  className="border-b border-line last:border-0"
                >
                  <td className="tnum px-4 py-3 text-ink-muted">
                    {formatCompact(toBaseUnits(row.whole))}
                  </td>
                  <td className="tnum px-4 py-3 text-right text-ink-muted">
                    {row.sharePct.toFixed(3)}%
                  </td>
                  <td
                    className={cn(
                      "tnum px-4 py-3 text-right font-semibold",
                      i === 0 ? "text-accent" : "text-ink"
                    )}
                  >
                    {formatUnits(row.perDay, { decimals: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {advantage !== null && advantage > 1 && (
          <Card className="pointer-events-auto mt-4 border-accent-dim/40">
            <CardBody className="flex gap-3 p-4">
              <TrendingUp size={16} className="mt-0.5 shrink-0 text-accent" />
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Syncing while 5M is registered earns{" "}
                <span className="font-semibold text-accent">
                  {advantage.toFixed(0)}×
                </span>{" "}
                what the identical wallet earns once 500M is. Nobody grants that
                and nobody can take it away — it is just what dividing a fixed
                amount between more people does. It is also why the{" "}
                {AIRDROP_PERCENT}% airdrop is worth syncing rather than selling.
              </p>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Honest limits */}
      <Card className="pointer-events-auto mt-8 border-loss/25">
        <CardBody className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-muted">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            <Info size={12} />
            What this does not tell you
          </div>
          <p>
            <span className="text-ink">It is not a return.</span> Everything here
            is counted in {TOKEN_SYMBOL}. If the price falls further than you
            earn, you are down — more tokens is not more money.
          </p>
          <p>
            <span className="text-ink">It assumes the rate keeps running.</span>{" "}
            The reserve is finite. It pays out until it is empty and only refills
            from trading fees, so a quiet market means a shorter schedule.
          </p>
          <p>
            <span className="text-ink">It assumes you stay synced.</span> Sell,
            and your earnings drop to match what you still actually hold — the
            contract always uses the smaller of what you registered and what is
            in your wallet.
          </p>
          <p>
            <span className="text-ink">
              Everyone else is assumed to be just holding.
            </span>{" "}
            If others lock at higher multipliers, their weight rises and your
            share falls below what is shown here.
          </p>
        </CardBody>
      </Card>

      <p className="mt-10 text-center text-[11px] text-ink-faint">
        Not financial advice. Do your own research.
      </p>
    </div>
  );
}
