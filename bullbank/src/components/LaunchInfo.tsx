import { useState, type ReactNode } from "react";
import { Copy, Check, ExternalLink, Globe } from "lucide-react";
import { Card, CardBody } from "./ui/card";
import {
  ADDRESSES,
  LAUNCHED,
  SOCIALS,
  TOKEN_SYMBOL,
  EXPLORER_ACCOUNT,
} from "../solana/config";

/** The X glyph. Inline so it inherits currentColor and needs no icon package. */
export function XIcon({ size = 12 }: { size?: number }) {
  return <XLogo size={size} />;
}

function XLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** The GitHub mark, inline for the same reason as the X glyph. */
export function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58l-.01-2.05c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.010 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.82 1.1.82 2.22l-.01 3.29c0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

/**
 * Contract address.
 *
 * Deliberately renders an explicit "not launched" state rather than a plausible
 * placeholder. A greyed-out string of characters reads as an address to most
 * people, and someone could copy it and send funds somewhere. Saying nothing
 * exists yet is the only safe pre-launch state.
 */
function ContractAddress() {
  const [copied, setCopied] = useState(false);
  const mint = ADDRESSES.tokenMint;
  const live = LAUNCHED && mint;

  const copy = async () => {
    if (!mint) return;
    try {
      await navigator.clipboard.writeText(mint.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the address is selectable on screen regardless */
    }
  };

  return (
    <Card>
      <CardBody className="p-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Contract address
        </div>

        {live ? (
          <>
            <div className="mt-3 flex items-center gap-2">
              <code className="tnum flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-ground px-3 py-2.5 font-mono text-[12px] text-ink">
                {mint.toBase58()}
              </code>
              <button
                onClick={copy}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-muted transition-colors hover:border-accent-dim hover:text-accent"
                title="Copy address"
              >
                {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
              </button>
            </div>
            <a
              href={EXPLORER_ACCOUNT(mint.toBase58())}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-ink-faint transition-colors hover:text-accent"
            >
              View on Solscan <ExternalLink size={10} />
            </a>
          </>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-line-strong bg-ground px-4 py-4 text-center">
            <div className="text-sm font-medium text-ink-muted">
              Not launched yet
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-ink-faint">
              The {TOKEN_SYMBOL} contract address will appear here the moment the
              token goes live. Until then there is nothing to buy — ignore any
              address you see anywhere else.
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SocialLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="pointer-events-auto group flex items-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:border-accent-dim/60"
    >
      <span className="text-ink-muted transition-colors group-hover:text-accent">
        {icon}
      </span>
      <span className="text-[13px] font-medium text-ink">{label}</span>
      <ExternalLink
        size={11}
        className="ml-auto text-ink-faint transition-colors group-hover:text-ink-muted"
      />
    </a>
  );
}

export function LaunchInfo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="pointer-events-auto grid gap-3 sm:grid-cols-2">
        <ContractAddress />
        <div className="grid content-start gap-3">
          <SocialLink href={SOCIALS.x} label="Our X" icon={<XLogo size={15} />} />
          <SocialLink
            href={SOCIALS.launchpad}
            label="Ansem&apos;s Launchpad"
            icon={<Globe size={15} />}
          />
          <SocialLink
            href={SOCIALS.github}
            label="Read the code"
            icon={<GithubIcon size={15} />}
          />
        </div>
      </div>
    </div>
  );
}
