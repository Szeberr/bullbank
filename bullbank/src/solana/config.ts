import { PublicKey } from "@solana/web3.js";

/**
 * Deployment configuration.
 *
 * Everything chain-specific is read from Vite env vars so the same bundle can be
 * pointed at localnet, devnet or mainnet without a code change. See `.env.example`.
 *
 * Nothing here throws at module load. An unconfigured or malformed address must
 * surface as a visible banner in the UI, not a white screen — the previous site
 * died on exactly this by constructing PublicKeys at import time.
 */

const env = import.meta.env;

/**
 * RPC endpoint.
 *
 * A relative value such as `/rpc` is resolved against the site's own origin, so
 * the browser talks to this domain and the Worker adds the provider key
 * server-side. That is the only way to use a keyed endpoint here: anything in a
 * `VITE_` variable is compiled into the bundle and readable by anyone.
 *
 * web3.js derives the subscription URL from this one by swapping the scheme, so
 * `https://…/rpc` becomes `wss://…/rpc` — which the Worker also handles.
 */
function resolveRpc(raw: string): string {
  if (!raw.startsWith("/")) return raw;
  if (typeof window === "undefined") return raw;
  return window.location.origin + raw;
}

export const RPC_URL: string = resolveRpc(
  env.VITE_RPC_URL || "https://api.mainnet-beta.solana.com"
);

export const CLUSTER: string = env.VITE_CLUSTER || "mainnet-beta";

export const TOKEN_DECIMALS: number = Number(env.VITE_TOKEN_DECIMALS ?? 6);

/**
 * Has the token actually launched on mainnet?
 *
 * Gates every claim that would imply a live product: the contract address and
 * the reserve/emission figures. Until this is true the site reads as a
 * pre-launch page, because showing real-looking numbers pulled from a devnet
 * test pool would tell visitors a treasury exists that does not.
 *
 * Flip to true in .env only once the mint is live and the pool is funded.
 */
export const LAUNCHED = env.VITE_LAUNCHED === "true";

export const SOCIALS = {
  x: "https://x.com/BULLBANKSOLANA",
  launchpad: "https://ansem.io/",
};

/**
 * Public proof links. Each renders an honest "not published yet" state until
 * set, rather than being hidden — a missing link people were told to expect
 * looks worse than one that says why it is not there.
 *
 * SOURCE_URL: the repository holding the program and this site.
 * CRANK_LOG_URL: the buyback job's run history, ideally a GitHub Actions page,
 * so every buyback is publicly checkable without asking anyone.
 */
export const PROOF_LINKS = {
  source: env.VITE_SOURCE_URL || null,
  crankLog: env.VITE_CRANK_LOG_URL || null,
  audit: env.VITE_AUDIT_URL || null,
};

/** How often the buyback job is scheduled to run, in hours. */
export const CRANK_INTERVAL_HOURS = Number(env.VITE_CRANK_INTERVAL_HOURS ?? 6);

/** Share of supply set aside for $ANSEM holders by the launchpad, in percent. */
export const AIRDROP_PERCENT = Number(env.VITE_AIRDROP_PERCENT ?? 3);

export const TOKEN_SYMBOL = "BULL";
export const TOKEN_NAME = "BullBank";

interface RawAddresses {
  programId?: string;
  tokenMint?: string;
  poolPda?: string;
  stakeVault?: string;
  rewardVault?: string;
}

const RAW: RawAddresses = {
  programId: env.VITE_PROGRAM_ID,
  tokenMint: env.VITE_TOKEN_MINT,
  poolPda: env.VITE_POOL_PDA,
  stakeVault: env.VITE_STAKE_VAULT,
  rewardVault: env.VITE_REWARD_VAULT,
};

function parse(value: string | undefined): PublicKey | null {
  if (!value || value.startsWith("REPLACE_WITH")) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export const ADDRESSES = {
  programId: parse(RAW.programId),
  tokenMint: parse(RAW.tokenMint),
  poolPda: parse(RAW.poolPda),
  stakeVault: parse(RAW.stakeVault),
  rewardVault: parse(RAW.rewardVault),
};

/** Which required addresses are missing or unparseable. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!ADDRESSES.programId) missing.push("VITE_PROGRAM_ID");
  if (!ADDRESSES.tokenMint) missing.push("VITE_TOKEN_MINT");
  if (!ADDRESSES.poolPda) missing.push("VITE_POOL_PDA");
  if (!ADDRESSES.stakeVault) missing.push("VITE_STAKE_VAULT");
  if (!ADDRESSES.rewardVault) missing.push("VITE_REWARD_VAULT");
  return missing;
}

export function isConfigured(): boolean {
  return missingConfig().length === 0;
}

/**
 * Account tiers.
 *
 * Deliberately framed as membership tiers rather than lock durations: the product
 * is an account that pays you, and the commitment term is a property of the
 * account. `tier` must still match the on-chain index — the program reads it as a
 * PDA seed and a multiplier lookup, so these cannot be reordered.
 */
export interface Tier {
  tier: 0 | 1 | 2 | 3;
  name: string;
  days: number;
  multiplier: number;
  blurb: string;
}

export const TIERS: Tier[] = [
  {
    tier: 0,
    name: "Core",
    // No lock. TIER_LOCK_SECS[0] is 0 on chain — tier 0 is the hold tier and
    // tokens never leave the wallet. Any non-zero value here would be a lie.
    days: 0,
    multiplier: 1.0,
    blurb: "Just hold BULL in your wallet. Nothing locks, sell whenever you like.",
  },
  {
    tier: 1,
    name: "Prime",
    days: 14,
    multiplier: 1.2,
    blurb: "Lock for two weeks and earn 20% more than holding.",
  },
  {
    tier: 2,
    name: "Elite",
    days: 30,
    multiplier: 1.5,
    blurb: "Lock for a month and earn half again what holding pays.",
  },
  {
    tier: 3,
    name: "Black",
    days: 60,
    multiplier: 2.0,
    blurb: "Lock for two months and earn double. The biggest share of the reserve.",
  },
];

export function tierByIndex(i: number): Tier {
  return TIERS[i] ?? TIERS[0];
}

export const EXPLORER = (sig: string) =>
  `https://solscan.io/tx/${sig}${CLUSTER !== "mainnet-beta" ? `?cluster=${CLUSTER}` : ""}`;

export const EXPLORER_ACCOUNT = (addr: string) =>
  `https://solscan.io/account/${addr}${CLUSTER !== "mainnet-beta" ? `?cluster=${CLUSTER}` : ""}`;

/**
 * Total supply, in whole tokens.
 *
 * pump.fun mints a fixed 1,000,000,000 and nothing in this program can create
 * more — `fund_rewards` only moves existing tokens into the reserve. Used by the
 * calculator to bound "how much could ever be synced".
 */
export const TOTAL_SUPPLY = Number(env.VITE_TOTAL_SUPPLY ?? 1_000_000_000);
