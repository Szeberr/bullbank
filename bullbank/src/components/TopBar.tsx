import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Wordmark } from "./BullMark";
import { Button } from "./ui/button";
import { shortAddress } from "../lib/format";
import { CLUSTER } from "../solana/config";
import { cn } from "../lib/utils";

/**
 * Custom wallet control rather than the adapter's default button — that ships
 * its own stylesheet which fights the design system. The modal is reused; only
 * the trigger is ours.
 */
function WalletControl() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (!publicKey) {
    return (
      <Button variant="primary" size="sm" onClick={() => setVisible(true)}>
        {connecting ? "Connecting…" : "Connect"}
      </Button>
    );
  }

  return (
    <button
      onClick={() => void disconnect()}
      title="Click to disconnect"
      className="group flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs transition-colors hover:border-line-strong"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-gain" />
      <span className="tnum font-medium text-ink">
        {shortAddress(publicKey.toBase58())}
      </span>
      <ChevronDown
        size={12}
        className="text-ink-faint transition-colors group-hover:text-ink-muted"
      />
    </button>
  );
}

export function TopBar({
  refreshing,
  lastUpdated,
  onRefresh,
  route,
  onNavigate,
}: {
  refreshing: boolean;
  lastUpdated: number | null;
  onRefresh: () => void;
  route: "app" | "how" | "proof" | "plan";
  onNavigate: (r: "app" | "how" | "proof" | "plan") => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-5">
        <button onClick={() => onNavigate("app")} className="flex items-center">
          <Wordmark />
        </button>

        {/* Two pages, so tabs rather than a menu. */}
        <nav className="ml-2 flex items-center gap-1 sm:ml-4">
          <button
            onClick={() => onNavigate("app")}
            className={cn(
              "flex h-9 items-center rounded-lg px-2.5 text-xs font-medium transition-colors sm:px-3",
              route === "app" ? "bg-surface-2 text-ink" : "text-ink-faint hover:text-ink-muted"
            )}
          >
            Dashboard
          </button>
          <button
            onClick={() => onNavigate("how")}
            className={cn(
              "flex h-9 items-center rounded-lg px-2.5 text-xs font-medium transition-colors sm:px-3",
              route === "how" ? "bg-surface-2 text-ink" : "text-ink-faint hover:text-ink-muted"
            )}
          >
            <span className="sm:hidden">How</span>
            <span className="hidden sm:inline">How it works</span>
          </button>
          <button
            onClick={() => onNavigate("proof")}
            className={cn(
              "flex h-9 items-center rounded-lg px-2.5 text-xs font-medium transition-colors sm:px-3",
              route === "proof" ? "bg-surface-2 text-ink" : "text-ink-faint hover:text-ink-muted"
            )}
          >
            <span className="sm:hidden">Proof</span>
            <span className="hidden sm:inline">Transparency</span>
          </button>
          <button
            onClick={() => onNavigate("plan")}
            className={cn(
              "flex h-9 items-center rounded-lg px-2.5 text-xs font-medium transition-colors sm:px-3",
              route === "plan" ? "bg-surface-2 text-ink" : "text-ink-faint hover:text-ink-muted"
            )}
          >
            Plan
          </button>
        </nav>

        {CLUSTER !== "mainnet-beta" && (
          <span className="rounded-md border border-accent-dim/50 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
            {CLUSTER}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-[11px] text-ink-faint transition-colors hover:text-ink-muted"
            title="Refresh chain state"
          >
            <RefreshCw
              size={12}
              className={cn(refreshing && "animate-spin text-accent")}
            />
            <span className="hidden tnum sm:inline">
              {lastUpdated
                ? new Date(lastUpdated).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
          </button>
          <WalletControl />
        </div>
      </div>
    </header>
  );
}
