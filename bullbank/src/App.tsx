import { useCallback, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  X,
  Globe,
} from "lucide-react";

import { TopBar } from "./components/TopBar";
import { HeroBalance } from "./components/HeroBalance";
import { AccountsPanel } from "./components/AccountsPanel";
import { OpenAccount } from "./components/OpenAccount";
import { ReserveStats } from "./components/ReserveStats";
import { AccrualLedger, useAccrualLedger } from "./components/AccrualLedger";
import { TextHoverEffect } from "./components/ui/text-hover-effect";
import { ContainerTextFlip } from "./components/ui/container-text-flip";
import { Magnetic } from "./components/ui/magnetic";
import { SiteGrid } from "./components/SiteGrid";
import { TierCards } from "./components/TierCards";
import { HowItWorks } from "./components/HowItWorks";
import { Transparency } from "./components/Transparency";
import { Roadmap } from "./components/Roadmap";
import { HoldingPanel } from "./components/HoldingPanel";
import { LaunchInfo, XIcon } from "./components/LaunchInfo";
import { Button } from "./components/ui/button";
import { Card, CardBody } from "./components/ui/card";

import { useChainState } from "./hooks/useChainState";
import { useActions } from "./hooks/useActions";
import { useNow } from "./hooks/useNow";
import { useRoute } from "./hooks/useRoute";
import {
  totalClaimable,
  totalRatePerSecond,
  scheduleRemaining,
  type PoolState,
} from "./solana/accrual";
import { EXPLORER, TOKEN_SYMBOL, LAUNCHED, SOCIALS, missingConfig } from "./solana/config";
import { formatUnits, formatCompact, formatDuration } from "./lib/format";

const HEADLINE_PHRASES = [
  "continuously",
  "every second",
  "while you sleep",
  "on schedule",
  "around the clock",
  "without asking",
  "in real time",
  "day and night",
];

function ConfigBanner({ missing }: { missing: string[] }) {
  return (
    <div className="border-b border-accent-dim/40 bg-accent/[0.07]">
      <div className="mx-auto flex max-w-[1440px] items-start gap-2.5 px-5 py-3 text-xs">
        <AlertTriangle size={14} className="mt-px shrink-0 text-accent" />
        <div className="text-ink-muted">
          <span className="font-semibold text-accent">Not configured.</span> Missing{" "}
          <span className="tnum font-mono text-ink">{missing.join(", ")}</span>. Copy{" "}
          <span className="font-mono">.env.example</span> to{" "}
          <span className="font-mono">.env</span> and fill in the addresses from{" "}
          <span className="font-mono">pool-addresses.json</span>. Chain reads and
          transactions are disabled until then.
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="border-b border-loss/30 bg-loss/[0.08]">
      <div className="mx-auto flex max-w-[1440px] items-start gap-2.5 px-5 py-3 text-xs">
        <AlertTriangle size={14} className="mt-px shrink-0 text-loss" />
        <div className="text-ink-muted">{message}</div>
      </div>
    </div>
  );
}

/**
 * Landing state.
 *
 * Three motion pieces, each given one job so they do not compete:
 *   - the hover-effect wordmark is the single focal point
 *   - the text flip animates exactly one word in the subhead
 *
 * All three are restyled onto the green-and-black tokens. Left at their stock
 * colours they read as a component-library demo, which for a token product is
 * worse than plain.
 */
