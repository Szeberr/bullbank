import { ArrowUpRight, Wallet } from "lucide-react";
import { Card } from "./ui/card";
import { formatUnits, formatDuration } from "../lib/format";
import { TOKEN_SYMBOL } from "../solana/config";

/**
 * Renders an amount so that movement is legible.
 *
 * The integer part is large and stable; the fractional digits are smaller and
 * accent. Because accrual is only a few base units per second, the change happens
 * entirely in the tail — showing it at the same weight as the whole number would
 * make a moving figure look like flicker instead of growth.
 */
export function TickingAmount({
  base,
  decimals = 6,
  size = "lg",
}: {
  base: bigint;
  decimals?: number;
  size?: "sm" | "md" | "lg";
}) {
  const text = formatUnits(base, { decimals });
  const [whole, frac] = text.split(".");

  const scale = {
    sm: { w: "text-base", f: "text-[11px]" },
    md: { w: "text-2xl", f: "text-sm" },
    lg: { w: "text-5xl sm:text-6xl", f: "text-xl sm:text-2xl" },
  }[size];

  return (
    <span className="tnum inline-flex items-baseline">
      <span className={`${scale.w} font-semibold tracking-tight text-ink`}>
        {whole}
      </span>
      {frac ? (
        <span className={`${scale.f} font-medium text-accent/85`}>.{frac}</span>
      ) : null}
    </span>
  );
}

export function HeroBalance({
  principal,
  accrued,
  perDay,
  scheduleLeft,
  emissionsOver,
}: {
  principal: bigint;
  accrued: bigint;
  perDay: bigint;
  scheduleLeft: bigint;
  emissionsOver: boolean;
}) {
  const total = principal + accrued;

  return (
    <Card glow className="overflow-hidden">
      <div className="grid-noise absolute inset-0 opacity-60" aria-hidden />
      <div className="relative p-6 sm:p-8">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">
          <Wallet size={12} />
          Total account value
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <TickingAmount base={total} decimals={6} size="lg" />
          <span className="text-lg font-medium text-ink-muted">{TOKEN_SYMBOL}</span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
              Principal
            </div>
            <div className="tnum mt-1 text-base font-semibold text-ink">
              {formatUnits(principal, { decimals: 2 })}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
              Accrued
            </div>
            <div className="mt-1">
              <TickingAmount base={accrued} decimals={6} size="sm" />
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
              Rate
            </div>
            <div className="tnum mt-1 flex items-center gap-1.5 text-base font-semibold">
              {emissionsOver ? (
                <span className="text-ink-muted">—</span>
              ) : (
                <>
                  <ArrowUpRight size={14} className="text-gain" />
                  <span className="text-gain">
                    {formatUnits(perDay, { decimals: 2 })}
                  </span>
                  <span className="text-xs font-normal text-ink-faint">/day</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-line pt-4 text-xs text-ink-faint">
          {emissionsOver ? (
            <span>
              The emission schedule has ended. Principal and any unsettled balance
              remain claimable.
            </span>
          ) : (
            <span>
              Accrues continuously from the reserve.{" "}
              <span className="text-ink-muted">
                {formatDuration(scheduleLeft)} of schedule remaining.
              </span>
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
