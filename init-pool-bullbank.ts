/**
 * BullBank — emissions pool bootstrap.
 *
 * Two steps, run in this order:
 *   1. initializePool(rewardRatePerSec)  — creates pool + both vaults
 *   2. fundRewards(amount)               — moves the staking allocation in and
 *                                          starts the emissions clock
 *
 * The rate is FIXED FOREVER at step 1. There is no instruction to change it.
 * Get the numbers below right before you run this.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";
import path from "path";
import os from "os";

// ────────────────────────── CONFIG — EDIT THIS ──────────────────────────
const RPC_URL    = "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey("BLj7FScr8f57ygqFGJJtZ3sVRCx7C7gUQihyUWYptBYq");
const TOKEN_MINT = new PublicKey("REPLACE_WITH_BULLBANK_MINT");

const DECIMALS = 6;                        // check the real mint before trusting this
const TOTAL_SUPPLY = 1_000_000_000;        // 1B BULLBANK
const EMISSIONS_PCT = 20;                  // % of supply reserved for staking rewards
const EMISSIONS_YEARS = 2;                 // how long that allocation should last
// ────────────────────────────────────────────────────────────────────────

const BASE = BigInt(10) ** BigInt(DECIMALS);
const EMISSIONS_TOTAL = (BigInt(TOTAL_SUPPLY) * BigInt(EMISSIONS_PCT)) / BigInt(100);
const EMISSIONS_BASE_UNITS = EMISSIONS_TOTAL * BASE;
const DURATION_SECS = BigInt(Math.floor(EMISSIONS_YEARS * 365 * 24 * 60 * 60));
const RATE_PER_SEC = EMISSIONS_BASE_UNITS / DURATION_SECS;

function fmt(baseUnits: bigint): string {
  return (Number(baseUnits) / Number(BASE)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "init" && mode !== "fund") {
    console.error("usage: ts-node init-pool-bullbank.ts <init|fund>");
    process.exit(1);
  }

  const keypairPath = path.join(os.homedir(), ".config/solana/id.json");
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8")))
  );

  const connection = new Connection(RPC_URL, "confirmed");
  const idl = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "target/idl/staking.json"), "utf-8")
  );
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(keypair),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(idl, provider);

  const [poolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), TOKEN_MINT.toBuffer()],
    PROGRAM_ID
  );

  console.log("═══════════════════════════════════════");
  console.log("🐂 BullBank — emissions pool");
  console.log("═══════════════════════════════════════");
  console.log("Authority :", keypair.publicKey.toBase58());
  console.log("Mint      :", TOKEN_MINT.toBase58());
  console.log("Pool PDA  :", poolPDA.toBase58());

  if (mode === "init") {
    const existing = await connection.getAccountInfo(poolPDA);
    if (existing) {
      console.log("Pool already exists — nothing to do.");
      return;
    }

    console.log("");
    console.log("Emissions schedule (LOCKED IN PERMANENTLY BY THIS TX):");
    console.log("  allocation :", fmt(EMISSIONS_BASE_UNITS), "BULLBANK",
                `(${EMISSIONS_PCT}% of supply)`);
    console.log("  duration   :", EMISSIONS_YEARS, "years");
    console.log("  rate       :", fmt(RATE_PER_SEC), "BULLBANK / second");
    console.log("  per day    :", fmt(RATE_PER_SEC * BigInt(86400)), "BULLBANK");
    console.log("");

    // Both vaults are freshly generated token accounts owned by the pool PDA.
    // They MUST be different accounts — the program rejects it otherwise, since
    // stake mint and reward mint are the same token here.
    const stakeVaultKp = Keypair.generate();
    const rewardVaultKp = Keypair.generate();
    console.log("Stake vault :", stakeVaultKp.publicKey.toBase58());
    console.log("Reward vault:", rewardVaultKp.publicKey.toBase58());

    const tx = await (program.methods as any)
      .initializePool(new anchor.BN(RATE_PER_SEC.toString()))
      .accounts({
        authority: keypair.publicKey,
        pool: poolPDA,
        stakeMint: TOKEN_MINT,
        rewardMint: TOKEN_MINT,
        stakeVault: stakeVaultKp.publicKey,
        rewardVault: rewardVaultKp.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([keypair, stakeVaultKp, rewardVaultKp])
      .rpc();

    console.log("");
    console.log("✅ Pool initialized. TX:", tx);

    const out = {
      programId: PROGRAM_ID.toBase58(),
      tokenMint: TOKEN_MINT.toBase58(),
      decimals: DECIMALS,
      poolPda: poolPDA.toBase58(),
      stakeVault: stakeVaultKp.publicKey.toBase58(),
      rewardVault: rewardVaultKp.publicKey.toBase58(),
      rewardRatePerSec: RATE_PER_SEC.toString(),
      emissionsTotal: EMISSIONS_BASE_UNITS.toString(),
      emissionsYears: EMISSIONS_YEARS,
    };
    fs.writeFileSync("./pool-addresses.json", JSON.stringify(out, null, 2));
    console.log("Saved pool-addresses.json — the frontend reads these.");
    console.log("");
    console.log("NOTE: emissions have NOT started. Run `fund` next.");
    return;
  }

  // ── fund ──
  const addrs = JSON.parse(fs.readFileSync("./pool-addresses.json", "utf-8"));
  const rewardVault = new PublicKey(addrs.rewardVault);
  const funderAta = await getAssociatedTokenAddress(TOKEN_MINT, keypair.publicKey);

  const bal = (await getAccount(connection, funderAta)).amount;
  console.log("");
  console.log("Funder balance:", fmt(bal), "BULLBANK");
  console.log("Depositing    :", fmt(EMISSIONS_BASE_UNITS), "BULLBANK");

  if (bal < EMISSIONS_BASE_UNITS) {
    console.error("❌ Not enough BULLBANK in the funding wallet. Aborting.");
    process.exit(1);
  }

  const tx = await (program.methods as any)
    .fundRewards(new anchor.BN(EMISSIONS_BASE_UNITS.toString()))
    .accounts({
      pool: poolPDA,
      rewardMint: TOKEN_MINT,
      funder: keypair.publicKey,
      funderRewardAta: funderAta,
      rewardVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log("");
  console.log("✅ Emissions funded and running. TX:", tx);
  console.log("Once funded, these tokens can never be withdrawn by anyone —");
  console.log("they can only leave the vault through staker claims.");
  console.log("═══════════════════════════════════════");
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
