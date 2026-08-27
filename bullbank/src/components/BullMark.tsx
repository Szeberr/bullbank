/**
 * The bull mark.
 *
 * Geometric rather than illustrative: two swept horns and a plain head plate,
 * built from strokes so it stays crisp at 20px in the top bar and at 80px on the
 * connect screen. No gradients inside the glyph itself — the accent comes from
 * currentColor so it inherits whatever context it sits in.
 */
export function BullMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Left horn */}
      <path
        d="M4 6c0 5.2 1.9 8.4 5.6 9.7"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* Right horn */}
      <path
        d="M28 6c0 5.2-1.9 8.4-5.6 9.7"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* Head plate */}
      <path
        d="M9.4 14.2h13.2v6.1c0 3.7-2.95 6.7-6.6 6.7s-6.6-3-6.6-6.7v-6.1Z"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      {/* Eyes */}
      <circle cx="13.1" cy="18.4" r="1.25" fill="currentColor" />
      <circle cx="18.9" cy="18.4" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        Bull
      </span>
      <span className="text-[15px] font-semibold tracking-tight accent-text">
        Bank
      </span>
    </div>
  );
}
