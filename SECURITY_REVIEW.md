# BullBank — internal security review

**This is not an audit.** It was carried out by the same party that wrote the
code, which is exactly the conflict of interest an audit exists to remove. Treat
it as a second careful pass, not as independent assurance. Nobody outside the
project has reviewed this program.

Date: 2026-08-28
Scope: `program/programs/memecoin-staking/src/lib.rs` (~500 lines, 7 instructions)

---

## Automated checks

| Tool | Result |
|---|---|
| `cargo audit` | **No vulnerabilities.** 459 dependencies scanned. 7 warnings, all "unmaintained crate" notices on transitive dependencies of the Solana/Anchor stack (`ansi_term`, `bincode`, `derivative`, `libsecp256k1`, `paste`, plus unsoundness notes on `anyhow` and `rand`). None are reachable from this program's logic and none are ours to fix. |
| `cargo clippy` | One warning, from Anchor's own `#[program]` macro (deprecated `realloc`). No findings in project code. |

---

## Findings

### 1. Flash-loan weight inflation could permanently dilute every holder
**Severity: medium (griefing, no profit to the attacker) — FIXED**

Registered weight only shrank when the holder themselves called `sync`. So:

1. Borrow a large balance
2. `sync` — registering enormous weight
3. Return the borrowed tokens
4. Never sync again

The attacker earns nothing — `min(registered, current)` sees to that. But the
inflated weight stays in `total_weighted` **forever**, and since every holder's
share is their weight divided by that total, everyone else earns permanently
less. One transaction, indefinite harm, and no way for anyone to undo it.

**Fix:** added a `poke` instruction that anyone may call on anyone's position. It
re-reads the owner's token account and corrects the registered weight. Making it
permissionless is safe because the balance comes from the chain — a caller
cannot make it say anything other than the truth, and settlement still uses
`min(registered, current)`, so poking someone can neither overpay them nor take
what they have already earned.

Tested: `total weight 2000 -> 1000 after poke`.

### 2. A pool created with two different mints would be permanently broken
**Severity: low (misconfiguration, but irreversible) — FIXED**

`initialize_pool` accepted a `stake_mint` and a `reward_mint` without requiring
them to match. But `claim` sends `reward_mint` to a token account constrained to
`stake_mint`, so `TransferChecked` would reject every claim. A pool created that
way would accept deposits and then never pay anyone, with no way to correct it —
initialisation happens once and there is no setter.

**Fix:** `require_keys_eq!(stake_mint, reward_mint)` at initialisation.

### 3. Partial withdrawals left dust weight earning on nothing
**Severity: low — FIXED**

Weight is `floor(amount × multiplier)`. Because
`floor(a·m) + floor(b·m) ≤ floor((a+b)·m)`, withdrawing in several parts removed
slightly less weight than the deposit added. A fully emptied position could keep
a few base units of weight and carry on earning forever with nothing locked.

Not economically exploitable — each partial withdrawal costs a transaction fee
and yields at most one base unit of weight — but it is wrong, and it slowly
corrupts `total_weighted`.

**Fix:** when a withdrawal takes the balance to zero, the remaining weight is
removed with it.

Tested with a deliberately awkward amount (1,003.000007 tokens withdrawn in two
uneven parts): `balance 0, weight 0`.

---

## Considered and found not to be issues

**Missing mint constraint on `owner_ata` in `stake` / `unstake`.** The accounts
only check ownership, not mint. Defended by `TransferChecked`, which rejects a
mismatched mint at the token-program level. Left as is, but worth knowing the
defence is one layer deep rather than two.

**Arithmetic overflow in `update_pool`.** `elapsed × rate × ACC_PRECISION` looks
risky in isolation, but `elapsed` is capped at `reward_end_time`, and
`reward_end_time` only advances by `amount / rate` — so `elapsed × rate` can
never exceed the total ever funded. Comfortably inside `u128`.

**Non-canonical token accounts in `sync`.** A holder may pass any token account
they own for the right mint, not necessarily their associated one. Not
exploitable: there is one position per owner, and moving tokens out of the
registered account reduces the payout via `min()`.

**Reinitialisation via `init_if_needed`.** Position identity is bound by PDA
seeds (pool + owner + tier), and the program never assumes zeroed state, so a
re-init cannot forge a position belonging to someone else.

**Sync-then-claim in one transaction.** Settlement is driven by accumulator
delta, which is ~0 over zero elapsed time. No value extractable.

**Stale weight from honest holders who sell without syncing.** Inflates the
denominator, so slightly *less* is distributed than the schedule allows. Errs
toward over-collateralisation, which is the safe direction — and `poke` now
lets anyone correct it.

---

## Known and deliberate

**Adding to a locked position restarts the full term** on the combined balance.
This is a footgun, not a bug. The UI warns about it and requires an explicit
acknowledgement before any lock deposit.

**No way to close a position and reclaim rent.** Minor, costs the user a
fraction of a cent, no security impact.

---

## What this review does not cover

- Economic design. Whether the emission rate is sustainable is not a code question.
- The buyback crank (`crank/buyback.ts`), which is off-chain and separately documented.
- Anything about the Anchor framework or the Solana runtime itself.
- **Whatever I failed to think of.** That is the entire reason independent review
  exists, and it has not happened here.

## Status after this review

15 on-chain tests passing with production constants, plus 4 withdrawal tests run
against a short-lock build. All three findings fixed and covered by tests.
