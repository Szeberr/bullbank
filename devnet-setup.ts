/**
 * One-shot devnet setup so the full deposit -> accrue -> settle -> withdraw path
 * can be exercised end to end before mainnet.
 *
 * Creates a test mint with the same 6 decimals a pump.fun token uses, mints a
 * supply to the operator wallet, initialises the pool and funds the reserve.
 * Prints the addresses to paste into bullbank/.env.
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import fs from "fs";
import os from "os";
import path from "path";

const RPC = process.env.RPC_URL!;
const DECIMALS = 6;
const ONE = BigInt(10) ** BigInt(DECIMALS);

// Test supply for the operator wallet.
const MINT_TO_WALLET = 500_000_000n * ONE; // 500M

// Deliberately fast so accrual is visible in the UI within seconds rather than
// days. Mainnet will be far slower.
const RATE_PER_SEC = 1n * ONE; // 1 token/sec
const FUND_AMOUNT = 10_000_000n * ONE; // ~115 days of runway at that rate

async function main() {
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          path.join(os.homedir(), ".config/solana/bullbank.json"),
          "utf-8"
        )
      )
    )
  );

  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(kp),
    { commitment: "confirmed" }
  );
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/staking.json", "utf-8")
  );
  const program = new anchor.Program(idl, provider);

  console.log("operator:", kp.publicKey.toBase58());
  console.log("program :", program.programId.toBase58());

  // ── mint ──
  console.log("\ncreating mint…");
  const mint = await createMint(
    connection,
    kp,
    kp.publicKey,
    null, // no freeze authority, same as a pump.fun token
    DECIMALS,
    Keypair.generate(),
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  console.log("mint    :", mint.toBase58());

  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    kp,
    mint,
    kp.publicKey,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  await mintTo(
    connection,
    kp,
    mint,
    ata.address,
    kp,
    MINT_TO_WALLET,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  console.log("minted  :", (MINT_TO_WALLET / ONE).toString(), "tokens to operator");

  // ── pool ──
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    program.programId
  );
  const stakeVault = Keypair.generate();
  const rewardVault = Keypair.generate();

  console.log("\ninitialising pool…");
  await (program.methods as any)
    .initializePool(new anchor.BN(RATE_PER_SEC.toString()))
    .accounts({
      authority: kp.publicKey,
      pool: poolPda,
      stakeMint: mint,
      rewardMint: mint,
      stakeVault: stakeVault.publicKey,
      rewardVault: rewardVault.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([stakeVault, rewardVault])
    .rpc();
  console.log("pool    :", poolPda.toBase58());

  console.log("\nfunding reserve…");
  await (program.methods as any)
    .fundRewards(new anchor.BN(FUND_AMOUNT.toString()))
    .accounts({
      pool: poolPda,
      rewardMint: mint,
      funder: kp.publicKey,
      funderRewardAta: ata.address,
      rewardVault: rewardVault.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  const pool: any = await (program.account as any).pool.fetch(poolPda);
  const runwayDays =
    (pool.rewardEndTime.toNumber() - Math.floor(Date.now() / 1000)) / 86400;

  console.log("\n" + "=".repeat(62));
  console.log("Paste into bullbank/.env:\n");
  console.log(`VITE_TOKEN_MINT=${mint.toBase58()}`);
  console.log(`VITE_POOL_PDA=${poolPda.toBase58()}`);
  console.log(`VITE_STAKE_VAULT=${stakeVault.publicKey.toBase58()}`);
  console.log(`VITE_REWARD_VAULT=${rewardVault.publicKey.toBase58()}`);
  console.log("\n" + "=".repeat(62));
  console.log("rate    :", (RATE_PER_SEC / ONE).toString(), "token/sec");
  console.log("runway  :", runwayDays.toFixed(1), "days");
  console.log("operator holds:", ((MINT_TO_WALLET - FUND_AMOUNT) / ONE).toString(), "tokens");
}

main().catch((e) => {
  console.error("setup failed:", e);
  process.exit(1);
});
