import { describe, it, expect } from "vitest";
import {
  claimable,
  projectAcc,
  ratePerSecond,
  previewRatePerSecond,
  currentApr,
  scheduleRemaining,
  weightFor,
  type PoolState,
  type PositionState,
} from "./accrual";

/*
 * These reproduce the on-chain test suite (staking_bullbank.ts, 9 passing) with
 * the same numbers. If this file and the Rust program ever disagree, the UI is
 * lying to users about what a settlement will pay — which is the single most
 * important thing for this app to get right.
 *
 * Chain scenario: rate 1 token/sec at 6 decimals, Alice tier 0 (1.0x) and Bob
 * tier 3 (2.0x) each depositing 100 tokens. The program paid Alice 4 and Bob 8
 * over the sampled window.
 */

const ONE = 1_000_000n; // one token at 6 decimals
const RATE = ONE; // 1 token per second

function pool(over: Partial<PoolState> = {}): PoolState {
  return {
    totalWeighted: 300n * ONE, // 100 * 1.0 + 100 * 2.0
    accRewardPerShare: 0n,
    rewardRatePerSec: RATE,
    lastUpdateTime: 1000n,
    rewardEndTime: 1000n + 3600n,
    ...over,
  };
}

function position(over: Partial<PositionState> = {}): PositionState {
  return {
    tier: 0,
    balance: 100n * ONE,
    weight: 100n * ONE,
    accCheckpoint: 0n,
    accrued: 0n,
    unlockTime: 1000n + 7n * 86400n,
    ...over,
  };
}

describe("emission split by weight", () => {
  it("pays the 2.0x tier exactly twice the 1.0x tier", () => {
    const p = pool();
    const alice = position({ tier: 0, weight: 100n * ONE });
    const bob = position({ tier: 3, weight: 200n * ONE });

    const now = 1012n; // 12 seconds of emissions
    const a = claimable(p, alice, now);
    const b = claimable(p, bob, now);

    // 12 tokens emitted, split 1:2 across 300 weight.
    expect(a).toBe(4n * ONE);
    expect(b).toBe(8n * ONE);
    expect(b).toBe(a * 2n);
  });

  it("never emits more in total than rate * elapsed", () => {
    const p = pool();
    const alice = position({ weight: 100n * ONE });
    const bob = position({ weight: 200n * ONE });
    const now = 1012n;

    const total = claimable(p, alice, now) + claimable(p, bob, now);
    expect(total).toBeLessThanOrEqual(RATE * 12n);
  });
});

describe("schedule cap", () => {
  it("stops accruing at reward_end_time", () => {
    // 8 seconds of runway, sampled 20 seconds later.
    const p = pool({ totalWeighted: 100n * ONE, rewardEndTime: 1008n });
    const pos = position({ weight: 100n * ONE });

    const atEnd = claimable(p, pos, 1008n);
    const wellPast = claimable(p, pos, 1028n);

    expect(wellPast).toBe(atEnd);
    // Sole staker with all the weight receives the entire 8-token schedule.
    expect(wellPast).toBe(8n * ONE);
  });

  it("reports a zero rate once the schedule has ended", () => {
    const p = pool({ rewardEndTime: 1000n });
    expect(ratePerSecond(p, position(), 2000n)).toBe(0n);
    expect(currentApr(p, position(), 2000n)).toBeNull();
    expect(scheduleRemaining(p, 2000n)).toBe(0n);
  });

  it("does not rewind the accumulator when nothing has elapsed", () => {
    const p = pool({ accRewardPerShare: 12345n });
    expect(projectAcc(p, 999n)).toBe(12345n);
    expect(projectAcc(p, 1000n)).toBe(12345n);
  });
});

describe("empty pool", () => {
  it("does not divide by zero when nothing is deposited", () => {
    const p = pool({ totalWeighted: 0n });
    expect(projectAcc(p, 2000n)).toBe(p.accRewardPerShare);
    expect(ratePerSecond(p, position(), 2000n)).toBe(0n);
  });
});

