import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import assert from "assert";

/*
 * Withdrawal after the lock expires.
 *
 * Run against a TEST BUILD with TIER_LOCK_SECS shortened to seconds. The real
 * program locks for 14/30/60 days, which cannot be waited out and cannot be
 * fast-forwarded on a normal validator. Only the constant differs — every line
 * of unstake() exercised here is the code that ships.
 *
 * This is the highest-consequence path in the program. If it is broken, locked
 * principal is unrecoverable and nobody finds out until the first term expires.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ONE = 1_000_000n;
const RATE = ONE;
const TP = TOKEN_2022_PROGRAM_ID;

describe("bullbank — withdrawal after lock expiry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require("../target/idl/staking.json");
  const program = new anchor.Program(idl, provider) as Program;
  const authority = (provider.wallet as anchor.Wallet).payer;

  const dave = Keypair.generate();
  const DEPOSIT = 1_000n * ONE;
  const HELD = 5_000n * ONE;
  const TIER = 3; // 10s in the test build, 60 days in production

  let mint: PublicKey;
  let poolPda: PublicKey;
  let stakeVault: PublicKey;
  let rewardVault: PublicKey;
  let daveAta: PublicKey;
  let position: PublicKey;

  const bal = async () =>
    (await getAccount(provider.connection, daveAta, undefined, TP)).amount;

  before(async () => {
    const s = await provider.connection.requestAirdrop(
      dave.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(s);

    mint = await createMint(
      provider.connection, authority, authority.publicKey, null, 6,
      Keypair.generate(), undefined, TP
    );
    [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mint.toBuffer()], program.programId
    );

    const sv = Keypair.generate();
    const rv = Keypair.generate();
    await (program.methods as any)
      .initializePool(new anchor.BN(RATE.toString()))
      .accounts({
        authority: authority.publicKey, pool: poolPda,
        stakeMint: mint, rewardMint: mint,
        stakeVault: sv.publicKey, rewardVault: rv.publicKey,
        tokenProgram: TP, systemProgram: SystemProgram.programId,
      })
      .signers([sv, rv]).rpc();
    stakeVault = sv.publicKey;
    rewardVault = rv.publicKey;

    daveAta = await createAssociatedTokenAccount(
      provider.connection, dave, mint, dave.publicKey, undefined, TP
    );
    await mintTo(provider.connection, authority, mint, daveAta, authority, HELD, [], undefined, TP);

    const authAta = await createAssociatedTokenAccount(
      provider.connection, authority, mint, authority.publicKey, undefined, TP
    );
    await mintTo(provider.connection, authority, mint, authAta, authority, RATE * 3600n, [], undefined, TP);
    await (program.methods as any)
      .fundRewards(new anchor.BN((RATE * 3600n).toString()))
      .accounts({
        pool: poolPda, rewardMint: mint, funder: authority.publicKey,
        funderRewardAta: authAta, rewardVault, tokenProgram: TP,
      }).rpc();

    [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), poolPda.toBuffer(), dave.publicKey.toBuffer(), Buffer.from([TIER])],
      program.programId
    );
  });

  it("locks the deposit and refuses withdrawal during the term", async () => {
    const before = await bal();

    await (program.methods as any).stake(TIER, new anchor.BN(DEPOSIT.toString()))
      .accounts({
        pool: poolPda, position, stakeMint: mint, owner: dave.publicKey,
        ownerAta: daveAta, stakeVault, tokenProgram: TP,
        systemProgram: SystemProgram.programId,
      }).signers([dave]).rpc();

    assert.equal(await bal(), before - DEPOSIT, "tokens must leave the wallet");
    const vault = (await getAccount(provider.connection, stakeVault, undefined, TP)).amount;
    assert.equal(vault, DEPOSIT, "tokens must land in the vault");

    try {
      await (program.methods as any).unstake(new anchor.BN(DEPOSIT.toString()))
        .accounts({
          pool: poolPda, position, stakeMint: mint, owner: dave.publicKey,
          ownerAta: daveAta, stakeVault, tokenProgram: TP,
        }).signers([dave]).rpc();
      assert.fail("withdrawal during the term must be rejected");
    } catch (e: any) {
      assert.ok(e.toString().includes("StillLocked"), e.toString());
    }
  });

  it("releases the principal once the term expires", async () => {
    await sleep(12_000); // test build locks tier 3 for 10s

    const before = await bal();
    await (program.methods as any).unstake(new anchor.BN(DEPOSIT.toString()))
      .accounts({
        pool: poolPda, position, stakeMint: mint, owner: dave.publicKey,
        ownerAta: daveAta, stakeVault, tokenProgram: TP,
      }).signers([dave]).rpc();

    const returned = (await bal()) - before;
    console.log(`    withdrew ${Number(returned) / Number(ONE)} tokens`);
    assert.equal(returned, DEPOSIT, "the full principal must come back");

    const vault = (await getAccount(provider.connection, stakeVault, undefined, TP)).amount;
    assert.equal(vault, 0n, "vault must be empty afterwards");

    const pos: any = await (program.account as any).position.fetch(position);
    assert.equal(pos.balance.toString(), "0");
    assert.equal(pos.weight.toString(), "0");

    const pool: any = await (program.account as any).pool.fetch(poolPda);
    assert.equal(pool.totalWeighted.toString(), "0", "weight must be removed from the pool");
  });

  it("still pays out rewards earned while it was locked", async () => {
    const pos: any = await (program.account as any).position.fetch(position);
    assert.ok(
      Number(pos.accrued) > 0,
      "rewards accrued during the lock must survive the withdrawal"
    );

    const before = await bal();
    await (program.methods as any).claim()
      .accounts({
        pool: poolPda, position, rewardMint: mint, owner: dave.publicKey,
        ownerAta: daveAta, rewardVault, tokenProgram: TP,
      }).signers([dave]).rpc();

    const paid = (await bal()) - before;
    console.log(`    claimed ${Number(paid) / Number(ONE)} tokens accrued while locked`);
    assert.ok(paid > 0n, "withdrawing must not forfeit accrued rewards");
  });

  it("rejects withdrawing more than is locked", async () => {
    // Re-lock a small amount to test the bound.
    await (program.methods as any).stake(TIER, new anchor.BN((10n * ONE).toString()))
      .accounts({
        pool: poolPda, position, stakeMint: mint, owner: dave.publicKey,
        ownerAta: daveAta, stakeVault, tokenProgram: TP,
        systemProgram: SystemProgram.programId,
      }).signers([dave]).rpc();

    await sleep(12_000);

    try {
      await (program.methods as any).unstake(new anchor.BN((999n * ONE).toString()))
        .accounts({
          pool: poolPda, position, stakeMint: mint, owner: dave.publicKey,
          ownerAta: daveAta, stakeVault, tokenProgram: TP,
        }).signers([dave]).rpc();
      assert.fail("must not allow withdrawing more than deposited");
    } catch (e: any) {
      assert.ok(e.toString().includes("InsufficientStake"), e.toString());
    }
  });
});
