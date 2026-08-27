# 🐂 BullBank — Tokenomics

> **DRAFT — two numbers are assumptions, not decisions.** The emissions allocation
> (20%) and the emission period (2 years) below were chosen as defaults so the code
> could be built and tested. Confirm or change them before running
> `init-pool-bullbank.ts`. **The emission rate is permanent once that script runs** —
> the program has no instruction to change it.

## Overview

| Property | Value |
|----------|-------|
| Token Name | BullBank |
| Ticker | $BULL |
| Blockchain | Solana |
| Total Supply | 1,000,000,000 (1 Billion) — fixed, no mint authority |
| Launch Platform | TBD (see "Launch platform" below) |
| Mint Authority | Revoked at launch |
| Freeze Authority | None |
| Transfer Tax | 0% |
| Staking Rewards | Paid in $BULL from a fixed emissions pool |

---

## Distribution

| Allocation | Amount | % |
|------------|--------|---|
| Public launch | 800,000,000 | 80% |
| Staking emissions pool | 200,000,000 | 20% |
| Team | 0 | 0% |
| Advisors / presale | 0 | 0% |

**Read this part carefully, because it differs from the DiamondHands model.**

Rewards are paid in BULLBANK, which means the tokens paid to stakers have to come
from somewhere. They come from a 20% allocation set aside at launch. This is a real
allocation — it is *not* a 100% fair launch, and any marketing that claims otherwise
would be false.

What is true, and verifiable on-chain:

- The 20% goes into a program-owned vault at launch and **cannot be withdrawn by
  anyone, including us**. There is no admin instruction that moves tokens out of it.
- It can only ever leave that vault through a staker calling `claim`.
- It is released on a fixed, permanent schedule — not at anyone's discretion.
- The remaining 80% goes to the public launch with no team wallets and no presale.

That is a weaker claim than "0% allocation" but it is the honest one.

---

## Staking Rewards

### Where rewards come from

A fixed emissions pool. At launch, 200,000,000 BULL is deposited into the staking
program's reward vault. The program releases it at a constant rate, split across all
stakers in proportion to their lock-weighted stake.

| | |
|---|---|
| Emissions allocation | 200,000,000 BULL |
| Emission period | ~2 years |
| Release rate | ~3.171 BULL per second |
| Per day | ~273,973 BULL |

When the pool runs dry, emissions stop. The program does not mint, and it cannot pay
out tokens that were never deposited — accrual is capped at the funded schedule, so
the last staker to claim is paid exactly like the first.

### Lock tiers

| Tier | Lock Period | Multiplier | Reward weight |
|------|-------------|------------|---------------|
| 0 | 7 days | 1.0× | Base |
| 1 | 14 days | 1.2× | +20% |
| 2 | 30 days | 1.5× | +50% |
| 3 | 60 days | 2.0× | Double |

Multipliers redistribute a fixed pool — they never create new rewards. If you hold
2.0× and someone else holds 1.0× with the same stake, you receive exactly twice their
share of the same emissions.

### One position per tier per wallet

Each wallet can hold up to four positions, one per tier. Staking the same tier again
adds to that position and **resets its lock to the full tier period**.

### Claiming and unstaking

- **Claim anytime.** Rewards are never locked, even while principal is.
- **Principal is hard-locked** until the tier period expires. There is no early exit,
  no penalty option, and no admin override.
- Unstaking does not forfeit unclaimed rewards — they stay claimable.

---

## Launch platform

The intended launchpad is unconfirmed. Before committing, three things need to be
verified about whichever platform is used:

1. **Does it allow a creator allocation at launch?** If 100% of supply goes to a
   bonding curve, there is no 20% to fund the emissions pool with, and the model
   above cannot be executed as written.
2. **What are the fee mechanics?** Not required for emissions, but it determines
   whether a buyback model is available later.
3. **Does the token graduate to a standard AMM pool?** Affects listings and routing.

If (1) is not possible, the alternative is to acquire the emissions allocation on the
open market after launch and fund the vault with it. That preserves the fair-launch
claim but costs real money.

---

## The honest downside of emissions

Every reward token that pays in its own supply faces the same dynamic, and pretending
otherwise is how these projects lose people money:

- **Emissions are sell pressure.** Tokens paid to stakers are frequently sold. That is
  not cynicism, it is the observed behaviour of every farm since 2020.
- **The headline APY is denominated in BULL.** If the price falls faster than rewards
  accrue, a large percentage yield is still a loss in real terms.
- **This is dilution, not revenue.** Unlike a fee-funded model, no outside money enters
  the system. Rewards are a transfer from future holders to current stakers.

What limits the damage here: the rate is fixed and cannot be raised, the pool is
finite and cannot be topped up from thin air, and the schedule is visible on-chain
from day one. There is no discretionary emissions lever to pull when the price drops —
which is exactly the lever that turns farms into death spirals.

---

## Trust guarantees (verifiable on-chain)

| Guarantee | Status |
|-----------|--------|
| Mint authority revoked | At launch |
| Freeze authority | Never set |
| Transfer tax | 0% |
| Team allocation | 0% |
| Emissions allocation | 20%, locked in program vault, no withdraw path |
| Emission rate changeable | No — no such instruction exists |
| Admin withdraw from any vault | Impossible — no such instruction exists |
| Staked principal recoverable by team | Impossible |
| Program upgrade authority | Multisig + timelock before mainnet, immutable after audit |
| Audit | **Not started** |

---

## Honest risks

- **Dilution.** See above. This is the central tradeoff of the model.
- **Smart contract risk.** The program passes its test suite, including a solvency
  test, but it has **not been audited**. A real bug was found in the emissions
  accrual during testing. Do not stake funds you cannot afford to lose.
- **Hard locks are hard.** There is no early unstake. If you lock for 60 days, the
  tokens are inaccessible for 60 days regardless of what the price does.
- **This is a memecoin.** It can go to zero.

*Not financial advice. Do your own research.*
