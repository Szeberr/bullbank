# BullBank — launch checklist

Ordered. Do not reorder — several steps are irreversible and depend on the one
before.

## Source

https://github.com/Szeberr/bullbank — public.

## Current state

| | |
|---|---|
| Program | `BLj7FScr8f57ygqFGJJtZ3sVRCx7C7gUQihyUWYptBYq`, deployed to **devnet** |
| On-chain tests | 12 passing + 4 withdrawal tests |
| Frontend tests | 15 passing |
| Live wallet test | Passed — connect, sync, claim, lock all executed from Phantom |
| Mainnet | Nothing deployed |
| Audit | **Not started** |

### What is proven

- `sync` registers a wallet balance and moves no tokens (verified on devnet: balance identical before and after)
- Accrual is continuous and the displayed figure equals the payout (predicted 12.9997, paid 13.9998)
- Selling after syncing collapses the payout (would have paid 14.9999, paid 0.16)
- Locked principal is returned in full once the term expires, and rewards accrued while locked survive the withdrawal
- The reserve can never be overdrawn (paid exactly 8 of an 8-token schedule after waiting 25s)
- Emissions split exactly in proportion to holdings (5.00:1 holdings produced 5.00:1 payout)
- No instruction exists that moves funds to an admin — asserted by test, not by claim

### What is not proven

- Nothing has ever run on mainnet
- The crank's **fee-claim step is unimplemented** — see below
- No audit
- Mobile browsers untested

---

## Before launch

### 1. Audit — decided against, at this budget
An independent audit costs more than the whole launch. **Decision: not doing
one.** What was done instead is in `SECURITY_REVIEW.md`: `cargo audit`,
`cargo clippy`, and a manual pass that found and fixed three bugs.

That is genuinely weaker, and the site says so rather than implying an audit is
pending. The emissions accrual and the `min(registered, current)` settlement
remain the newest and most consequential code, and both critical bugs found so
far were in exactly that area — so treat that as the known risk, not as
something that has been cleared.

Nothing on the site or in the socials may describe the project as audited.

### 2. Finish the crank
`crank/buyback.ts` claims fees → buys BULL → funds the reserve. The buy and fund
legs are complete and guarded. **Claiming pump.fun creator fees is not
implemented** — it needs a third-party API (PumpPortal or the pump.fun SDK) to
build the transaction, and that transaction must be deserialised and inspected
before signing. Until then, fees must be claimed manually and the crank run
afterwards.

Also verify on the first dry run: Jupiter's `priceImpactPct` is treated as a
fraction. If it is already a percentage, that guard is 100x too loose.

### 3. Legal review
Paying holders for holding sits closer to a securities-style profit expectation
than deposit-based staking. This should be reviewed before launch, not after.

### 4. Decide the emission rate
**Permanent once `initialize_pool` runs.** There is no setter. Set it low enough
that normal trading volume comfortably outruns it, or the schedule runs dry and
accrual pauses until the next buyback.

---

## Launch day, in order

1. **Deploy the program to mainnet.** Back up
   `target/deploy/memecoin_staking-keypair.json` first — it is the program's
   identity and cannot be regenerated.
2. **Create the token on ansem.io.** Name, ticker, description and image are
   written on-chain and can never be changed.

   **Decided:** FREE tier, **30,000,000 airdrop (the 3% minimum)**, **no dev buy**.

   | | SOL |
   |---|---|
   | Community airdrop buy (30M) | 0.874 |
   | Gas reserve | 0.060 |
   | **Total** | **0.951** |

   Gold and Diamond tiers need ~$35.8k and ~$143k of $ANSEM burned — out of
   budget, so FREE it is. The airdrop slider sets how many of OUR tokens are
   bought on the curve and given to $ANSEM holders; the minimum keeps the cost
   down and limits the free-supply overhang at migration. No dev buy is needed
   because the reserve is funded by buybacks, not by a launch allocation.
