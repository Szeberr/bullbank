import { TOKEN_DECIMALS } from "../solana/config";

const BASE = 10n ** BigInt(TOKEN_DECIMALS);

/**
 * Base units -> a display string, without going through Number.
 *
 * Token amounts routinely exceed 2^53 in base units (a billion tokens at 6
 * decimals is 1e15), so converting to Number before formatting silently loses
 * precision on exactly the balances that matter most. All splitting is done in
 * BigInt and only the formatting is string work.
 */
export function formatUnits(
  base: bigint,
  opts: { decimals?: number; group?: boolean } = {}
): string {
  const { decimals = 4, group = true } = opts;
  const negative = base < 0n;
  const abs = negative ? -base : base;

  const whole = abs / BASE;
  const frac = abs % BASE;

  let wholeStr = whole.toString();
  if (group) wholeStr = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (decimals <= 0) return (negative ? "-" : "") + wholeStr;

  // Pad to full precision, then trim to the requested number of places.
  const fracStr = frac.toString().padStart(TOKEN_DECIMALS, "0").slice(0, decimals);
  return (negative ? "-" : "") + wholeStr + "." + fracStr;
}

/** Compact form for headline figures: 1.24M, 892.3K. */
export function formatCompact(base: bigint): string {
  const whole = base / BASE;
  const n = Number(whole);
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return formatUnits(base, { decimals: 2 });
}

/** Whole tokens (user input) -> base units. */
export function toBaseUnits(whole: string | number): bigint {
  const s = String(whole).trim();
  if (!s || !/^\d*\.?\d*$/.test(s)) return 0n;

  const [intPart = "0", fracPart = ""] = s.split(".");
  const frac = fracPart.slice(0, TOKEN_DECIMALS).padEnd(TOKEN_DECIMALS, "0");
  return BigInt(intPart || "0") * BASE + BigInt(frac || "0");
}

export function shortAddress(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

/** "6d 4h", "3h 12m", "45s" — coarse by design; nobody needs seconds on a 60-day lock. */
export function formatDuration(seconds: bigint | number): string {
  let s = Number(seconds);
  if (s <= 0) return "0s";

  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${Math.floor(s)}s`;
  return `${Math.floor(s)}s`;
}

export function formatDateTime(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatClock(unixMs: number): string {
  return new Date(unixMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
