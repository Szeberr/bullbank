/**
 * BullBank buyback crank.
 *
 *   creator-fee SOL  ->  market buy BULL  ->  fund_rewards  ->  stakers accrue
 *
 * Run on a schedule (cron / GitHub Action / a small VM). Every run is a DRY RUN
 * unless `--execute` is passed, because this script spends real money and the
 * failure mode of a bad config is "swapped the treasury into the wrong token".
 *
 * Safety rules baked in, in rough order of how badly they bite if missing:
 *
 *  1. Dry run by default. `--execute` is the only way to send anything.
 *  2. A gas reserve is never spent, so the wallet can always pay fees.
 *  3. MAX_SPEND_SOL caps a single run. A misconfigured balance read cannot
 *     drain the wallet in one go.
 *  4. The Jupiter quote is checked: output mint must be exactly the BULL mint,
 *     and price impact must be under a threshold. A third-party API builds this
 *     transaction — it is verified before signing, never trusted blindly.
 *  5. The actual token delta is measured after the swap and that measured amount
 *     is what gets deposited. `fund_rewards` is never told a number the wallet
 *     did not really receive.
 *
 * The fee-claim leg uses PumpPortal's local endpoint and verifies the returned
 * transaction by simulation before signing — see claimCreatorFees().
 */

import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

// ESM has no __dirname; @solana/spl-token is ESM-only so this package must be too.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────────── config ─────────────────────────────

const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",

  /** Creator wallet: receives pump.fun creator fees, signs the buyback. */
  keypairPath:
    process.env.CRANK_KEYPAIR ||
    path.join(os.homedir(), ".config/solana/bullbank.json"),

  programId: new PublicKey(
    process.env.PROGRAM_ID || "BLj7FScr8f57ygqFGJJtZ3sVRCx7C7gUQihyUWYptBYq"
  ),
  tokenMint: process.env.TOKEN_MINT ? new PublicKey(process.env.TOKEN_MINT) : null,
  poolPda: process.env.POOL_PDA ? new PublicKey(process.env.POOL_PDA) : null,
  rewardVault: process.env.REWARD_VAULT
    ? new PublicKey(process.env.REWARD_VAULT)
    : null,

  /** Never spend below this. Pays for the swap, the deposit and the next run. */
  gasReserveSol: Number(process.env.GAS_RESERVE_SOL || 0.05),
  /** Do not bother running for dust — the fees would eat the deposit. */
  minSpendSol: Number(process.env.MIN_SPEND_SOL || 0.02),
  /** Hard ceiling on a single run. */
  maxSpendSol: Number(process.env.MAX_SPEND_SOL || 5),

  /** Priority fee (SOL) used when asking PumpPortal to build the claim. */
  priorityFeeSol: Number(process.env.PRIORITY_FEE_SOL || 0.000001),

  /** Basis points. 100 = 1%. */
  slippageBps: Number(process.env.SLIPPAGE_BPS || 150),
  /** Refuse a swap that moves the market more than this (percent). */
  maxPriceImpactPct: Number(process.env.MAX_PRICE_IMPACT_PCT || 3),
};

const WSOL = "So11111111111111111111111111111111111111112";
/**
 * Jupiter swap API.
 *
 * The old `quote-api.jup.ag/v6` host has been retired — it still resolves as a
 * name but publishes no A records, so every call fails with a DNS error rather
 * than an HTTP status. That would have taken the buyback leg down on the first
 * real run. Overridable by env so the next migration needs no code change.
 */
const JUPITER = process.env.JUPITER_API || "https://lite-api.jup.ag/swap/v1";
const EXECUTE = process.argv.includes("--execute");

// ───────────────────────────── helpers ─────────────────────────────

const log = (...a: unknown[]) => console.log(...a);
const fail = (msg: string): never => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

function loadKeypair(p: string): Keypair {
  if (!fs.existsSync(p)) fail(`Keypair not found at ${p}`);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8")))
  );
}

function requireConfig() {
  const missing: string[] = [];
  if (!CONFIG.tokenMint) missing.push("TOKEN_MINT");
  if (!CONFIG.poolPda) missing.push("POOL_PDA");
  if (!CONFIG.rewardVault) missing.push("REWARD_VAULT");
  if (missing.length) {
    fail(
      `Missing env: ${missing.join(", ")}\n` +
        `  These come from pool-addresses.json after init-pool-bullbank.ts runs.`
    );
  }
}

async function detectTokenProgram(
  conn: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint);
  if (!info) fail(`Mint ${mint.toBase58()} does not exist on this cluster.`);
  return info!.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