3. **Run `init-pool-bullbank.ts init`.** This locks the emission rate forever.
4. **Run `fund`** to move the first buyback into the reserve.
5. **Update `bullbank/.env`** with the mint, pool PDA and both vault addresses
   from `pool-addresses.json`, plus a production RPC URL.
6. **Set `VITE_LAUNCHED=true`.** This one flag reveals the contract address and
   every reserve figure at once. Leave it false and the site correctly presents
   itself as pre-launch.
7. **Build and deploy the site.** `npm run build`, publish `dist/`.
8. **Verify on the live site before announcing:** the CA matches the real mint,
   the reserve figures are non-zero, and a small test wallet can sync and claim.
9. **Announce.**

### Ordering traps

- The pool PDA derives from the mint, so **the token must exist before step 3** —
  but the token going live means people can buy immediately. Do not create it
  until the program is deployed, audited and the site is ready.
- Between steps 3 and 4 the pool exists but pays nothing. That is expected. Do
  not announce during that window.

---

## Hosting

Cloudflare Pages, connected to the GitHub repo so every push to `main`
redeploys. Settings:

| Field | Value |
|---|---|
| Root directory | `bullbank` |
| Build command | `npm run build` |
| Output directory | `dist` |

**Every `VITE_*` value is compiled into the JavaScript bundle and is public.**
Not a secret store — anyone can read them in devtools. So the deployed build
uses the free public RPC rather than the Helius key, which would otherwise be
scraped and drained.

Pre-launch environment variables:

```
VITE_SITE_URL=https://bullbank.pages.dev
VITE_RPC_URL=https://api.devnet.solana.com
VITE_CLUSTER=devnet
VITE_PROGRAM_ID=BLj7FScr8f57ygqFGJJtZ3sVRCx7C7gUQihyUWYptBYq
VITE_TOKEN_MINT=2Em69puVvwyjMgKDwVbd1kKwEAcLg8yWzLPcF5u5Fqdu
VITE_POOL_PDA=9xP363ZbhVRJHJPrpm8X1JKYogszhQQPMdBtZaZ8VQL
VITE_STAKE_VAULT=7xbKLjo9yvqEy2wqPG1GyAHw6pdEdVWNf4H55dfiqpnT
VITE_REWARD_VAULT=J3rGgompojN27DZovjP3rwj5dS5tgfSFVivD9MeDDMMj
VITE_TOKEN_DECIMALS=6
VITE_LAUNCHED=false
VITE_SOURCE_URL=https://github.com/Szeberr/bullbank
VITE_CRANK_LOG_URL=https://github.com/Szeberr/bullbank/actions
VITE_CRANK_INTERVAL_HOURS=6
VITE_AIRDROP_PERCENT=3
```

The site is deliberately on devnet until launch, and the DEVNET badge in the
header says so. It is a working preview, not a live product, and it should not
pretend otherwise.

At launch, swap `VITE_RPC_URL` to a **fresh** Helius mainnet key restricted to
the site domain, `VITE_CLUSTER` to `mainnet-beta`, the four addresses to the
mainnet ones, and `VITE_LAUNCHED` to `true`. Set `VITE_SITE_URL` to the real
domain the moment there is one, or the share card breaks.

### Still outstanding
- Helius key `faedf721-1bca-40bf-bb14-c9b9e1aeeaef` was exposed and has still
  not been revoked.
- Key `990b54b4-…` was also pasted in plain text. Rotate before mainnet.

## Post-launch

- Rotate the Helius key used during development and restrict the production key
  by domain.
- Schedule the crank (cron / GitHub Action / small VM). Run it in dry-run first
  and read the output before ever passing `--execute`.
- Sweep the creator-fee wallet regularly — it is a hot wallet the crank signs
  with, and it should not accumulate.

## Still worth doing

- Mobile pass — the layout has never been checked below ~380px.
- An OG image, so shared links do not render as a grey nothing.
- Update the socials on any remaining old material — the retired single-file site
  still links to the DiamondHands GitHub and Twitter.