function ConnectScreen({
  pool,
  reserveBalance,
  nowSec,
}: {
  pool: PoolState | null;
  reserveBalance: bigint | null;
  nowSec: bigint;
}) {
  const { setVisible } = useWalletModal();

  const perDay = pool ? pool.rewardRatePerSec * 86_400n : 0n;
  const runway = pool ? scheduleRemaining(pool, nowSec) : 0n;

  // Randomised on every hover of the wordmark. Never repeats the phrase that is
  // already showing, otherwise roughly one hover in eight looks broken.
  const [phrase, setPhrase] = useState(HEADLINE_PHRASES[0]);
  const shufflePhrase = () => {
    const others = HEADLINE_PHRASES.filter((p) => p !== phrase);
    setPhrase(others[Math.floor(Math.random() * others.length)]);
  };

  return (
    <div className="pointer-events-none relative z-10">
      {/*
        The content column is transparent to the mouse so the grid underneath
        stays hoverable across its whole area — previously the column swallowed
        every event over the middle, and the ripple only responded in the
        margins either side of it. Interactive children opt back in individually
        with pointer-events-auto.
      */}
      <div className="pointer-events-none relative mx-auto max-w-[1440px] px-5 pb-16 pt-14 sm:pt-20">
        <div className="mx-auto max-w-4xl text-center">
          {/* Focal wordmark. Fixed height because the effect fills its box. */}
          <div
            className="pointer-events-auto mx-auto h-[110px] w-full sm:h-[140px]"
            onMouseEnter={shufflePhrase}
          >
            <TextHoverEffect text="BULLBANK" duration={0.25} />
          </div>

          <h1 className="mt-1 flex flex-wrap items-center justify-center gap-x-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            <span>A token that pays you</span>
            {/* Keyed on the phrase so each change remounts and replays the
                letter animation, rather than silently swapping the text. */}
            <ContainerTextFlip
              key={phrase}
              words={[phrase]}
              interval={10_000_000}
              className="!text-3xl sm:!text-4xl"
              textClassName="!text-accent"
            />
          </h1>

          <p className="mx-auto mt-6 max-w-md text-[15px] leading-relaxed text-ink-muted">
            Hold {TOKEN_SYMBOL} in your own wallet and it earns you more, every
            second. Nothing gets locked and nothing leaves your wallet. The rate
            is written into the contract and the reserve is on-chain, so nobody
            can pull it out.
          </p>

          <Magnetic className="pointer-events-auto mt-8 inline-block">
            <Button
              variant="primary"
              size="lg"
              className="px-8"
              onClick={() => setVisible(true)}
            >
              Connect wallet
            </Button>
          </Magnetic>

          {/* Live proof. Real chain numbers beat any illustration here, and they
              are already fetched before anyone connects. */}
          {LAUNCHED && pool ? (
            <div className="pointer-events-auto mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-center">
              <div>
                <div className="tnum text-lg font-semibold text-ink">
                  {formatUnits(perDay, { decimals: 0 })}
                </div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  {TOKEN_SYMBOL} per day
                </div>
              </div>
              <div className="h-8 w-px bg-line" />
              <div>
                <div className="tnum text-lg font-semibold text-ink">
                  {reserveBalance === null ? "—" : formatCompact(reserveBalance)}
                </div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  In reserve
                </div>
              </div>
              <div className="h-8 w-px bg-line" />
              <div>
                <div className="tnum text-lg font-semibold text-ink">
                  {runway === 0n ? "Ended" : formatDuration(runway)}
                </div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  Schedule left
                </div>
              </div>
            </div>
          ) : (
            /* Pre-launch. Nothing is live, so there is nothing to quote. Saying
               so outright is the only honest thing to put in this space. */
            <div className="pointer-events-auto mx-auto mt-10 max-w-md rounded-xl border border-dashed border-line-strong px-5 py-4">
              <div className="text-sm font-medium text-ink-muted">
                Not launched yet
              </div>
              <div className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                The token isn't live and the reserve is empty. There are no
                rewards to earn and nothing to buy. Follow along below.
              </div>
            </div>
          )}
        </div>

        <TierCards className="mt-14" />

        <LaunchInfo className="mx-auto mt-6 max-w-3xl" />

        <div className="mx-auto mt-10 max-w-xl text-center text-[11px] leading-relaxed text-ink-faint">
          Rewards are paid in {TOKEN_SYMBOL}. More tokens is not the same as more
          value — the price can still go down. Holding never locks anything. If
          you choose to lock, you cannot get those tokens back before the term
          ends.
        </div>
      </div>
    </div>
  );
}