async function tokenBalance(
  conn: Connection,
  ata: PublicKey,
  programId: PublicKey
): Promise<bigint> {
  try {
    const acc = await getAccount(conn, ata, "confirmed", programId);
    return acc.amount;
  } catch {
    return 0n;
  }
}

// ─────────────────────── step 1: claim creator fees ───────────────────────

/**
 * Claim accumulated pump.fun creator fees into the creator wallet.
 *
 * Uses PumpPortal's LOCAL endpoint (`/api/trade-local`), which returns an
 * unsigned transaction. The Lightning variant would be simpler but requires
 * handing them an API key tied to a wallet they custody — this way they never
 * see a private key and the only thing we accept from them is bytes we verify.
 *
 * pump.fun settles all of a creator's fees at once, so no mint is specified.
 *
 * THE VERIFICATION IS THE POINT. A remote service is handing us a transaction
 * that our key will sign. Three checks before that happens:
 *
 *   1. Our wallet is the only required signer. If anything else must sign, or
 *      the fee payer is not us, something is wrong with the request.
 *   2. The transaction is simulated first, and the wallet's post-simulation
 *      lamport balance must be HIGHER than before. This is the strong one: a
 *      claim, by definition, pays us. Any transaction that drains the wallet —
 *      whatever instructions it contains — fails this check and is never
 *      signed. It does not require us to recognise every instruction.
 *   3. Simulation must succeed. A transaction that reverts is not worth sending.
 *
 * Returns the lamports actually gained, measured from real balances rather than
 * anything the API reported.
 */
