# BullBank — Status & Handoff

> **Superseded in part.** The frontend was rebuilt as a React app in `bullbank/`.
> The single-file `index.html` work described further down is retired — see
> `bullbank/README.md`. The program, tokenomics and launch sections below remain
> current.
>
> **Launchpad confirmed:** ansem.io issues *genuine pump.fun tokens*. It does not
> offer a creator allocation; the only lever is an optional **dev buy** at launch.
> See "Funding the reserve" below.

Derived from the DiamondHands staking work in `PROJECT_STATUS_1.md`. The tier, lock
and accumulator logic is carried over; the reward asset changed from native SOL to
the project's own token, funded by a fixed emissions pool.

## What changed vs DiamondHands

| | DiamondHands | BullBank |
|---|---|---|
| Reward asset | Native SOL | $BULL (same mint as the stake token) |
| Reward source | pump.fun creator fees | Fixed emissions allocation (20% of supply) |
| Funding cadence | Daily off-chain crank | One deposit at launch; **no crank needed** |
| Reward rate | Deposit-driven, variable | Fixed per-second rate, permanent |
| Reward vault | Native SOL PDA | SPL token account owned by the pool PDA |
| Program ID | `9naSqjFz…` | `BLj7FScr8f57ygqFGJJtZ3sVRCx7C7gUQihyUWYptBYq` |

The daily crank is obsolete. Emissions accrue from the chain clock, so
`crank.ts` / `crank-mainnet.ts` are not used by this design.

## Files

| File | Purpose |
|---|---|
| `lib_bullbank.rs` | The program |
| `staking_bullbank.ts` | Test suite (9 passing) |
| `init-pool-bullbank.ts` | `init` creates the pool, `fund` starts emissions |
| `index.html` | Frontend, repointed and rebranded |
| `TOKENOMICS_BULLBANK.md` | Tokenomics — **contains two unconfirmed assumptions** |

Anchor workspace: `~/bullbank-staking` (WSL). Builds clean, tests pass.

**Back up `~/bullbank-staking/target/deploy/memecoin_staking-keypair.json`.**
That keypair *is* the program's identity. Lose it and the program can never be
upgraded or redeployed to the same address.

## Design decisions (locked in code)

- **Rate is per-second and immutable.** Set once in `initialize_pool`. There is no
  `set_reward_rate` instruction — deliberately, since that would be a lever to
  inflate stakers' rewards away.
- **Emissions cannot outrun the vault.** `fund_rewards` extends `reward_end_time` by
  `amount / rate`; accrual only counts time up to that point. The pool can never owe
  more than it holds.
- **Stake vault and reward vault must be different accounts.** Stake mint == reward
  mint here, so sharing one vault would pay emissions out of staker principal. The
  program rejects it at init (`VaultsMustDiffer`).
- **No admin withdraw path anywhere.** Asserted by a test.
- **Idle time is forfeited, not banked.** Seconds that pass with nothing staked are
  consumed from the schedule but not distributed. Those tokens stay in the vault
  permanently. This errs toward over-collateralisation.

## Bugs found and fixed during this work

1. **Phantom emissions across an unfunded gap (program, critical).** `update_pool`
   left `last_update_time` stale when nothing accrued. Funding a pool that had been
   idle since deployment then measured emissions from *pool creation*, paying out
   rewards that were never deposited. With a real launch gap of days, early claimers
   would have drained the vault and everyone else's claims would have failed. Fixed
   by restarting the clock in `fund_rewards`. Caught by the solvency test.
2. **Top-level `new solanaWeb3.PublicKey(...)` (frontend, critical).** The Solana
   library is injected by a dynamically appended `<script>`, so it cannot be loaded
   while the inline block is parsing. The constructor threw on every page load,
   aborting the rest of the script and leaving `IX_STAKE`, the vault addresses and
   the ATA program in the temporal dead zone — every stake/claim click failed.
   Fixed with a lazy accessor plus `waitForWeb3()`.
3. **Stake amount not scaled by decimals (frontend).** The whole-token input was
   passed straight into a `u64` the program reads as base units, so staking
   "1,000,000" actually staked 1 token.
4. **`unstake` encoded a tier byte where the program expects a `u64` amount
   (frontend).** Undeserialisable. Never noticed because nothing called it.