describe("checkpoint", () => {
  it("excludes emissions that predate registration", () => {
    // A position registering at acc = X stores X as its checkpoint, so it earns
    // only the accumulator movement after it joined. Note the checkpoint is the
    // RAW accumulator value, not scaled by weight — that scaling happens when
    // the delta is applied, which is what the chain's settle() does.
    const p = pool({ accRewardPerShare: 0n });
    const accAtJoin = projectAcc(p, 1010n); // 10 seconds in
    const joiner = position({
      weight: 100n * ONE,
      accCheckpoint: accAtJoin,
    });

    // Immediately after joining, nothing is owed.
    expect(claimable(p, joiner, 1010n)).toBe(0n);
    // After a further 3 seconds it has its 1/3 share of 3 tokens.
    expect(claimable(p, joiner, 1013n)).toBe(ONE);
  });

  it("adds already-settled accrued balance on top", () => {
    const p = pool();
    const pos = position({ accrued: 5n * ONE });
    expect(claimable(p, pos, 1000n)).toBe(5n * ONE);
  });
});

describe("hold model", () => {
  it("an unsynced position (weight 0) earns nothing", () => {
    const p = pool();
    // Before the first sync the position carries no weight, so the period before
    // registration must not pay out.
    expect(claimable(p, position({ weight: 0n }), 1012n)).toBe(0n);
  });

  it("projects on registered weight, which is an upper bound for a seller", () => {
    // The chain settles a hold position at min(registered, current). The client
    // only knows the registered figure, so its projection can overstate for
    // someone mid-sell — never understate, which is the safe direction.
    const p = pool({ totalWeighted: 100n * ONE });
    const registered = position({ weight: 100n * ONE, balance: 100n * ONE });
    const projected = claimable(p, registered, 1010n);

    // What the chain would actually pay if they now hold only a tenth.
    const soldPos = position({ weight: 10n * ONE, balance: 10n * ONE });
    const actual = claimable(p, soldPos, 1010n);

    expect(actual).toBeLessThan(projected);
  });
});

describe("deposit preview", () => {
  it("accounts for the dilution the deposit itself causes", () => {
    const p = pool({ totalWeighted: 100n * ONE });
    const amount = 100n * ONE;

    // Depositing at tier 3 adds 200 weight to an existing 100, so the new
    // account takes 200/300 of emissions — not 200/100.
    const preview = previewRatePerSecond(p, amount, 3, 1000n);
    expect(preview).toBe((RATE * 200n) / 300n);

    // Quoting without dilution would overstate it, which is the bug this guards.
    const undiluted = (RATE * weightFor(amount, 3)) / p.totalWeighted;
    expect(preview).toBeLessThan(undiluted);
  });

  it("returns zero for a zero amount or an ended schedule", () => {
    const p = pool();
    expect(previewRatePerSecond(p, 0n, 0, 1000n)).toBe(0n);
    expect(previewRatePerSecond(pool({ rewardEndTime: 1000n }), 100n * ONE, 0, 2000n)).toBe(0n);
  });
});

describe("tier weighting", () => {
  it("matches TIER_MULT_BPS on chain", () => {
    const amount = 100n * ONE;
    expect(weightFor(amount, 0)).toBe(100n * ONE);
    expect(weightFor(amount, 1)).toBe(120n * ONE);
    expect(weightFor(amount, 2)).toBe(150n * ONE);
    expect(weightFor(amount, 3)).toBe(200n * ONE);
  });
});

describe("apr", () => {
  it("is denominated in tokens, not value", () => {
    // Sole depositor of 100 tokens receiving 1 token/sec earns 31,536,000 tokens
    // a year against a 100-token principal — 31,536,000% in token terms.
    const p = pool({ totalWeighted: 100n * ONE });
    const pos = position({ balance: 100n * ONE, weight: 100n * ONE });
    expect(currentApr(p, pos, 1000n)).toBeCloseTo(31_536_000, 0);
  });

  it("returns null for an empty position rather than dividing by zero", () => {
    expect(currentApr(pool(), position({ balance: 0n }), 1000n)).toBeNull();
  });
});
