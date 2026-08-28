import { Wallet, RefreshCw, TrendingUp, HandCoins } from "lucide-react";
import { Card, CardBody } from "./ui/card";
import { TOKEN_SYMBOL, TIERS } from "../solana/config";
import { LaunchpadNote } from "./LaunchpadNote";
import { cn } from "../lib/utils";

/**
 * How It Works.
 *
 * Written for someone who has never used a dApp. Rules followed throughout:
 * short sentences, no jargon without an immediate plain-English gloss, and the
 * awkward questions answered directly rather than buried — what happens if you
 * sell, why syncing is necessary, what it costs, and what the thing does not do.
 *
 * A page that only lists upsides reads as marketing and gets trusted less than
 * one that says plainly where the edges are.
 */

const STEPS = [
  {
    icon: Wallet,
    title: "Buy and hold",
    body: `Buy ${TOKEN_SYMBOL} and keep it in your own wallet. You never send it to us, and we never hold it. It stays yours the whole time.`,
  },
  {
    icon: RefreshCw,
    title: "Connect and sync",
    body: "Come here, connect your wallet, and hit Sync. That's what tells the contract how much you hold. It's one transaction and it costs a fraction of a cent in network fees.",
  },
  {
    icon: TrendingUp,
    title: "Earn every second",
    body: "From the moment you sync, your balance starts earning. Not once a day, not once a week — every second, and you can watch it climb on your dashboard.",
  },
  {
    icon: HandCoins,
    title: "Claim when you want",
    body: "What you've earned sits in the contract with your name on it until you take it. There's no deadline and no penalty for leaving it there.",
  },
];

const FAQ = [
  {
    q: "Why do I have to sync? Why isn't it automatic?",
    a: `Straight answer: the contract can't see your wallet on its own. Nothing on Solana notifies it when your balance changes, so it has no way to know what you hold until you tell it. Syncing is you telling it. If you buy more ${TOKEN_SYMBOL} later, sync again so your bigger balance counts.`,
  },
  {
    q: "What happens if I sell after syncing?",
    a: "You stop earning on what you sold. When you next sync or claim, the contract compares what you registered against what you actually hold now and uses the smaller of the two. So you can't sync a big balance, sell, and keep collecting on tokens you no longer own.",
  },
  {
    q: "How much do I earn?",
    a: `Your share of the payout equals your share of everyone who's synced. Hold 1% of all synced ${TOKEN_SYMBOL} and you get 1% of what the reserve pays out. If more people join, everyone's slice gets smaller — the reserve pays a fixed amount per day no matter how many people are sharing it.`,
  },
  {
    q: "Where do the rewards actually come from?",
    a: `A reserve of ${TOKEN_SYMBOL} held by the contract. It's topped up from trading fees: fees come in as SOL, get used to buy ${TOKEN_SYMBOL} on the open market, and that ${TOKEN_SYMBOL} goes into the reserve. Nothing is minted — the supply never grows.`,
  },
  {
    q: "Can you take the reserve back?",
    a: "No, and not as a promise — there is simply no instruction in the contract that moves tokens out of the reserve to anyone except a holder claiming. It doesn't exist in the code. The only way out is a claim.",
  },
  {
    q: "Can you change the rate?",
    a: "No. The rate is set once when the contract is deployed and there's no function to change it. Nobody can turn it up to pump the numbers or turn it down to save money.",
  },
  {
    q: "What does it cost?",
    a: "Syncing and claiming are Solana transactions, so each costs a small network fee in SOL — typically well under a cent. We don't charge anything on top. Keep a little SOL in your wallet for fees.",
  },
  {
    q: "Do I have to lock my tokens?",
    a: "No. Holding and syncing is enough. Locking is optional and only exists if you want to earn at a higher rate — see below.",
  },
];

