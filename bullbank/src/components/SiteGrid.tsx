import { useEffect, useState } from "react";
import { BackgroundRippleEffect } from "./ui/background-ripple-effect";

const CELL = 56;

/**
 * The grid, site-wide.
 *
 * Fixed rather than absolute. An absolutely-positioned grid has to be tall
 * enough for the longest page or it stops partway down — which is exactly what
 * it did when it lived inside the hero. Fixed to the viewport, it covers the
 * full window at every scroll position and can never run out.
 *
 * Rows and columns are recalculated on resize, with one extra of each so the
 * final row and column are never cut off mid-cell at awkward window sizes.
 *
 * It sits at z-0 with page content at z-10. Content that needs clicks sets
 * pointer-events itself; everything else stays transparent so the ripple
 * responds across the whole page rather than only in the margins.
 */
export function SiteGrid() {
  const [dims, setDims] = useState(() => ({
    rows: Math.ceil(window.innerHeight / CELL) + 1,
    cols: Math.ceil(window.innerWidth / CELL) + 1,
  }));

  useEffect(() => {
    const onResize = () =>
      setDims({
        rows: Math.ceil(window.innerHeight / CELL) + 1,
        cols: Math.ceil(window.innerWidth / CELL) + 1,
      });

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      {/* Vertical falloff: strongest at the top where the hero sits, fading to
          near-nothing further down so dashboard content never fights it. */}
      <div className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.55)_45%,rgba(0,0,0,0.35)_100%)]">
        <div className="[--cell-border-color:#22381457] [--cell-fill-color:#0c1208] [--cell-shadow-color:#3d7a16]">
          <BackgroundRippleEffect
            rows={dims.rows}
            cols={dims.cols}
            cellSize={CELL}
          />
        </div>
      </div>
    </div>
  );
}