async function claimCreatorFees(
  conn: Connection,
  payer: Keypair
): Promise<bigint> {
  let res: Response;
  try {
    res = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: payer.publicKey.toBase58(),
        action: "collectCreatorFee",
        priorityFee: CONFIG.priorityFeeSol,
      }),
    });
  } catch (e) {
    log(`  ⓘ Fee claim skipped — could not reach PumpPortal (${String(e)})`);
    return 0n;
  }

  if (!res.ok) {
    const body = await res.text();
    // No fees to claim is a normal, frequent outcome, not a failure.
    log(`  ⓘ Fee claim skipped — PumpPortal returned ${res.status}: ${body.slice(0, 160)}`);
    return 0n;
  }

  const raw = new Uint8Array(await res.arrayBuffer());
  if (raw.length === 0) {
    log("  ⓘ Fee claim skipped — empty transaction returned (usually means nothing to claim).");
    return 0n;
  }

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(raw);
  } catch {
    fail("PumpPortal returned something that is not a transaction. Refusing to sign.");
  }

  // ── check 1: we are the only signer ──
  const signers = tx!.message.staticAccountKeys.slice(
    0,
    tx!.message.header.numRequiredSignatures
  );
  if (signers.length !== 1 || !signers[0].equals(payer.publicKey)) {
    fail(
      `Unexpected signer set on the fee-claim transaction: ${signers
        .map((s) => s.toBase58())
        .join(", ")}\n  Refusing to sign.`
    );
  }

  // ── checks 2 and 3: simulate, and require the balance to go UP ──
  const before = BigInt(await conn.getBalance(payer.publicKey));
  const sim = await conn.simulateTransaction(tx!, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: {
      encoding: "base64",
      addresses: [payer.publicKey.toBase58()],
    },
  });

  if (sim.value.err) {
    log(
      `  ⓘ Fee claim skipped — simulation failed (${JSON.stringify(sim.value.err)}). ` +
        `Usually means there is nothing to claim yet.`
    );
    return 0n;
  }

  const simulated = sim.value.accounts?.[0];
  if (!simulated) {
    fail("Simulation returned no balance for the wallet. Refusing to sign blind.");
  }
  const after = BigInt(simulated!.lamports);

  if (after <= before) {
    const loss = before - after;
    // Two very different situations, and an unattended cron must tell them apart.
    //
    // A small loss is the ordinary "no fees have accrued yet" case: the claim
    // costs a signature and a priority fee and returns nothing. That happens most
    // runs and is not an error — skip quietly and get on with the buyback.
    //
    // A large loss is somebody trying to drain the wallet. That must stop
    // everything and be loud, because it means the transaction we were handed is
    // not what we asked for.
    const dustThreshold = BigInt(
      Math.floor((CONFIG.priorityFeeSol + 0.01) * LAMPORTS_PER_SOL)
    );

    if (loss <= dustThreshold) {
      log(
        `  ⓘ No creator fees to claim right now ` +
          `(claiming would cost ${(Number(loss) / LAMPORTS_PER_SOL).toFixed(6)} SOL and return nothing).`
      );
      return 0n;
    }

    fail(
      `REFUSING TO SIGN. The fee-claim transaction would REDUCE the wallet by ` +
        `${(Number(loss) / LAMPORTS_PER_SOL).toFixed(6)} SOL ` +
        `(${before} -> ${after} lamports).\n` +
        `  A claim must pay us, and this is far beyond a network fee. ` +
        `Treat this as hostile until proven otherwise.`
    );
  }

  const expectedGain = after - before;
  log(`  claim would net ~${(Number(expectedGain) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  if (!EXECUTE) {
    log("  (dry run — not signing)");
    return 0n;
  }

  // Refresh the blockhash: the one PumpPortal built with may be stale by now.
  const latest = await conn.getLatestBlockhash("confirmed");
  tx!.message.recentBlockhash = latest.blockhash;
  tx!.sign([payer]);

  const sig = await conn.sendTransaction(tx!, { maxRetries: 3 });
  const conf = await conn.confirmTransaction(
    { signature: sig, ...latest },
    "confirmed"
  );
  if (conf.value.err) {
    fail(`Fee claim failed on chain: ${JSON.stringify(conf.value.err)}`);
  }

  const actual = BigInt(await conn.getBalance(payer.publicKey)) - before;
  log(`  ✓ claimed ${(Number(actual) / LAMPORTS_PER_SOL).toFixed(6)} SOL  ${sig}`);
  return actual > 0n ? actual : 0n;
}

// ─────────────────────── step 2: buy BULL with SOL ───────────────────────

interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
}

async function getQuote(lamports: bigint): Promise<JupQuote> {
  const url =
    `${JUPITER}/quote?inputMint=${WSOL}&outputMint=${CONFIG.tokenMint!.toBase58()}` +
    `&amount=${lamports}&slippageBps=${CONFIG.slippageBps}&swapMode=ExactIn`;

  const res = await fetch(url);
  if (!res.ok) fail(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  const quote = (await res.json()) as JupQuote;

  // Verify the quote before it becomes a transaction. A wrong output mint here
  // means buying somebody else's token with the reward budget.
  if (quote.outputMint !== CONFIG.tokenMint!.toBase58()) {
    fail(
      `Quote output mint mismatch.\n  expected ${CONFIG.tokenMint!.toBase58()}\n  got      ${quote.outputMint}`
    );
  }
  if (quote.inputMint !== WSOL) fail(`Quote input mint is not wSOL: ${quote.inputMint}`);

  // priceImpactPct is a FRACTION, not a percentage — verified against the live
  // API: a 100 SOL SOL->USDC quote returns "0.0000142158…", i.e. 0.0014%. So the
  // x100 below is correct, and the guard is not the hundred-times-too-loose
  // hazard it was previously suspected of being.
  const impact = Number(quote.priceImpactPct) * 100;
  if (impact > CONFIG.maxPriceImpactPct) {
    fail(
      `Price impact ${impact.toFixed(2)}% exceeds the ${CONFIG.maxPriceImpactPct}% limit.\n` +
        `  Lower MAX_SPEND_SOL or run more often with smaller amounts.`
    );
  }

  return quote;
}

async function executeSwap(
  conn: Connection,
  payer: Keypair,
  quote: JupQuote
): Promise<string> {
  const res = await fetch(`${JUPITER}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: payer.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!res.ok) fail(`Jupiter swap build failed: ${res.status} ${await res.text()}`);

  const { swapTransaction } = (await res.json()) as { swapTransaction: string };
  const tx = VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, "base64")
  );

  // The transaction came from a third party. At minimum, confirm our key is the
  // fee payer and the only required signer before handing over a signature.
  const signers = tx.message.staticAccountKeys.slice(
    0,
    tx.message.header.numRequiredSignatures
  );
  if (signers.length !== 1 || !signers[0].equals(payer.publicKey)) {
    fail(
      `Unexpected signer set on the swap transaction: ${signers
        .map((s) => s.toBase58())
        .join(", ")}`
    );
  }

  tx.sign([payer]);

  // Read before sending. A blockhash fetched afterwards describes a later expiry
  // window than the transaction itself has, so a dropped send would be waited on
  // past the point it could still land.
  const latest = await conn.getLatestBlockhash("confirmed");
  const sig = await conn.sendTransaction(tx, { maxRetries: 3 });

  const conf = await conn.confirmTransaction(
    { signature: sig, ...latest },
    "confirmed"
  );
  if (conf.value.err) fail(`Swap failed on chain: ${JSON.stringify(conf.value.err)}`);

  return sig;
}

// ─────────────────────── step 3: fund the reserve ───────────────────────