function TxToast({
  tx,
  onClose,
}: {
  tx: ReturnType<typeof useActions>["tx"];
  onClose: () => void;
}) {
  if (tx.stage === "idle") return null;

  const busy = tx.stage === "building" || tx.stage === "signing" || tx.stage === "confirming";
  const label =
    tx.stage === "building"
      ? "Preparing transaction…"
      : tx.stage === "signing"
        ? "Waiting for your approval…"
        : tx.stage === "confirming"
          ? "Confirming on Solana…"
          : tx.stage === "success"
            ? tx.kind === "deposit"
              ? "Deposit confirmed"
              : tx.kind === "settle"
                ? "Settled to your wallet"
                : "Withdrawal confirmed"
            : "Transaction failed";

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[330px] animate-rise">
      <Card className="border-line-strong">
        <CardBody className="flex items-start gap-3 p-4">
          {busy ? (
            <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-accent" />
          ) : tx.stage === "success" ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-gain" />
          ) : (
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-loss" />
          )}

          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink">{label}</div>
            {tx.message && (
              <div className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                {tx.message}
              </div>
            )}
            {tx.signature && (
              <a
                href={EXPLORER(tx.signature)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-accent"
              >
                View transaction <ExternalLink size={9} />
              </a>
            )}
          </div>

          {!busy && (
            <button
              onClick={onClose}
              className="shrink-0 text-ink-faint transition-colors hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default function App() {
  const wallet = useWallet();
  const [route, navigate] = useRoute();
  const chain = useChainState();
  const nowMs = useNow(10);

  const { tx, reset, sync, deposit, settle, withdraw } = useActions(chain.refresh);

  // Chain time, not local time. See useChainState for why this matters.
  const nowSec = useMemo(
    () => BigInt(Math.floor(nowMs / 1000) + chain.clockOffset),
    [nowMs, chain.clockOffset]
  );

  const principal = useMemo(
    () => chain.positions.reduce((s, p) => s + p.balance, 0n),
    [chain.positions]
  );

  const accrued = useMemo(
    () => (chain.pool ? totalClaimable(chain.pool, chain.positions, nowSec) : 0n),
    [chain.pool, chain.positions, nowSec]
  );

  const perSec = useMemo(
    () =>
      chain.pool ? totalRatePerSecond(chain.pool, chain.positions, nowSec) : 0n,
    [chain.pool, chain.positions, nowSec]
  );

  const scheduleLeft = chain.pool ? scheduleRemaining(chain.pool, nowSec) : 0n;

  const { entries, nextPostIn } = useAccrualLedger(
    wallet.publicKey?.toBase58() ?? null,
    perSec
  );

  const onSync = useCallback(
    () => void sync(chain.tokenProgram),
    [sync, chain.tokenProgram]
  );
  const onDeposit = useCallback(
    (tier: number, base: bigint) => void deposit(tier, base, chain.tokenProgram),
    [deposit, chain.tokenProgram]
  );
  const onSettle = useCallback(
    (tier: number) => void settle(tier, chain.tokenProgram),
    [settle, chain.tokenProgram]
  );
  const onWithdraw = useCallback(
    (tier: number, amount: bigint) =>
      void withdraw(tier, amount, chain.tokenProgram),
    [withdraw, chain.tokenProgram]
  );

  const missing = missingConfig();

  return (
    <div className="relative min-h-screen">
      <SiteGrid />
      {missing.length > 0 && <ConfigBanner missing={missing} />}
      {chain.error && missing.length === 0 && (
        <ErrorBanner message={chain.error} />
      )}

      <TopBar
        refreshing={chain.refreshing}
        lastUpdated={chain.lastUpdated}
        onRefresh={() => void chain.refresh()}
        route={route}
        onNavigate={navigate}
      />

      {route === "plan" ? (
        <Roadmap />
      ) : route === "proof" ? (
        <Transparency
          pool={chain.pool}
          reserveBalance={chain.reserveBalance}
          nowSec={nowSec}
        />
      ) : route === "how" ? (
        <HowItWorks />
      ) : !wallet.connected ? (
        <ConnectScreen
          pool={chain.pool}
          reserveBalance={chain.reserveBalance}
          nowSec={nowSec}
        />
      ) : (
        <main className="pointer-events-none relative z-10 mx-auto max-w-[1440px] space-y-5 px-5 py-8">
          <HeroBalance
            principal={principal}
            accrued={accrued}
            perDay={perSec * 86_400n}
            scheduleLeft={scheduleLeft}
            emissionsOver={scheduleLeft === 0n}
          />

          <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
            <div className="space-y-5">
              <HoldingPanel
                position={chain.positions.find((p) => p.tier === 0)}
                pool={chain.pool}
                walletBalance={chain.walletBalance}
                nowSec={nowSec}
                tx={tx}
                onSync={onSync}
                onClaim={() => onSettle(0)}
              />
              <AccountsPanel
                positions={chain.positions}
                pool={chain.pool}
                nowSec={nowSec}
                tx={tx}
                onSettle={onSettle}
                onWithdraw={onWithdraw}
              />
              <AccrualLedger
                entries={entries}
                nextPostIn={nextPostIn}
                active={perSec > 0n}
              />
            </div>

            <div className="space-y-5">
              <OpenAccount
                pool={chain.pool}
                positions={chain.positions}
                walletBalance={chain.walletBalance}
                nowSec={nowSec}
                tx={tx}
                connected={wallet.connected}
                onDeposit={onDeposit}
              />
              <ReserveStats
                pool={chain.pool}
                reserveBalance={chain.reserveBalance}
                nowSec={nowSec}
              />
            </div>
          </div>
        </main>
      )}

      <footer className="pointer-events-none relative z-10 mx-auto max-w-[1440px] px-5 pb-10 pt-4 text-center text-[10px] leading-relaxed text-ink-faint">
        <div className="pointer-events-auto mb-4 flex items-center justify-center gap-4">
          <a href={SOCIALS.x} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[12px] text-ink-muted transition-colors hover:text-accent">
            <XIcon /> Our X
          </a>
          <span className="h-3 w-px bg-line" />
          <a href={SOCIALS.launchpad} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[12px] text-ink-muted transition-colors hover:text-accent">
            <Globe size={12} /> Ansem&apos;s Launchpad
          </a>
        </div>
        Accrual figures are computed from on-chain state and match what a
        settlement pays. Returns are denominated in {TOKEN_SYMBOL}. Not financial
        advice.
      </footer>

      <TxToast tx={tx} onClose={reset} />
    </div>
  );
}
