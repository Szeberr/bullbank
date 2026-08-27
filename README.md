# BullBank

Hold BULL in your own wallet and it earns you more BULL, every second, from a
fixed on-chain reserve. Nothing is locked unless you choose to lock it, and
nothing ever leaves your wallet to earn the base rate.

This repository contains everything: the Solana program, the website, and the
automated buyback job. It is public so that nothing here has to be taken on
trust.

## How it works

1. **Buy and hold.** BULL stays in your wallet.
2. **Sync.** One transaction tells the program what you hold. It reads your
   token account directly rather than believing a number sent by the client.
3. **Earn.** Your share of a fixed emission accrues every second.
4. **Claim** whenever you like.

Locking is optional and earns more, at the cost of not being able to withdraw
until the term ends.

### Why syncing is necessary

A Solana program cannot observe a wallet balance changing — nothing notifies it.
So the holder tells it, and the program verifies by reading the account. When you
sync or claim, settlement uses `min(registered, current)`: you are paid on the
**smaller** of what you registered and what you actually hold now. Register a
large balance, sell, and come back, and you are paid on the closing balance.

## Layout

| Path | What it is |
|---|---|
| `program/` | The Anchor program. `anchor build` to reproduce it. |
| `bullbank/` | The website (Vite + React + Tailwind). |
| `crank/` | The buyback job that refills the reserve. |
| `LAUNCH_CHECKLIST.md` | Ordered launch steps and what is/isn't proven. |
| `TOKENOMICS_BULLBANK.md` | Supply and emissions. |

## The guarantees, and how to check them

**No one can withdraw the reserve.** Not the team, not an admin. There is no
instruction that does it. The program has exactly six instructions —
`initialize_pool`, `fund_rewards`, `sync`, `stake`, `unstake`, `claim` — and the
only ways tokens leave are a holder claiming rewards or withdrawing their own
locked tokens. Read `program/programs/memecoin-staking/src/lib.rs` and check.

**The rate cannot be changed.** Set once at deployment. There is no setter.

**The reserve cannot be overdrawn.** Accrual is capped at what has actually been
deposited, so the last claimer is paid like the first.

## Tests

```bash
cd program  && anchor test     # on-chain behaviour
cd bullbank && npm test        # the accrual maths the UI displays
```

The frontend deliberately reimplements the accrual formula and tests it against
the same numbers the program produces. If those two ever disagree, the site is
lying to users about their balance — which is the failure mode this project cares
most about avoiding.

Selected results:

- Sync moves nothing: balance identical before and after.
- A wallet that registered then sold 99% would have been paid 14.9999 if the
  program trusted registration. It was paid 0.16.
- An 8-token schedule, left running 25 seconds past its end, paid exactly 8.
- Two holders at 5.00:1 were paid at 5.00:1.
- Locked principal returns in full after the term, with rewards intact.

## Status

Deployed to **devnet** only. Not audited. The buyback job's safety checks are
tested but it has never claimed a real fee, because no token exists yet.

`LAUNCH_CHECKLIST.md` tracks exactly what is proven and what is not.

## Honest risks

- Rewards are paid in BULL. More tokens is not more value — the price can fall.
- The reserve is finite and refills only from trading fees. A quiet market means
  a slower refill.
- No audit yet. Do not deposit more than you can afford to lose.
- Locking is irreversible for the full term. There is no early exit and no
  override.
