import { useEffect, useRef, useState } from "react";
import { Receipt } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/card";
import { formatUnits, formatClock } from "../lib/format";
import { TOKEN_SYMBOL } from "../solana/config";

export const POSTING_INTERVAL_MS = 5 * 60 * 1000;

export interface LedgerEntry {
  at: number;
  amount: string; // bigint serialised — localStorage cannot hold BigInt
}

/**
 * Posts an accrual entry every five minutes, like interest postings on a
 * statement.
 *
 * The entry value is `rate × window`, taken from the live on-chain emission
 * rate — not a delta of the displayed balance. Using a delta would report zero
 * (or negative) for any window in which the user settled, since settling resets
 * the claimable figure to zero. Rate × window is what the reserve actually paid
 * this account over the period regardless of when it was withdrawn.
 *
 * Persisted per wallet so the statement survives a reload. Entries are a local
 * view of on-chain accrual, so they are safe to discard.
 */
export function useAccrualLedger(
  owner: string | null,
  ratePerSecond: bigint
): { entries: LedgerEntry[]; nextPostIn: number } {
  const key = owner ? `bullbank.ledger.${owner}` : null;
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [nextPostIn, setNextPostIn] = useState(POSTING_INTERVAL_MS);
  const rateRef = useRef(ratePerSecond);
  rateRef.current = ratePerSecond;

  // Load persisted entries when the wallet changes.
  useEffect(() => {
    if (!key) {
      setEntries([]);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      setEntries(raw ? (JSON.parse(raw) as LedgerEntry[]) : []);
    } catch {
      setEntries([]);
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;

    const post = () => {
      const rate = rateRef.current;
      if (rate <= 0n) return;
      const amount = (rate * BigInt(POSTING_INTERVAL_MS)) / 1000n;

      setEntries((prev) => {
        const next = [{ at: Date.now(), amount: amount.toString() }, ...prev].slice(
          0,
          24
        );
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* quota or private mode — the ledger is disposable */
        }
        return next;
      });
    };

    const id = window.setInterval(post, POSTING_INTERVAL_MS);

    // Countdown to the next posting, for the header readout.
    const start = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = (Date.now() - start) % POSTING_INTERVAL_MS;
      setNextPostIn(POSTING_INTERVAL_MS - elapsed);
    }, 1000);

    return () => {
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, [key]);

  return { entries, nextPostIn };
}

export function AccrualLedger({
  entries,
  nextPostIn,
  active,
}: {
  entries: LedgerEntry[];
  nextPostIn: number;
  active: boolean;
}) {
  const mins = Math.floor(nextPostIn / 60000);
  const secs = Math.floor((nextPostIn % 60000) / 1000);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Statement</CardTitle>
        {active && (
          <span className="tnum flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-gain" />
            next posting {mins}:{String(secs).padStart(2, "0")}
          </span>
        )}
      </CardHeader>
      <CardBody className="p-0">
        {entries.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Receipt size={18} className="mx-auto text-ink-faint" />
            <div className="mt-2 text-xs text-ink-muted">No postings yet</div>
            <div className="mt-1 text-[10px] text-ink-faint">
              Accrual is posted here every five minutes.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {entries.map((e) => (
              <div
                key={e.at}
                className="flex items-center justify-between px-5 py-2.5 text-xs"
              >
                <span className="tnum text-ink-faint">{formatClock(e.at)}</span>
                <span className="text-ink-muted">Accrual posted</span>
                <span className="tnum font-semibold text-gain">
                  +{formatUnits(BigInt(e.amount), { decimals: 6 })} {TOKEN_SYMBOL}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
