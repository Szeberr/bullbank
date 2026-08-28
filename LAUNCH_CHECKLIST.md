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
| Audit | **Not doing one** — see below |

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
- The crank has never run against a real mint (none exists yet)
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

### 2. The crank — complete, and its two open risks are now closed
`crank/buyback.ts` claims fees → buys BULL → funds the reserve. All three legs
are implemented and guarded.

The fee claim uses PumpPortal's local endpoint, so no API key and no custody of
a key by anyone else. The returned transaction is verified before signing:
our wallet must be the only required signer, the transaction must simulate
cleanly, and the simulated post-balance must be **higher** than the pre-balance.
That last check is the strong one — a claim by definition pays us, so anything
that drains the wallet fails it whatever instructions it contains, with no need
to recognise them individually. A small loss is treated as the ordinary "no fees
accrued yet" case; a large one aborts the run loudly.

**Two risks that were open here have been resolved:**

- `priceImpactPct` is a fraction, not a percentage — confirmed against the live
  API (a 100 SOL quote returns `0.0000142…`, i.e. 0.0014%). The x100 in the
  guard is correct. It was never 100x too loose.
- **`quote-api.jup.ag/v6` is dead.** It still resolves as a name but publishes
  no A records, so calls fail with a DNS error rather than an HTTP status. The
  buyback leg would have failed on its first real run. Now pointed at
  `lite-api.jup.ag/swap/v1`, verified end to end: the quote returns every field
  the crank reads, and the swap build returns a parseable transaction.

Still untested: the claim path has never run against a real mint with real fees,
because no mint exists yet. Run it in dry-run mode first — it is dry by default
and `--execute` is the only way to spend anything.

### 3. Decide the emission rate
**Permanent once `initialize_pool` runs.** There is no setter. Set it low enough
that normal trading volume comfortably outruns it, or the schedule runs dry and
accrual pauses until the next buyback.

---

## Building the program

`program/Cargo.lock` is **tracked, and must stay tracked.** It was not, and the
build broke: unpinned transitive dependencies drifted onto Rust edition2024,
which the rustc 1.79 inside Solana platform-tools v1.43 cannot parse. The
program would not compile at all — discovered by running the suite, not by
anything failing loudly on its own.

Four crates are pinned below their latest release for that reason:

| Crate | Pinned to | Why |
|---|---|---|
| `blake3` | 1.5.5 | later versions pull `digest 0.11` -> `block-buffer 0.12` (edition2024) |
| `zeroize` | 1.8.1 | edition2024 |
| `unicode-segmentation` | 1.12.0 | requires rustc 1.85 |
| `indexmap` / `proc-macro-crate` | 2.7.1 / 3.2.0 | `toml_edit 0.25` needs `indexmap >= 2.13` |

The unused `[dev-dependencies]` (litesvm and four solana-* crates) were removed.
Nothing referenced them and there are no Rust tests — they were dragging in
`indexmap >= 2.12` and breaking the build of the program itself.

Do not run a bare `cargo update`. It discards these pins and the build stops
working again. The durable fix is a newer platform-tools, but v1.53 expects a
different target name than CLI 2.1.0 emits, so that is a deliberate later job —
not something to attempt between now and launch.

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

Cloudflare Workers (static assets), connected to the GitHub repo so every push
to `main` redeploys. Live at **https://bullbank.win**.

| Field | Value |
|---|---|
| Path | `/bullbank` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |

`bullbank/wrangler.jsonc` names `dist` as the asset directory. `public/_headers`
is honoured on this flow — verified against the deployed site, which returns
`X-Frame-Options: DENY` and `frame-ancestors none`.

`bullbank.win` is the canonical address. Turn the `workers.dev` URL off once
the domain works — two live addresses for one site makes a lookalike easier to
pass off, and the `workers.dev` one spells out the account email handle.

`.win` is cheap and carries a poor reputation with some link scanners and mail
filters, which matters more than usual for a token launch where people are
already scam-wary. Worth watching: if links get flagged, a `.io` or `.com`
pointed at the same Worker fixes it without touching the code.

Build configuration lives in `bullbank/.env.production`, tracked in the repo.
**Every `VITE_*` value is compiled into the JavaScript bundle and is public** —
not a secret store, so no key goes in it. That is also why the deployed build
uses the free public RPC rather than a Helius key, which would be scraped.
Verified from the live origin: `getHealth` ok and the pool account reads.


Pre-launch the cluster is `mainnet-beta` and the five addresses are empty. The
frontend already skips every chain read when it is not fully configured, so the
site is an information page: no badge, no banner, and no zeros dressed up as
balances. Connecting a wallet keeps the pre-launch page rather than opening an
empty dashboard.

That is deliberate. The alternative — staying on devnet with the badge hidden —
shows test-network state to people with no way of knowing it is not real.

### Turning the app on at launch
Edit `bullbank/.env.production` and push. In order:

1. `VITE_PROGRAM_ID`, `VITE_TOKEN_MINT`, `VITE_POOL_PDA`, `VITE_STAKE_VAULT`,
   `VITE_REWARD_VAULT` — the mainnet values from `pool-addresses.json`.
2. `HELIUS_API_KEY` — a **fresh** key, added as a Cloudflare **secret** on the
   Worker (Settings → Variables and Secrets → Add → type Secret). Not an env
   var, and never in `.env.production`: the site calls `/rpc` on its own origin
   and `worker/index.ts` adds the key server-side, so it is never shipped to a
   browser. Until the secret exists, `/rpc` answers 503 saying exactly that.
3. `VITE_LAUNCHED=true` — last, and only once the reserve is actually funded.
   This one gates every number on the site.

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
