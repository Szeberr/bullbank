/**
 * Devnet end-to-end for the hold-to-earn (sync) model.
 *
 * Proves on a live chain that:
 *   1. sync registers a wallet balance and moves no tokens
 *   2. holding accrues, and the client projection equals what claim pays
 *   3. selling after syncing collapses the payout — the model's core defence
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createAssociatedTokenAccount,
  transfer,
} from "@solana/spl-token";
import fs from "fs";
import os from "os";
import path from "path";

const RPC = process.env.RPC_URL!;
const MINT = new PublicKey(process.env.TOKEN_MINT!);
const POOL = new PublicKey(process.env.POOL_PDA!);
const REWARD_VAULT = new PublicKey(process.env.REWARD_VAULT!);

const ONE = 1_000_000n;
const ACC_PRECISION = 1_000_000_000_000n;
const HOLD = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const big = (v: anchor.BN) => BigInt(v.toString());
const fmt = (v: bigint) => (Number(v) / Number(ONE)).toFixed(4);

/** Mirrors bullbank/src/solana/accrual.ts. */
function predict(pool: any, pos: any, nowSec: bigint): bigint {
  const totalWeighted = big(pool.totalWeighted);
  let acc = big(pool.accRewardPerShare);
  const end = big(pool.rewardEndTime);
  const last = big(pool.lastUpdateTime);
  const rate = big(pool.rewardRatePerSec);

  if (totalWeighted > 0n) {
    const applicable = nowSec < end ? nowSec : end;
    if (applicable > last) {
      acc += ((applicable - last) * rate * ACC_PRECISION) / totalWeighted;
    }
  }
  const cp = big(pos.accCheckpoint);
  const delta = acc > cp ? acc - cp : 0n;
  return (big(pos.weight) * delta) / ACC_PRECISION + big(pos.accrued);
}

async function main() {
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(path.join(os.homedir(), ".config/solana/bullbank.json"), "utf-8")
      )
    )
  );
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync("./target/idl/staking.json", "utf-8"));
  const program = new anchor.Program(idl, provider);
  const M = program.methods as any;
  const A = program.account as any;

  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey, false, TOKEN_PROGRAM_ID);
  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), POOL.toBuffer(), kp.publicKey.toBuffer(), Buffer.from([HOLD])],
    program.programId
  );
  const bal = async () =>
    (await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID)).amount;

  const chainNow = async () =>
    BigInt((await connection.getBlockTime(await connection.getSlot("confirmed")))!);

  console.log("=".repeat(62));
  console.log("  Devnet end-to-end — hold to earn");
  console.log("=".repeat(62));
  console.log("wallet :", kp.publicKey.toBase58());
  console.log("holding:", fmt(await bal()), "tokens\n");

  // ── 1. sync moves nothing ──
  console.log("1. syncing (registering the wallet balance)…");
  const beforeSync = await bal();
  await M.sync()
    .accounts({
      pool: POOL,
      position,
      owner: kp.publicKey,
      ownerAta: ata,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  const afterSync = await bal();

  if (afterSync !== beforeSync) {
    console.log(`   ✖ FAIL — sync moved tokens (${fmt(beforeSync)} -> ${fmt(afterSync)})`);
    process.exit(1);
  }
  let pos = await A.position.fetch(position);
  console.log(`   ✓ balance unchanged at ${fmt(afterSync)} — nothing left the wallet`);
  console.log(`   registered weight: ${fmt(big(pos.weight))} (1.0x, no lock)`);
  if (big(pos.unlockTime) !== 0n) {
    console.log("   ✖ FAIL — holding must never set a lock");
    process.exit(1);
  }

  // ── 2. accrual + projection accuracy ──
  console.log("\n2. holding for 12s…");
  await sleep(12_000);

  let pool = await A.pool.fetch(POOL);
  pos = await A.position.fetch(position);
  const predicted = predict(pool, pos, await chainNow());
  console.log("   predicted claimable:", fmt(predicted));

  const beforeClaim = await bal();
  await M.claim()
    .accounts({
      pool: POOL, position, rewardMint: MINT, owner: kp.publicKey,
      ownerAta: ata, rewardVault: REWARD_VAULT, tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const received = (await bal()) - beforeClaim;
  console.log("   actually received  :", fmt(received));

  if (received < predicted) {
    console.log("   ✖ FAIL — paid LESS than projected; the UI would overstate balances.");
    process.exit(1);
  }
  console.log("   ✓ projection matches (paid slightly more, settled a moment later)");

  // ── 3. the sell defence ──
  console.log("\n3. selling 99% of the holding, then claiming…");
  const sink = Keypair.generate();
  const sinkAta = await createAssociatedTokenAccount(
    connection, kp, MINT, sink.publicKey, undefined, TOKEN_PROGRAM_ID
  );
  const held = await bal();
  const dump = (held * 99n) / 100n;
  await transfer(
    connection, kp, ata, sinkAta, kp, Number(dump), [], undefined, TOKEN_PROGRAM_ID
  );
  console.log(`   dumped ${fmt(dump)}; now holding ${fmt(await bal())}`);

  await sleep(12_000);

  pool = await A.pool.fetch(POOL);
  pos = await A.position.fetch(position);
  const stillRegistered = big(pos.weight);
  const naive = predict(pool, pos, await chainNow());

  const beforeClaim2 = await bal();
  await M.claim()
    .accounts({
      pool: POOL, position, rewardMint: MINT, owner: kp.publicKey,
      ownerAta: ata, rewardVault: REWARD_VAULT, tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const received2 = (await bal()) - beforeClaim2;

  console.log(`   still registered for: ${fmt(stillRegistered)} weight`);
  console.log(`   would have paid     : ${fmt(naive)} (if the program trusted registration)`);
  console.log(`   actually paid       : ${fmt(received2)}`);

  if (received2 >= naive / 2n) {
    console.log("\n   ✖ FAIL — seller was paid on tokens they no longer hold.");
    process.exit(1);
  }
  console.log("   ✓ payout collapsed to the balance actually held");

  console.log("\n" + "=".repeat(62));
  console.log("  All checks passed.");
  console.log("=".repeat(62));
}

main().catch((e) => {
  console.error("\ne2e failed:", e);
  process.exit(1);
});
