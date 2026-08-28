import { useState } from "react";
import { Copy, Check, ShieldCheck, ShieldAlert, ExternalLink } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/card";
import { formatUnits, formatCompact, formatDuration, shortAddress } from "../lib/format";
import {
  ADDRESSES,
  LAUNCHED,
  TOKEN_SYMBOL,
  EXPLORER_ACCOUNT,
  CLUSTER,
  PROOF_LINKS,
  CRANK_INTERVAL_HOURS,
} from "../solana/config";
import { scheduleRemaining, type PoolState } from "../solana/accrual";
import { cn } from "../lib/utils";
import idl from "../solana/idl.json";

/**
 * Transparency.
 *
 * The premise: anything asserted here should be checkable by the reader in
 * under a minute. Every address links to an explorer, every live figure is read
 * from chain, and the instruction list is generated from the program's own IDL
 * rather than typed by hand — so it cannot drift from what is deployed, and it
 * cannot flatter.
 *
 * The claim this page exists to support is "no one can take the reserve". That
 * is worth nothing as a sentence and everything as a list of every instruction
 * the program has, with what each one does.
 */

/** Plain-English description of each instruction, keyed to the IDL name. */
const WHAT_IT_DOES: Record<string, { text: string; movesFunds: string }> = {
  initialize_pool: {
    text: "Creates the reserve once, at launch, and sets the emission rate permanently.",
    movesFunds: "No",
  },
  fund_rewards: {
    text: "Adds tokens to the reserve. Anyone may call it. There is no matching withdrawal.",
    movesFunds: "Into the reserve only",
  },
  sync: {
    text: "Registers your wallet balance so it earns. Reads your token account; moves nothing.",
    movesFunds: "No",
  },
  poke: {
    text: "Anyone can refresh anyone else's registered balance to match what they actually hold. Stops someone inflating their weight and never correcting it, which would shrink everyone else's share.",
    movesFunds: "No",
  },
  stake: {
    text: "Optional. Locks your tokens for a fixed term in exchange for a higher rate.",
    movesFunds: "Your wallet → the vault",
  },
  unstake: {
    text: "Returns locked tokens to you after the term ends. Rejected before then.",
    movesFunds: "The vault → your wallet",
  },
  claim: {
    text: "Pays your accrued rewards to your wallet.",
    movesFunds: "The reserve → your wallet",
  },
};

function AddressRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-1 border-b border-line py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          {hint}
        </div>
      </div>
      {value ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={EXPLORER_ACCOUNT(value)}
            target="_blank"
            rel="noreferrer"
            className="tnum rounded-md border border-line bg-ground px-2.5 py-1.5 font-mono text-[11px] text-ink-muted transition-colors hover:border-accent-dim hover:text-accent"
          >
            {shortAddress(value, 6)}
          </a>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(value).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => {}
              );
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-faint transition-colors hover:text-accent"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
          </button>
        </div>
      ) : (
        <span className="shrink-0 text-[11px] text-ink-faint">
          Set at launch
        </span>
      )}
    </div>
  );
}

function Status({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-0">
      {ok ? (
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" />
      ) : (
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-ink-faint" />
      )}
      <div>
        <div className={cn("text-[13px] font-medium", ok ? "text-ink" : "text-ink-muted")}>
          {label}
        </div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
          {detail}
        </div>
      </div>
    </div>
  );
}