async function fundRewards(
  conn: Connection,
  payer: Keypair,
  amount: bigint,
  tokenProgram: PublicKey,
  funderAta: PublicKey
): Promise<string> {
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "idl.json"), "utf-8")
  ) as Idl;

  const provider = new AnchorProvider(conn, new Wallet(payer), {
    commitment: "confirmed",
  });
  const program = new Program(idl, provider);

  return program.methods
    .fundRewards(new BN(amount.toString()))
    .accounts({
      pool: CONFIG.poolPda!,
      rewardMint: CONFIG.tokenMint!,
      funder: payer.publicKey,
      funderRewardAta: funderAta,
      rewardVault: CONFIG.rewardVault!,
      tokenProgram,
    })
    .rpc();
}

// ───────────────────────────── main ─────────────────────────────

async function main() {
  log("═".repeat(58));
  log("  BullBank buyback crank");
  log(`  mode: ${EXECUTE ? "EXECUTE — will spend real funds" : "DRY RUN"}`);
  log("═".repeat(58));

  requireConfig();

  const conn = new Connection(CONFIG.rpcUrl, "confirmed");
  const payer = loadKeypair(CONFIG.keypairPath);
  const tokenProgram = await detectTokenProgram(conn, CONFIG.tokenMint!);
  const funderAta = getAssociatedTokenAddressSync(
    CONFIG.tokenMint!,
    payer.publicKey,
    false,
    tokenProgram
  );

  log(`\n  wallet   ${payer.publicKey.toBase58()}`);
  log(`  mint     ${CONFIG.tokenMint!.toBase58()}`);
  log(`  reserve  ${CONFIG.rewardVault!.toBase58()}`);

  const claimed = await claimCreatorFees(conn, payer);
  if (claimed > 0n) {
    log(
      `  fresh fees this run: ${(Number(claimed) / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );
  }

  // How much is spendable this run?
  const lamports = BigInt(await conn.getBalance(payer.publicKey));
  const reserve = BigInt(Math.floor(CONFIG.gasReserveSol * LAMPORTS_PER_SOL));
  const maxSpend = BigInt(Math.floor(CONFIG.maxSpendSol * LAMPORTS_PER_SOL));

  log(`\n  balance  ${(Number(lamports) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  log(`  reserve  ${CONFIG.gasReserveSol} SOL held back for fees`);

  if (lamports <= reserve) {
    log("\n  Nothing above the gas reserve. Exiting cleanly.");
    return;
  }

  let spend = lamports - reserve;
  if (spend > maxSpend) {
    log(`  capped   ${CONFIG.maxSpendSol} SOL (MAX_SPEND_SOL)`);
    spend = maxSpend;
  }

  const spendSol = Number(spend) / LAMPORTS_PER_SOL;
  if (spendSol < CONFIG.minSpendSol) {
    log(
      `\n  ${spendSol.toFixed(4)} SOL is below MIN_SPEND_SOL (${CONFIG.minSpendSol}). ` +
        `Leaving it to accumulate.`
    );
    return;
  }

  log(`  spending ${spendSol.toFixed(4)} SOL\n`);

  const quote = await getQuote(spend);
  const expected = BigInt(quote.outAmount);
  const worstCase = BigInt(quote.otherAmountThreshold);

  log(`  quote    ${expected} base units expected`);
  log(`           ${worstCase} minimum after ${CONFIG.slippageBps / 100}% slippage`);
  log(`  impact   ${(Number(quote.priceImpactPct) * 100).toFixed(3)}%`);

  if (!EXECUTE) {
    log("\n  DRY RUN — nothing sent. Re-run with --execute to perform the buyback.");
    log("═".repeat(58));
    return;
  }

  const before = await tokenBalance(conn, funderAta, tokenProgram);
  log("\n  swapping…");
  const swapSig = await executeSwap(conn, payer, quote);
  log(`  ✓ swap ${swapSig}`);

  const after = await tokenBalance(conn, funderAta, tokenProgram);
  const received = after - before;

  // Deposit what actually arrived, not what was quoted. Slippage means these
  // differ, and depositing a number the wallet does not hold just fails.
  if (received <= 0n) {
    fail("Swap confirmed but the token balance did not increase. Not depositing.");
  }
  log(`  received ${received} base units`);

  log("\n  funding reserve…");
  const fundSig = await fundRewards(
    conn,
    payer,
    received,
    tokenProgram,
    funderAta
  );
  log(`  ✓ fund ${fundSig}`);

  log("\n  Done. Emission runway extended; stakers accrue against it.");
  log("═".repeat(58));
}

main().catch((e) => {
  console.error("\n✖ Crank failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