5. **No unstake UI existed at all.** Users could stake and claim but never withdraw
   principal. Added, gated on lock expiry.
6. **Fabricated reward drip (frontend).** `pending += drip` invented reward growth
   client-side between refreshes. Replaced with the real figure, projected from the
   on-chain accumulator and emission rate.
7. **Vacuous test in `staking_tiers.ts`.** `assert.fail` inside a `try` was swallowed
   by its own `catch`, so the test passed no matter what. `PROJECT_STATUS_1.md`'s
   claim that re-staking a tier is rejected is false — `init_if_needed` means it adds
   to the position. The new suite asserts actual behaviour and checks specific error
   names instead of catching everything.

## Funding the reserve (ansem.io findings)

From the live create page at `ansem.io/launch/create`:

- Tokens are **genuine pump.fun tokens**, live on mainnet at creation. So: standard
  SPL Token (not Token-2022), 6 decimals, pump.fun bonding curve, and **pump.fun
  creator fees still exist**.
- A **community-airdrop buy is mandatory** — minimum 30M tokens (~3% of supply,
  ~0.87 SOL at the 50M setting), bought on the fresh curve for $ANSEM holders and
  claimable at migration.
- A **dev buy is optional**, set at the launch step.
- Launch tiers: Free / Gold (25,000 $ANSEM) / Diamond (100,000 $ANSEM). Enhanced
  token page is 0.5 SOL. Gas reserve ~0.031 SOL.
- Name, ticker, description and image are written on-chain and immutable.

**Consequence for the emissions model:** there is no creator allocation to reserve.
100% of supply enters the bonding curve. The only way to obtain the 20% emissions
allocation is to buy it on the curve via the dev buy — with real SOL, at a price
that rises as you buy, and visibly as a large dev holding.

Three options, in order of how well they fit what the launchpad actually offers:

1. **Creator-fee buyback.** Creator fees arrive as SOL (pump.fun mechanics are
   intact). A crank buys BULL on the market and calls `fund_rewards`. Pays stakers
   in BULL as required, needs no launch allocation, no dev buy, and no dilution.
   `fund_rewards` is already permissionless and repeatable, so the deployed program
   supports this unchanged — only the emission rate is fixed, and top-ups simply
   extend `reward_end_time`.
2. **Smaller dev buy.** Buy 5% rather than 20% and run a shorter schedule. Cheaper
   and less conspicuous, but still a dev bag and still real SOL.
3. **Full 20% dev buy.** Executes the tokenomics doc as written. Most expensive,
   and hardest to defend publicly.

Option 1 is the recommendation. Note it makes the reward rate depend on trading
volume again — the honest framing is closer to the original DiamondHands model,
except payouts are in BULL instead of SOL.

## Still open

**Decisions needed before launch:**
1. **Emissions allocation % and period.** Defaults are 20% / 2 years. Permanent once
   `init` runs.
2. **Launch platform.** Unverified. The blocking question is whether it allows a
   creator allocation at launch — without one there is nothing to fund the pool with.
3. **Token decimals.** `TOKEN_DECIMALS` in `index.html` and `DECIMALS` in
   `init-pool-bullbank.ts` are both set to 6. Verify against the real mint.

**Work not done:**
- Frontend still has `REPLACE_WITH_…` placeholders for mint, pool PDA and both
  vaults. Fill from `pool-addresses.json` after running `init`.
- **The price chart is fake.** `drawChart()` plots `Math.random()` data under a
  "DexScreener" label. The static price/percentage text was neutralised, but the
  chart itself still renders invented market data. Wire it to a real price feed or
  remove the window.
- **External links still point at DiamondHands** — `github.com/Szeberr/Diamondhands`
  and `x.com/DiamondStaking`, in the desktop icons, the start menu and the about
  window. Update to BullBank's own.
- No devnet deploy. Localnet only.
- **No audit.** The emissions accrual is new code and it is where the critical bug
  was found. Audit before mainnet.
- Legal review — staking-yield structures draw regulatory scrutiny.

## Guiding principle (unchanged)

Ideas are not the bottleneck — shipping is. Finish this, audited, before starting
anything else.
