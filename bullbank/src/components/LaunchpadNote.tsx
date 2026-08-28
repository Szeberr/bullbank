import { Gift, ArrowRight, ExternalLink } from "lucide-react";
import { Card, CardBody } from "./ui/card";
import { SOCIALS, TOKEN_SYMBOL, AIRDROP_PERCENT } from "../solana/config";
import { cn } from "../lib/utils";

/**
 * The launchpad and the community airdrop.
 *
 * Deliberately factual about the relationship: BullBank was created on
 * ansem.io, which issues genuine pump.fun tokens, and every coin created there
 * gives a slice of supply to $ANSEM holders. That is worth saying — it explains
 * where the token came from and why some people will find it in their wallet
 * without buying it.
 *
 * What this must never imply is endorsement, partnership or involvement. Using
 * a platform is not the same as being backed by the person who runs it, and
 * blurring that would undo every other honest thing on this site.
 */
export function LaunchpadNote({ className }: { className?: string }) {
  return (
    <Card className={cn("pointer-events-auto overflow-hidden", className)}>
      <CardBody className="p-0">
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            <Gift size={12} className="text-accent" />
            The {AIRDROP_PERCENT}% community airdrop
          </div>
        </div>

        <div className="space-y-4 px-5 py-5 text-[13px] leading-relaxed text-ink-muted">
          <p>
            {TOKEN_SYMBOL} was created on{" "}
            <a
              href={SOCIALS.launchpad}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              ansem.io
              <ExternalLink size={10} />
            </a>
            , which issues genuine pump.fun tokens. Every coin created there sets
            aside{" "}
            <span className="text-ink">
              {AIRDROP_PERCENT}% of supply for $ANSEM holders
            </span>
            , bought on the curve at creation and claimable when the token
            migrates.
          </p>

          <p>
            So a lot of people will end up holding {TOKEN_SYMBOL} without ever
            having bought it. Normally that is where an airdrop dies — you wake up
            with a token you did not choose, and the only obvious move is to sell
            it.
          </p>

          <div className="rounded-xl border border-accent-dim/40 bg-accent/[0.05] p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-accent">
              <ArrowRight size={14} />
              If you got {TOKEN_SYMBOL} in the drop
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              You are already holding the thing that earns. Connect, hit sync
              once, and it starts paying — the tokens never leave your wallet and
              nothing gets locked. You can still sell whenever you like.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-surface-2/50 p-4">
            <div className="text-[13px] font-semibold text-ink">
              Being early is worth a lot, and here is exactly why
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              The reserve pays out a fixed amount per day, split between everyone
              who has synced — so your share is your holding divided by everyone
              else's. While only a handful of people have synced, each of them
              takes a large slice of the whole daily payout. Once thousands have,
              the same wallet takes a fraction of it.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              Same tokens, same wallet — the difference is only how early you
              showed up. That is not a promotion we invented; it is just how
              splitting a fixed amount works, and you can watch it happen on the
              reserve page.
            </p>
          </div>

          <p className="text-[11px] leading-relaxed text-ink-faint">
            BullBank is not affiliated with, endorsed by, or run by ansem.io or
            $ANSEM. We used the launchpad to create the token, the same as anyone
            else can.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
