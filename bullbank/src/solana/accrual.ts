/**
 * Accrual math — a faithful mirror of `update_pool` / `pending_rewards` in the
 * on-chain program.
 *
 * This module is deliberately pure and free of React, wallets and RPC. What it
 * returns must equal what `claim` would actually pay, to the base unit. The old
 * site invented reward growth on the client (`pending += drip`); the whole point
 * here is that the ticking number on screen is the real one.
 *
 * Chain-side reference (lib_bullbank.rs):
 *   applicable = min(now, reward_end_time)
 *   if applicable > last_update_time && total_weighted > 0:
 *       acc += (applicable - last_update_time) * rate * ACC_PRECISION / total_weighted
 *   pending   = weight * (acc - acc_checkpoint) / ACC_PRECISION
 *   claimable = pending + accrued
 *
 * For hold positions the chain additionally settles at min(registered, current)
 * when syncing or claiming, so a holder who sold is paid on the smaller figure.
 * This projection uses the registered weight, which is therefore an UPPER bound
 * for someone mid-sell — it can never understate what they will receive.
 */

export const ACC_PRECISION = 1_000_000_000_000n;

/** Basis-point multipliers by tier, matching TIER_MULT_BPS on chain. */
export const TIER_MULT_BPS = [10_000n, 12_000n, 15_000n, 20_000n];
export const BPS_DENOM = 10_000n;

export interface PoolState {
  totalWeighted: bigint;
  accRewardPerShare: bigint;
  rewardRatePerSec: bigint;
  lastUpdateTime: bigint;
  rewardEndTime: bigint;
}

export interface PositionState {
  tier: number;
  /** Hold tier: wallet balance at last sync. Lock tiers: tokens in the vault. */
  balance: bigint;
  weight: bigint;
  /** Accumulator value at last settlement. */
  accCheckpoint: bigint;
  accrued: bigint;
  unlockTime: bigint;
}

/**
 * Advance the accumulator to `nowSec` without touching the chain.
 *
 * The chain only writes `acc_reward_per_share` when somebody sends a transaction,
 * so the stored value is almost always stale. Projecting it forward locally is
 * what lets the balance tick continuously between transactions — and it is exact,
 * not an approximation, because emissions are a known constant rate.
 */
export function projectAcc(pool: PoolState, nowSec: bigint): bigint {
  if (pool.totalWeighted <= 0n) return pool.accRewardPerShare;

  const applicable = nowSec < pool.rewardEndTime ? nowSec : pool.rewardEndTime;
  if (applicable <= pool.lastUpdateTime) return pool.accRewardPerShare;

  const elapsed = applicable - pool.lastUpdateTime;
  return (
    pool.accRewardPerShare +
    (elapsed * pool.rewardRatePerSec * ACC_PRECISION) / pool.totalWeighted
  );
}

/** What `claim` would pay for this position right now, in base units. */
export function claimable(
  pool: PoolState,
  pos: PositionState,
  nowSec: bigint
): bigint {
  const acc = projectAcc(pool, nowSec);
  const delta = acc > pos.accCheckpoint ? acc - pos.accCheckpoint : 0n;
  const pending = (pos.weight * delta) / ACC_PRECISION;
  return pending + pos.accrued;
}

/**
 * This position's share of emissions, in base units per second.
 *
 * Returns 0 once the schedule has run out — the pool cannot pay past
 * `reward_end_time`, so the ticker must stop there rather than counting up into
 * money that does not exist.
 */
export function ratePerSecond(
  pool: PoolState,
  pos: PositionState,
  nowSec: bigint
): bigint {
  if (pool.totalWeighted <= 0n) return 0n;
  if (nowSec >= pool.rewardEndTime) return 0n;
  return (pool.rewardRatePerSec * pos.weight) / pool.totalWeighted;
}

/** Aggregate per-second accrual across every open position. */
export function totalRatePerSecond(
  pool: PoolState,
  positions: PositionState[],
  nowSec: bigint
): bigint {
  return positions.reduce((sum, p) => sum + ratePerSecond(pool, p, nowSec), 0n);
}

/** Aggregate claimable across every open position. */
export function totalClaimable(
  pool: PoolState,
  positions: PositionState[],
  nowSec: bigint
): bigint {
  return positions.reduce((sum, p) => sum + claimable(pool, p, nowSec), 0n);
}

/**
 * Annualised percentage return for a position, from the live emission rate.
 *
 * Honest by construction: this is denominated in BULL, not dollars. It states how
 * fast the token count grows, which says nothing about value. Returns null when
 * emissions have ended or the position is empty, so callers render "—" instead of
 * a fabricated headline number.
 */
export function currentApr(
  pool: PoolState,
  pos: PositionState,
  nowSec: bigint
): number | null {
  if (pos.balance <= 0n) return null;
  const perSec = ratePerSecond(pool, pos, nowSec);
  if (perSec <= 0n) return null;

  const perYear = perSec * 31_536_000n;
  // Scale before dividing so integer division does not collapse the ratio to 0.
  return Number((perYear * 10_000n) / pos.balance) / 100;
}

/** Seconds of emissions left in the funded schedule. */
export function scheduleRemaining(pool: PoolState, nowSec: bigint): bigint {
  return pool.rewardEndTime > nowSec ? pool.rewardEndTime - nowSec : 0n;
}

export function isUnlocked(pos: PositionState, nowSec: bigint): boolean {
  return nowSec >= pos.unlockTime;
}

/** Weight a deposit would carry at a given tier — used to preview a deposit. */
export function weightFor(amount: bigint, tier: number): bigint {
  return (amount * TIER_MULT_BPS[tier]) / BPS_DENOM;
}

/**
 * Preview the per-second accrual a hypothetical deposit would earn.
 *
 * Adding weight dilutes the pool, so the new weight must be added to the
 * denominator too. Quoting the undiluted rate would overstate what the user
 * actually gets the moment they deposit.
 */
export function previewRatePerSecond(
  pool: PoolState,
  amount: bigint,
  tier: number,
  nowSec: bigint
): bigint {
  if (amount <= 0n) return 0n;
  if (nowSec >= pool.rewardEndTime) return 0n;
  const w = weightFor(amount, tier);
  const denom = pool.totalWeighted + w;
  if (denom <= 0n) return 0n;
  return (pool.rewardRatePerSec * w) / denom;
}
