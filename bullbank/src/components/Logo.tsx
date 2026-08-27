import { useState } from "react";
import { BullMark } from "./BullMark";
import { cn } from "../lib/utils";

/**
 * Brand logo with a hover swap.
 *
 * Shows `/logo.png`; on hover it crossfades to `/logo-hover.png`. Both images are
 * preloaded in the DOM and stacked, so the swap is instant with no flash of
 * missing image on first hover.
 *
 * If either file is absent the component falls back to the geometric BullMark
 * SVG rather than rendering a broken image. That keeps the app usable before the
 * art is dropped in, and means a bad deploy degrades quietly instead of putting
 * a broken icon in the header.
 */
export function Logo({
  size = 36,
  className,
  hoverSwap = true,
}: {
  size?: number;
  className?: string;
  /** Disable on small marks where the swap would be illegible. */
  hoverSwap?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <BullMark size={size} className={cn("text-accent", className)} />;
  }

  return (
    <div
      className={cn("group relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <img
        src="/logo.png"
        alt="BullBank"
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={cn(
          "absolute inset-0 h-full w-full object-contain transition-opacity duration-200",
          hoverSwap && "group-hover:opacity-0"
        )}
      />
      {hoverSwap && (
        <img
          src="/logo-hover.png"
          alt=""
          aria-hidden
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        />
      )}
    </div>
  );
}
