import { TIERS, type Tier } from "../solana/config";
import { cn } from "../lib/utils";

/**
 * Tier cards.
 *
 * The visual weight climbs with the tier so the hierarchy is legible before a
 * single word is read: Core is nearly bare, Black gets the full treatment. The
 * card everyone should want looks like the card everyone should want.
 *
 * Depth is built from four cheap layers rather than a heavy border — a hairline
 * ring, a top edge highlight, a radial bloom behind the multiplier, and a lift
 * on hover. Each is subtle on its own; together they read as glass rather than
 * as a rectangle with a stroke on it.
 */

interface TierVisual {
  ring: string;
  bloom: string;
  label: string;
  glowOnHover: string;
}

const VISUALS: Record<number, TierVisual> = {
  0: {
    ring: "ring-white/[0.06]",
    bloom: "from-white/[0.03]",
    label: "text-ink-muted",
    glowOnHover: "hover:shadow-[0_16px_40px_-24px_rgba(255,255,255,0.18)]",
  },
  1: {
    ring: "ring-white/[0.08]",
    bloom: "from-accent/[0.04]",
    label: "text-ink",
    glowOnHover: "hover:shadow-[0_16px_44px_-24px_rgba(124,232,31,0.25)]",
  },
  2: {
    ring: "ring-accent/[0.16]",
    bloom: "from-accent/[0.07]",
    label: "text-accent/90",
    glowOnHover: "hover:shadow-[0_18px_50px_-22px_rgba(124,232,31,0.4)]",
  },
  3: {
    ring: "ring-accent/[0.3]",
    bloom: "from-accent/[0.12]",
    label: "text-accent",
    glowOnHover: "hover:shadow-[0_22px_60px_-20px_rgba(124,232,31,0.55)]",
  },
};

function TierCard({ tier }: { tier: Tier }) {
  const v = VISUALS[tier.tier];
  const isTop = tier.tier === 3;

  return (
    <div
      className={cn(
        "group pointer-events-auto relative overflow-hidden rounded-2xl p-px",
        "transition-transform duration-300 ease-out hover:-translate-y-1"
      )}
    >
      {/* Gradient hairline. A 1px padded wrapper with a gradient behind the inner
          card gives a border that varies around the edge — flat borders are the
          main thing that makes dark cards look cheap. */}
      <div
        className={cn(
          "absolute inset-0 rounded-2xl bg-gradient-to-b transition-opacity duration-300",
          isTop
            ? "from-accent/40 via-accent/10 to-transparent opacity-100"
            : "from-white/10 via-white/[0.04] to-transparent opacity-70 group-hover:opacity-100"
        )}
      />

      <div
        className={cn(
          "relative h-full rounded-[15px] bg-surface px-5 pb-5 pt-4 ring-1 ring-inset transition-shadow duration-300",
          v.ring,
          v.glowOnHover
        )}
      >
        {/* Bloom behind the number. */}
        <div
          className={cn(
            "pointer-events-none absolute -left-6 -top-10 h-32 w-32 rounded-full bg-gradient-radial blur-2xl transition-opacity duration-500",
            "bg-gradient-to-br to-transparent opacity-70 group-hover:opacity-100",
            v.bloom
          )}
        />

        {/* Top edge highlight. */}
        <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

        <div className="relative flex items-center justify-between">
          <span
            className={cn(
              "text-[11px] font-bold uppercase tracking-[0.18em]",
              v.label
            )}
          >
            {tier.name}
          </span>
          {isTop && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-accent ring-1 ring-inset ring-accent/25">
              Highest
            </span>
          )}
        </div>

        <div className="relative mt-5 flex items-baseline gap-1.5">
          <span
            className={cn(
              "tnum text-[38px] font-semibold leading-none tracking-tight transition-colors duration-300",
              isTop
                ? "text-accent [text-shadow:0_0_28px_rgba(124,232,31,0.45)]"
                : "text-ink group-hover:text-accent"
            )}
          >
            {tier.multiplier.toFixed(1)}
          </span>
          <span className="text-lg font-medium text-ink-faint">×</span>
        </div>

        <div className="relative mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
          <span className="text-[11px] font-medium text-ink-muted">
            {tier.days === 0 ? "No lock" : `${tier.days} days`}
          </span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            {tier.days === 0 ? "just hold" : "locked"}
          </span>
        </div>

        {/* Weight bar — turns the multiplier into something you can compare at a
            glance instead of four numbers to mentally rank. */}
        <div className="relative mt-3 h-[3px] overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              isTop
                ? "bg-gradient-to-r from-accent-dim to-accent"
                : "bg-gradient-to-r from-accent-dim/60 to-accent/70"
            )}
            style={{ width: `${(tier.multiplier / 2) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function TierCards({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {TIERS.map((t) => (
        <TierCard key={t.tier} tier={t} />
      ))}
    </div>
  );
}
