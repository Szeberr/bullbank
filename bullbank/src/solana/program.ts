import { AnchorProvider, Program, BN, type Idl } from "@coral-xyz/anchor";
import { PublicKey as SolanaPublicKey } from "@solana/web3.js";
import type { Connection, PublicKey } from "@solana/web3.js";
import idl from "./idl.json";
import { ADDRESSES } from "./config";
import type { PoolState, PositionState } from "./accrual";

/**
 * Anchor client.
 *
 * Every instruction and every account layout comes from the IDL the program was
 * built with. The previous frontend hand-wrote instruction discriminators and
 * decoded accounts by counting byte offsets; four separate bugs came from that,
 * including a `Pool` layout that silently went stale when a field was added and
 * an `unstake` that encoded a u8 where the program reads a u64. Generating the
 * client from the IDL makes that class of bug impossible.
 */

export const STAKING_IDL = idl as Idl;

/** A no-op wallet so the app can read chain state before anyone connects. */
const READONLY_WALLET = {
  publicKey: null as unknown as PublicKey,
  signTransaction: async () => {
    throw new Error("read-only");
  },
  signAllTransactions: async () => {
    throw new Error("read-only");
  },
};

export function buildProgram(
  connection: Connection,
  wallet?: {
    publicKey: PublicKey | null;
    signTransaction?: unknown;
    signAllTransactions?: unknown;
  } | null
): Program | null {
  if (!ADDRESSES.programId) return null;

  const provider = new AnchorProvider(
    connection,
    (wallet && wallet.publicKey ? wallet : READONLY_WALLET) as never,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );

  return new Program(STAKING_IDL, provider);
}

/**
 * PDA for one account (position), keyed by pool + owner + tier.
 * Seeds must match `[b"position", pool, owner, &[tier]]` in the program.
 */
export function positionPda(
  poolPda: PublicKey,
  owner: PublicKey,
  tier: number,
  programId: PublicKey
): PublicKey {
  return SolanaPublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("position"),
      poolPda.toBytes(),
      owner.toBytes(),
      new Uint8Array([tier]),
    ],
    programId
  )[0];
}

type AnchorPool = {
  totalWeighted: BN;
  accRewardPerShare: BN;
  rewardRatePerSec: BN;
  lastUpdateTime: BN;
  rewardEndTime: BN;
  stakeMint: PublicKey;
  rewardMint: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  authority: PublicKey;
};

type AnchorPosition = {
  owner: PublicKey;
  pool: PublicKey;
  balance: BN;
  weight: BN;
  accCheckpoint: BN;
  accrued: BN;
  tier: number;
  unlockTime: BN;
};

const big = (v: BN): bigint => BigInt(v.toString());

export function decodePool(raw: AnchorPool): PoolState & {
  stakeMint: PublicKey;
  rewardVault: PublicKey;
  stakeVault: PublicKey;
} {
  return {
    totalWeighted: big(raw.totalWeighted),
    accRewardPerShare: big(raw.accRewardPerShare),
    rewardRatePerSec: big(raw.rewardRatePerSec),
    lastUpdateTime: big(raw.lastUpdateTime),
    rewardEndTime: big(raw.rewardEndTime),
    stakeMint: raw.stakeMint,
    stakeVault: raw.stakeVault,
    rewardVault: raw.rewardVault,
  };
}

export function decodePosition(raw: AnchorPosition): PositionState {
  return {
    tier: raw.tier,
    balance: big(raw.balance),
    weight: big(raw.weight),
    accCheckpoint: big(raw.accCheckpoint),
    accrued: big(raw.accrued),
    unlockTime: big(raw.unlockTime),
  };
}

export { BN };
