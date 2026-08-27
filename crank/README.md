# BullBank buyback crank

```
creator-fee SOL  →  buy BULL on the open market  →  fund_rewards  →  holders accrue
```

No new tokens are minted. The reserve refills by buying BULL that already
exists, using fees the token itself generated.

## Running it

```bash
npm install
cp .env.example .env      # fill in from pool-addresses.json
npx tsx buyback.ts        # DRY RUN — shows what it would do, sends nothing
npx tsx buyback.ts --execute
```

**Every run is a dry run unless `--execute` is passed.** Do a dry run first,
every time you change config.

## The three steps

**1. Claim creator fees** — asks PumpPortal's *local* endpoint for an unsigned
transaction (`action: collectCreatorFee`). The Lightning endpoint would be
simpler but requires giving them an API key tied to a wallet they custody; this
way they never see a key.

**2. Buy BULL** — Jupiter quote, then swap.

**3. Fund the reserve** — deposits the tokens that actually arrived.

## Safety

The crank spends real money using a transaction a third party built. Verified
before anything is signed:

| Check | Why |
|---|---|
| Dry run by default | `--execute` is the only way to send |
| Wallet is the sole signer | Anything else means the request was not what we asked for |
| **Simulated balance must go UP** | A claim pays us. Any transaction that reduces the balance is refused — regardless of what instructions it contains |
| Small loss = nothing to claim | The ordinary case. Skips quietly instead of failing a cron |
| Large loss = hard stop | Treated as hostile |
| Jupiter output mint must equal BULL | Otherwise the reserve budget buys someone else's token |
| Price impact ceiling | Refuses to move the market more than `MAX_PRICE_IMPACT_PCT` |
| Gas reserve | The wallet can always afford the next run |
| `MAX_SPEND_SOL` | One misconfigured run cannot drain the wallet |
| Deposits the measured delta | `fund_rewards` is never told a number the wallet did not receive |

The balance check is the important one. It does not require recognising every
instruction a third party might include — it just asks whether we end up richer.
A claim that does not pay is not a claim.

**Verify on the first mainnet dry run:** Jupiter's `priceImpactPct` is treated
here as a fraction (`0.01` = 1%). If it is already a percentage, that guard is
100× too loose. The dry run prints the computed figure — compare it against the
same trade in Jupiter's UI before ever using `--execute`.

## Automation

`.github-workflow-crank.yml` runs it every 6 hours. Copy it to
`.github/workflows/crank.yml`.

Required secrets: `CRANK_KEYPAIR_JSON`, `RPC_URL`, `TOKEN_MINT`, `POOL_PDA`,
`REWARD_VAULT`, `PROGRAM_ID`.

**This puts a hot wallet key in GitHub Secrets.** Anyone with write access to the
repo can exfiltrate it via a workflow, so restrict who can push and require
review on workflow changes. Keep only operating funds in that wallet. If the
balance ever becomes serious, move the crank to a machine you control.

The upside: every run is logged publicly, which is a continuous, verifiable
record that the buyback is real.

## Config

| Variable | Default | Meaning |
|---|---|---|
| `GAS_RESERVE_SOL` | 0.05 | Never spent |
| `MIN_SPEND_SOL` | 0.02 | Below this, let fees accumulate |
| `MAX_SPEND_SOL` | 5 | Ceiling per run |
| `SLIPPAGE_BPS` | 150 | 1.5% |
| `MAX_PRICE_IMPACT_PCT` | 3 | Refuse above this |
| `PRIORITY_FEE_SOL` | 0.000001 | Used when building the claim |

## Status

The claim and buyback legs are implemented and the guards are tested — a devnet
dry run correctly refused a transaction that would have cost SOL and returned
nothing, then reported "no creator fees to claim" once the dust threshold was in
place.

**Not yet run against mainnet with real fees.** Do a dry run there first and read
every line before passing `--execute`.
