# BullBank — account dashboard

Vite + React + TypeScript + Tailwind v4. Dark private-bank aesthetic, framed as an
account that accrues rather than a staking dApp.

```bash
npm install
cp .env.example .env     # fill in addresses from pool-addresses.json
npm run dev
npm run test             # accrual math vs the on-chain program
npm run build
```

## Architecture

| Path | Role |
|---|---|
| `src/solana/accrual.ts` | Pure accrual math. Mirrors `update_pool`/`pending_rewards` on chain. No React, no RPC — fully unit tested. |
| `src/solana/program.ts` | Anchor client built from `idl.json`. All instructions and account layouts are generated, never hand-encoded. |
| `src/solana/config.ts` | Env-driven addresses. Never throws at import — bad config surfaces as a banner. |
| `src/hooks/useChainState.ts` | Single source of truth for chain reads. Batched fetch, chain-clock sync, visibility-aware polling. |
| `src/hooks/useActions.ts` | Deposit / settle / withdraw. Blockhash-bounded confirmation, human error mapping. |
| `src/hooks/useNow.ts` | rAF clock at 10 Hz driving the live display. |

## How the "passive income" display works

There is no simulation and no cron job. The program uses an accumulator, so a
position's entitlement is a pure function of elapsed time:

```
acc(now) = acc_stored + (min(now, end) - last_update) * rate / total_weighted
claimable = weighted * acc(now) / PRECISION - reward_debt + accrued
```

`acc_stored` only changes when someone sends a transaction, so the client projects
it forward locally. That projection is exact, not an estimate — which is why the
ticking number equals what `claim` pays, to the base unit. `accrual.test.ts`
asserts this against the same figures the on-chain suite produced.

Three consequences worth knowing:

- **No per-user transactions are needed for accrual.** Only settling costs gas.
- **The clock must be the chain's, not the browser's.** `useChainState` samples
  `getBlockTime` and stores the offset. A user whose PC runs fast would otherwise
  see money that does not exist yet and hit failed transactions.
- **Accrual stops at `reward_end_time`.** The ticker must stop there too, or it
  counts up into an empty reserve.

The five-minute rhythm is the **Statement** panel, which posts an entry every five
minutes. Entries are `rate × window` from live chain state — not a delta of the
displayed balance, which would read zero for any window in which the user settled.

## Configuration

All chain addresses come from env vars (see `.env.example`). Nothing is hardcoded
except the program ID default. Missing or malformed values render a banner and
disable transactions rather than crashing.

## Deployment

Static output in `dist/`. No serverless function is required if the RPC provider
allows browser origins (Helius, QuickNode, Triton with a domain-restricted key).
The public `api.mainnet-beta.solana.com` endpoint is rate limited and unsuitable
for production.

Recommended: Cloudflare Pages. If the RPC key must be hidden, put a Cloudflare
Worker in front and point `VITE_RPC_URL` at it.

## Not done

- No wallet has been connected against a live pool. The connect screen, config
  gating and build are verified; the deposit/settle/withdraw paths are typed
  against the IDL and unit tested at the math layer, but have not been executed
  end-to-end on chain.
- No responsive pass below ~380px.
- No toast queue — one transaction at a time.
