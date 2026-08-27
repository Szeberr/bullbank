/**
 * Simulate the sync instruction exactly as the frontend builds it, for a given
 * wallet, and print the program logs. Simulation needs no signature, so this
 * reproduces what Phantom saw without anyone approving anything.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import fs from "fs";

const RPC = process.env.RPC_URL!;
const MINT = new PublicKey(process.env.TOKEN_MINT!);
const POOL = new PublicKey(process.env.POOL_PDA!);
const USER = new PublicKey(process.env.USER!);

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const idl = JSON.parse(fs.readFileSync("./target/idl/staking.json", "utf-8"));
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(Keypair.generate()),
    { commitment: "confirmed" }
  );
  const program = new anchor.Program(idl, provider);

  console.log("program from IDL :", program.programId.toBase58());
  console.log("pool             :", POOL.toBase58());
  console.log("user             :", USER.toBase58());

  // Confirm the pool PDA the app is configured with is the real derived one.
  const [derived] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), MINT.toBuffer()],
    program.programId
  );
  console.log("derived pool     :", derived.toBase58(), derived.equals(POOL) ? "✓ match" : "✗ MISMATCH");

  const poolInfo = await connection.getAccountInfo(POOL);
  console.log("pool exists      :", !!poolInfo, poolInfo ? `owner=${poolInfo.owner.toBase58()}` : "");

  const mintInfo = await connection.getAccountInfo(MINT);
  const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  console.log("token program    :", tokenProgram.toBase58());

  const ata = getAssociatedTokenAddressSync(MINT, USER, false, tokenProgram);
  const ataInfo = await connection.getAccountInfo(ata);
  console.log("user ATA         :", ata.toBase58(), ataInfo ? "exists" : "MISSING");

  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), POOL.toBuffer(), USER.toBuffer(), Buffer.from([0])],
    program.programId
  );
  const posInfo = await connection.getAccountInfo(position);
  console.log("position PDA     :", position.toBase58(), posInfo ? "exists" : "new");

  const ix = await (program.methods as any)
    .sync()
    .accounts({
      pool: POOL,
      position,
      owner: USER,
      ownerAta: ata,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = USER;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  console.log("\n--- simulating ---");
  const sim = await connection.simulateTransaction(tx);
  console.log("err  :", JSON.stringify(sim.value.err));
  console.log("logs :");
  (sim.value.logs ?? []).forEach((l) => console.log("   ", l));
}

main().catch((e) => {
  console.error("sim failed:", e);
  process.exit(1);
});
