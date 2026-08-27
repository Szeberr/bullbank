import { useEffect, useState } from "react";

/**
 * A ticking clock for the live accrual display.
 *
 * Uses requestAnimationFrame rather than setInterval so the browser suspends it
 * on a hidden tab — an interval would keep firing state updates against a page
 * nobody is looking at. Throttled to ~10 Hz: fast enough that the number reads
 * as continuously moving, slow enough not to burn a frame budget on a re-render
 * that changes four digits.
 */
export function useNow(hz = 10): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const interval = 1000 / hz;

    const loop = (t: number) => {
      if (t - last >= interval) {
        last = t;
        setNow(Date.now());
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [hz]);

  return now;
}
