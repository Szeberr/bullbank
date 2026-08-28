import { Check, Circle, Loader2 } from "lucide-react";
import { Card, CardBody } from "./ui/card";
import { LAUNCHED, PROOF_LINKS, TOKEN_SYMBOL } from "../solana/config";
import { cn } from "../lib/utils";

/**
 * Roadmap.
 *
 * Deliberately small, and deliberately mostly finished. A roadmap of things
 * already done reads as competence; a roadmap of moonshots reads as a pitch,
 * and experienced buyers discount it accordingly.
 *
 * No dates and no price or market-cap targets. Dates get missed and become
 * evidence against you; price targets are close to a promise about something
 * nobody controls.
 *
 * Statuses derive from the same flags that drive the rest of the site, so this
 * page cannot quietly go stale while claiming things are done.
 */

type Status = "done" | "active" | "next";

interface Item {
  title: string;
  detail: string;
  status: Status;
}

function buildItems(): Item[] {
  const published = Boolean(PROOF_LINKS.source);

  return [
    {
      title: "Build the program",
      detail:
        "A rewards program where no one — including us — can withdraw the reserve. Written, and covered by 16 tests including the ones that try to break it.",
      status: "done",
    },
    {
      title: "Open the code",
      detail:
        "Everything public: the program, this site, and the buyback job. Nothing here has to be taken on trust.",
      status: published ? "done" : "next",
    },
    {
      title: "Test it end to end",
      detail:
        "Deployed to a test network and used through a real wallet. Deposits, earnings, claims and withdrawals all verified against the chain.",
      status: "done",
    },
    {
      title: "Reviewed our own code, published what we found",
      detail:
        "Three bugs found and fixed, written up in full. Worth reading — but we wrote the program, so it is not independent review and we do not present it as such.",
      status: "done",
    },
    {
      title: `Launch ${TOKEN_SYMBOL}`,
      detail:
        "Token goes live, the reserve is funded, and holding starts earning.",
      status: LAUNCHED ? "done" : "next",
    },
    {
      title: "Buyback running automatically",
      detail:
        "Trading fees are collected, used to buy BULL on the open market, and added to the reserve — on a schedule, with every run publicly logged.",
      status: LAUNCHED ? "active" : "next",
    },
    {
      title: "Make the program permanent",
      detail:
        "Give up the ability to change the program at all. After this, the rules cannot be altered by anyone, ever — including us. This is the last thing, because it cannot be undone.",
      status: "next",
    },
  ];
}

const STATUS_META: Record<
  Status,
  { label: string; icon: typeof Check; className: string; ring: string }
> = {
  done: {
    label: "Done",
    icon: Check,
    className: "text-accent",
    ring: "border-accent/40 bg-accent/10",
  },
  active: {
    label: "In progress",
    icon: Loader2,
    className: "text-ink",
    ring: "border-line-strong bg-surface-3",
  },
  next: {
    label: "Next",
    icon: Circle,
    className: "text-ink-faint",
    ring: "border-line bg-surface-2",
  },
};

export function Roadmap() {
  const items = buildItems();
  const done = items.filter((i) => i.status === "done").length;

  return (
    <div className="pointer-events-none relative z-10 mx-auto max-w-2xl px-5 pb-20 pt-12">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          The plan
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-ink-muted">
          Short, and mostly already finished. No dates we would have to miss, and
          no price targets — nobody can promise those.
        </p>
        <div className="tnum mt-4 text-[12px] text-ink-faint">
          {done} of {items.length} complete
        </div>
      </div>

      <div className="mt-12 space-y-3">
        {items.map((item, i) => {
          const meta = STATUS_META[item.status];
          const Icon = meta.icon;
          return (
            <Card key={item.title} className="pointer-events-auto">
              <CardBody className="flex gap-4 p-5">
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                      meta.ring
                    )}
                  >
                    <Icon
                      size={14}
                      className={cn(
                        meta.className,
                        item.status === "active" && "animate-spin"
                      )}
                    />
                  </div>
                  {i < items.length - 1 && (
                    <div className="mt-2 w-px flex-1 bg-line" />
                  )}
                </div>

                <div className="pb-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <h2
                      className={cn(
                        "text-[15px] font-semibold",
                        item.status === "next" ? "text-ink-muted" : "text-ink"
                      )}
                    >
                      {item.title}
                    </h2>
                    <span
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-[0.12em]",
                        meta.className
                      )}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                    {item.detail}
                  </p>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <p className="pointer-events-auto mt-10 text-center text-[11px] leading-relaxed text-ink-faint">
        This page reads its own status from the same settings that run the site,
        so it cannot claim something is done when it is not.
      </p>
    </div>
  );
}