export function HowItWorks() {
  return (
    <div className="pointer-events-none relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-12">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          How it works
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-muted">
          Hold {TOKEN_SYMBOL} in your own wallet and it earns you more{" "}
          {TOKEN_SYMBOL}. Here's the whole thing in four steps.
        </p>
      </div>

      {/* Steps */}
      <div className="mt-12 space-y-3">
        {STEPS.map((s, i) => (
          <Card key={s.title} className="overflow-hidden">
            <CardBody className="flex gap-5 p-5 sm:p-6">
              <div className="flex flex-col items-center">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/25">
                  <s.icon size={17} />
                </div>
                {i < STEPS.length - 1 && (
                  <div className="mt-2 w-px flex-1 bg-gradient-to-b from-accent/25 to-transparent" />
                )}
              </div>
              <div className="pb-1">
                <div className="flex items-baseline gap-2.5">
                  <span className="tnum text-[11px] font-semibold text-accent">
                    0{i + 1}
                  </span>
                  <h2 className="text-lg font-semibold text-ink">{s.title}</h2>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {s.body}
                </p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <LaunchpadNote className="mt-14" />

      {/* Optional locking */}
      <div className="mt-14">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          Want to earn faster?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Holding earns at the base rate. If you're willing to lock some{" "}
          {TOKEN_SYMBOL} away for a while, you earn at a higher rate for as long
          as it's locked. Locked tokens go into the contract and{" "}
          <span className="text-ink">you cannot get them back early</span> — not
          for a fee, not by asking. Only lock what you're happy to leave alone.
        </p>

        <div className="mt-5 overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left">
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Tier
                </th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Locked for
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Earns
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line">
                <td className="px-4 py-3 font-medium text-ink">
                  Just holding
                </td>
                <td className="px-4 py-3 text-ink-muted">Nothing locked</td>
                <td className="tnum px-4 py-3 text-right font-semibold text-ink">
                  1.0×
                </td>
              </tr>
              {TIERS.filter((t) => t.tier > 0).map((t) => (
                <tr
                  key={t.tier}
                  className="border-b border-line last:border-0"
                >
                  <td
                    className={cn(
                      "px-4 py-3 font-medium",
                      t.tier === 3 ? "text-accent" : "text-ink"
                    )}
                  >
                    {t.name}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{t.days} days</td>
                  <td
                    className={cn(
                      "tnum px-4 py-3 text-right font-semibold",
                      t.tier === 3 ? "text-accent" : "text-ink"
                    )}
                  >
                    {t.multiplier.toFixed(1)}×
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          A higher multiplier means a bigger slice of the same reserve — it
          doesn't create new rewards. If everyone locks at 2.0×, everyone's slice
          is the same as if nobody did.
        </p>
      </div>

      {/* FAQ */}
      <div className="mt-14">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          Questions
        </h2>
        <div className="mt-5 space-y-3">
          {FAQ.map((f) => (
            <Card key={f.q}>
              <CardBody className="p-5">
                <h3 className="text-sm font-semibold text-ink">{f.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {f.a}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>

      {/* The honest bit */}
      <div className="mt-14">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          What this doesn't do
        </h2>
        <Card className="mt-5 border-loss/25">
          <CardBody className="space-y-3 p-5 text-sm leading-relaxed text-ink-muted">
            <p>
              <span className="font-medium text-ink">
                It doesn't make the price go up.
              </span>{" "}
              You earn more {TOKEN_SYMBOL}, not more money. If the price falls
              faster than you earn, you're down. More tokens is not the same as
              more value.
            </p>
            <p>
              <span className="font-medium text-ink">
                It doesn't pay forever.
              </span>{" "}
              The reserve holds a finite amount. It runs down as it pays out and
              only refills from trading fees. Quiet market, slower refill.
            </p>
            <p>
              <span className="font-medium text-ink">
                It doesn't promise a percentage.
              </span>{" "}
              Any rate you see is what the reserve is paying right now, split
              across everyone currently synced. More holders means a smaller
              slice each.
            </p>
            <p>
              <span className="font-medium text-ink">
                It isn't risk-free.
              </span>{" "}
              This is a smart contract holding real money. It has been tested,
              but no contract is guaranteed. Don't put in more than you can
              afford to lose.
            </p>
          </CardBody>
        </Card>
      </div>

      <p className="mt-10 text-center text-[11px] text-ink-faint">
        Not financial advice. Do your own research.
      </p>
    </div>
  );
}
