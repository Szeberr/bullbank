import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * The surface everything sits on. One elevation, one hairline border, one top
 * highlight — repeated everywhere so the page reads as a single system rather
 * than a collection of boxes.
 */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { glow?: boolean }
>(({ className, glow, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "edge-light pointer-events-auto relative rounded-[14px] border border-line bg-surface",
      glow && "shadow-[0_0_60px_-20px_rgba(124,232,31,0.35)]",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-center justify-between gap-4 border-b border-line px-5 py-4",
      className
    )}
    {...props}
  />
);

export const CardTitle = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn(
      "text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted",
      className
    )}
    {...props}
  />
);

export const CardBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-5", className)} {...props} />
);

/** Small label/value pair used throughout the stat rows. */
export function Stat({
  label,
  value,
  sub,
  align = "left",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : undefined}>
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </div>
      <div className="tnum mt-1.5 text-lg font-semibold text-ink">{value}</div>
      {sub ? (
        <div className="tnum mt-0.5 text-xs text-ink-muted">{sub}</div>
      ) : null}
    </div>
  );
}