export function Transparency({
  pool,
  reserveBalance,
  nowSec,
}: {
  pool: PoolState | null;
  reserveBalance: bigint | null;
  nowSec: bigint;
}) {
  const instructions: string[] = (idl as { instructions: { name: string }[] })
    .instructions.map((i) => i.name)
    .sort();

  const perDay = pool ? pool.rewardRatePerSec * 86_400n : null;
  const runway = pool ? scheduleRemaining(pool, nowSec) : null;

  return (
    <div className="pointer-events-none relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-12">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Don't trust. Check.
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-muted">
          Everything on this page is either an address you can open in an explorer
          or a number read live from the blockchain. Nothing here is our word for
          it.
        </p>
      </div>

      {/* Live figures */}
      <Card className="pointer-events-auto mt-12">
        <CardHeader>
          <CardTitle>The reserve, right now</CardTitle>
          {CLUSTER !== "mainnet-beta" && (
            <span className="text-[10px] uppercase tracking-[0.12em] text-accent">
              {CLUSTER}
            </span>
          )}
        </CardHeader>
        <CardBody>
          {LAUNCHED && pool ? (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  Paying out
                </div>
                <div className="tnum mt-1 text-lg font-semibold text-ink">
                  {formatUnits(perDay!, { decimals: 0 })}
                </div>
                <div className="text-[10px] text-ink-faint">
                  {TOKEN_SYMBOL} per day
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  Left in reserve
                </div>
                <div className="tnum mt-1 text-lg font-semibold text-ink">
                  {reserveBalance === null ? "—" : formatCompact(reserveBalance)}
                </div>
                <div className="text-[10px] text-ink-faint">undistributed</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  Runs until
                </div>
                <div className="tnum mt-1 text-lg font-semibold text-ink">
                  {runway === 0n ? "Ended" : formatDuration(runway!)}
                </div>
                <div className="text-[10px] text-ink-faint">at the current rate</div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center">
              <div className="text-sm font-medium text-ink-muted">
                Not launched yet
              </div>
              <div className="mt-1 text-[11px] text-ink-faint">
                These figures appear here, read live from chain, the moment the
                reserve is funded.
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Addresses */}
      <Card className="pointer-events-auto mt-4">
        <CardHeader>
          <CardTitle>Every address</CardTitle>
        </CardHeader>
        <CardBody className="py-0">
          <AddressRow
            label="Program"
            value={ADDRESSES.programId?.toBase58() ?? null}
            hint="The code that holds and pays out everything. Read it on the explorer."
          />
          <AddressRow
            label={`${TOKEN_SYMBOL} token`}
            value={LAUNCHED ? ADDRESSES.tokenMint?.toBase58() ?? null : null}
            hint="The mint. Check the supply and that mint authority is revoked."
          />
          <AddressRow
            label="Reserve vault"
            value={LAUNCHED ? ADDRESSES.rewardVault?.toBase58() ?? null : null}
            hint="Holds the rewards. Its balance is the number above — verify it yourself."
          />
          <AddressRow
            label="Lock vault"
            value={LAUNCHED ? ADDRESSES.stakeVault?.toBase58() ?? null : null}
            hint="Holds tokens people chose to lock. Owned by the program, not by us."
          />
          <AddressRow
            label="Reserve account"
            value={LAUNCHED ? ADDRESSES.poolPda?.toBase58() ?? null : null}
            hint="Stores the emission rate and the schedule. All of it is public."
          />
        </CardBody>
      </Card>

      {/* Instruction list */}
      <Card className="pointer-events-auto mt-4">
        <CardHeader>
          <CardTitle>Everything the program can do</CardTitle>
          <span className="text-[11px] text-ink-faint">
            {instructions.length} instructions
          </span>
        </CardHeader>
        <CardBody>
          <p className="text-[12px] leading-relaxed text-ink-muted">
            This is the complete list, generated from the program's own interface
            file — not written by hand. There is no instruction that sends funds
            to the team, because none exists. The only ways tokens leave the
            program are a holder claiming rewards or a holder withdrawing their
            own locked tokens.
          </p>

          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line bg-surface-2/60">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    Instruction
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    Moves funds
                  </th>
                </tr>
              </thead>
              <tbody>
                {instructions.map((name) => {
                  const info = WHAT_IT_DOES[name];
                  return (
                    <tr key={name} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-[12px] text-accent">
                          {name}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                          {info?.text ?? "—"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top text-[11px] text-ink-muted">
                        {info?.movesFunds ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Guarantees, honestly stated */}
      <Card className="pointer-events-auto mt-4">
        <CardHeader>
          <CardTitle>What is and isn't guaranteed</CardTitle>
        </CardHeader>
        <CardBody className="py-0">
          <Status
            ok
            label="No one can withdraw the reserve"
            detail="Not us, not an admin, not a multisig. There is no instruction that does it — see the list above."
          />
          <Status
            ok
            label="The reward rate cannot be changed"
            detail="It is set once when the program is deployed and there is no function to alter it. Nobody can raise it to pump numbers or cut it to save money."
          />
          <Status
            ok
            label="The program cannot pay out more than it holds"
            detail="Accrual is capped at what has actually been deposited. Tested: an 8-token reserve paid exactly 8 tokens after being left running well past its schedule."
          />
          <Status
            ok
            label="Locked tokens are returned in full"
            detail="After the term ends, and with rewards earned during the lock still claimable. Tested end to end."
          />
          <Status
            ok={false}
            label="Independent audit"
            detail="There has not been one. Audits of this kind cost more than this project has, so we are not going to claim one is coming. If that ever changes the report gets published here in full, whatever it says."
          />
          <Status
            ok={false}
            label="Self-review (not a substitute)"
            detail="We reviewed our own code and published the result, including three bugs it found and fixed. The reviewer wrote the program, which is precisely the conflict of interest an independent audit removes. Read it, but do not mistake it for one."
          />
          <Status
            ok={false}
            label="Program made immutable"
            detail="The upgrade authority has not yet been revoked. Until it is, the program can be changed. This page will say so when that changes."
          />
        </CardBody>
      </Card>

      {/* Where the money comes from */}
      <Card className="pointer-events-auto mt-4">
        <CardHeader>
          <CardTitle>Where the rewards come from</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px] leading-relaxed text-ink-muted">
          <p>
            Trading {TOKEN_SYMBOL} generates creator fees, paid in SOL. An
            automated job claims those fees, uses them to{" "}
            <span className="text-ink">buy {TOKEN_SYMBOL} on the open market</span>
            , and deposits what it buys into the reserve.
          </p>
          <p>
            Two consequences worth understanding.{" "}
            <span className="text-ink">Nothing is minted</span> — the supply never
            grows, and rewards are tokens that already existed, bought back. And{" "}
            <span className="text-ink">rewards depend on trading volume</span>. A
            quiet market means a slower refill. We are not going to pretend
            otherwise.
          </p>
          <p>
            The job runs on a public schedule and every run is logged, so the
            buyback is a record you can check rather than a claim you have to
            believe.
          </p>
        </CardBody>
      </Card>

      {/* Buyback automation — flips itself at launch */}
      <Card className="pointer-events-auto mt-4">
        <CardHeader>
          <CardTitle>The buyback job</CardTitle>
          <span
            className={cn(
              "flex items-center gap-1.5 text-[11px]",
              LAUNCHED ? "text-accent" : "text-ink-faint"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                LAUNCHED ? "animate-pulse-soft bg-accent" : "bg-ink-faint"
              )}
            />
            {LAUNCHED ? "Running" : "Not started"}
          </span>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px] leading-relaxed text-ink-muted">
          {LAUNCHED ? (
            <>
              <p>
                Runs automatically every {CRANK_INTERVAL_HOURS} hours: claim
                creator fees, buy {TOKEN_SYMBOL} with the SOL, deposit it into
                the reserve. Nobody has to remember to do it.
              </p>
              {PROOF_LINKS.crankLog ? (
                <a
                  href={PROOF_LINKS.crankLog}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"
                >
                  See every run that has ever happened
                  <ExternalLink size={11} />
                </a>
              ) : (
                <p className="text-ink-faint">
                  The public run log will be linked here.
                </p>
              )}
            </>
          ) : (
            <>
              <p>
                The job is written and its safety checks are tested, but it has{" "}
                <span className="text-ink">never claimed a real fee</span> — there
                is no token yet, so there are no fees anywhere to claim. It starts
                at launch and will then run every {CRANK_INTERVAL_HOURS} hours
                without anyone touching it.
              </p>
              <p>
                What is already proven: it refuses to sign any transaction that
                would reduce the wallet balance, even though a third-party service
                builds that transaction. That check fired on its first test run
                and blocked a transaction that would have cost SOL and returned
                nothing.
              </p>
              <p className="text-ink-faint">
                This box will show live run history once the job is live. If it
                ever says "Running" while the log shows nothing recent, something
                is wrong and you should ask us about it publicly.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      {/* Source and audit */}
      <Card className="pointer-events-auto mt-4">
        <CardHeader>
          <CardTitle>Read the code yourself</CardTitle>
        </CardHeader>
        <CardBody className="py-0">
          <div className="flex items-center justify-between gap-4 border-b border-line py-3">
            <div>
              <div className="text-[13px] font-medium text-ink">Source code</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                The program, this site and the buyback job.
              </div>
            </div>
            {PROOF_LINKS.source ? (
              <a
                href={PROOF_LINKS.source}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition-colors hover:border-accent-dim hover:text-accent"
              >
                Open
              </a>
            ) : (
              <span className="shrink-0 text-[11px] text-ink-faint">
                Not published yet
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 border-b border-line py-3">
            <div>
              <div className="text-[13px] font-medium text-ink">Our own security review</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                What we found reviewing our own code. Not independent.
              </div>
            </div>
            {PROOF_LINKS.source ? (
              <a
                href={PROOF_LINKS.source + "/blob/main/SECURITY_REVIEW.md"}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition-colors hover:border-accent-dim hover:text-accent"
              >
                Read it
              </a>
            ) : (
              <span className="shrink-0 text-[11px] text-ink-faint">Not published</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-[13px] font-medium text-ink">Independent audit</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                None yet. Published in full if there ever is one.
              </div>
            </div>
            {PROOF_LINKS.audit ? (
              <a
                href={PROOF_LINKS.audit}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition-colors hover:border-accent-dim hover:text-accent"
              >
                Read it
              </a>
            ) : (
              <span className="shrink-0 text-[11px] text-ink-faint">
                Not funded
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* What was actually tested */}
      <Card className="pointer-events-auto mt-4">
        <CardHeader>
          <CardTitle>What we tested, and what it showed</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-[12px] leading-relaxed text-ink-muted">
            Real numbers from the test suite, not a checklist of adjectives.
          </p>
          <div className="mt-4 space-y-2.5">
            {[
              [
                "Holding never moves your tokens",
                "Balance before sync: 490,000,000. After: 490,000,000. Identical.",
              ],
              [
                "The number on screen is what you get",
                "The dashboard predicted 12.9997 and the chain paid 13.9998 — slightly more, because settlement lands a moment after the reading. Never less.",
              ],
              [
                "Selling stops the rewards",
                "A wallet that registered a balance then sold 99% of it would have been paid 14.9999 if the program trusted the registration. It was paid 0.16.",
              ],
              [
                "The reserve cannot be overdrawn",
                "An 8-token schedule, left running 25 seconds past its end, paid out exactly 8 tokens.",
              ],
              [
                "Rewards split fairly",
                "Two holders at a 5.00:1 ratio were paid at 5.00:1.",
              ],
              [
                "Locked tokens come back",
                "Full principal returned after the term, with rewards earned during the lock still claimable.",
              ],
            ].map(([claim, evidence]) => (
              <div
                key={claim}
                className="rounded-lg border border-line bg-surface-2/40 p-3"
              >
                <div className="text-[12px] font-medium text-ink">{claim}</div>
                <div className="tnum mt-1 text-[11px] leading-relaxed text-ink-faint">
                  {evidence}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
            Tests prove the code does what it was written to do. They do not prove
            the code was written correctly in the first place — that is what the
            audit is for, and it is not finished.
          </p>
        </CardBody>
      </Card>

      <p className="pointer-events-auto mt-8 text-center text-[11px] leading-relaxed text-ink-faint">
        If anything on this page does not match what you find on the explorer,
        that is a bug or worse — tell us publicly.
      </p>
    </div>
  );
}
