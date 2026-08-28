import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  transfer,
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import assert from "assert";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ONE = 1_000_000n; // 6 decimals
const RATE = ONE; // 1 token/sec — fast so accrual is visible in seconds
const HOLD = 0;

const TP = TOKEN_2022_PROGRAM_ID;

async function setup(
  provider: anchor.AnchorProvider,
  program: Program,
  authority: Keypair,
  holders: Keypair[],
  perHolder: bigint
) {
  for (const kp of holders) {
    const s = await provider.connection.requestAirdrop(
      kp.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(s);
  }

  const mint = await createMint(
    provider.connection, authority, authority.publicKey, null, 6,
    Keypair.generate(), undefined, TP
  );

  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()], program.programId
  );

  const stakeVault = Keypair.generate();
  const rewardVault = Keypair.generate();

  await (program.methods as any)
    .initializePool(new anchor.BN(RATE.toString()))
    .accounts({
      authority: authority.publicKey, pool: poolPda,
      stakeMint: mint, rewardMint: mint,
      stakeVault: stakeVault.publicKey, rewardVault: rewardVault.publicKey,
      tokenProgram: TP, systemProgram: SystemProgram.programId,
    })
    .signers([stakeVault, rewardVault])
    .rpc();

  const atas: Record<string, PublicKey> = {};
  for (const kp of holders) {
    const ata = await createAssociatedTokenAccount(
      provider.connection, kp, mint, kp.publicKey, undefined, TP
    );
    await mintTo(provider.connection, authority, mint, ata, authority, perHolder, [], undefined, TP);
    atas[kp.publicKey.toBase58()] = ata;
  }

  const authorityAta = await createAssociatedTokenAccount(
    provider.connection, authority, mint, authority.publicKey, undefined, TP
  );

  return { mint, poolPda, stakeVault: stakeVault.publicKey, rewardVault: rewardVault.publicKey, atas, authorityAta };
}

describe("bullbank — hold to earn (sync model)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require("../target/idl/staking.json");
  const program = new anchor.Program(idl, provider) as Program;
  const authority = (provider.wallet as anchor.Wallet).payer;

  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const HELD = 1_000n * ONE;
  const FUND = RATE * 3600n;

  let env: Awaited<ReturnType<typeof setup>>;

  const positionPda = (owner: PublicKey, tier: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), env.poolPda.toBuffer(), owner.toBuffer(), Buffer.from([tier])],
      program.programId
    )[0];

  const bal = async (ata: PublicKey) =>
    (await getAccount(provider.connection, ata, undefined, TP)).amount;

  const syncFor = (kp: Keypair) =>
    (program.methods as any).sync()
      .accounts({
        pool: env.poolPda,
        position: positionPda(kp.publicKey, HOLD),
        owner: kp.publicKey,
        ownerAta: env.atas[kp.publicKey.toBase58()],
        systemProgram: SystemProgram.programId,
      })
      .signers([kp]).rpc();

  const claimFor = (kp: Keypair, tier = HOLD) =>
    (program.methods as any).claim()
      .accounts({
        pool: env.poolPda,
        position: positionPda(kp.publicKey, tier),
        rewardMint: env.mint,
        owner: kp.publicKey,
        ownerAta: env.atas[kp.publicKey.toBase58()],
        rewardVault: env.rewardVault,
        tokenProgram: TP,
      })
      .signers([kp]).rpc();

  before(async () => {
    env = await setup(provider, program, authority, [alice, bob], HELD);
    await mintTo(provider.connection, authority, env.mint, env.authorityAta, authority, FUND, [], undefined, TP);
    await (program.methods as any)
      .fundRewards(new anchor.BN(FUND.toString()))
      .accounts({
        pool: env.poolPda, rewardMint: env.mint, funder: authority.publicKey,
        funderRewardAta: env.authorityAta, rewardVault: env.rewardVault, tokenProgram: TP,
      }).rpc();
  });

  it("sync registers the wallet balance without moving any tokens", async () => {
    const before = await bal(env.atas[alice.publicKey.toBase58()]);
    await syncFor(alice);
    const after = await bal(env.atas[alice.publicKey.toBase58()]);

    assert.equal(after, before, "sync must not transfer the holder's tokens");

    const pos: any = await (program.account as any).position.fetch(
      positionPda(alice.publicKey, HOLD)
    );
    assert.equal(pos.balance.toString(), HELD.toString());
    assert.equal(pos.weight.toString(), HELD.toString(), "hold tier is 1.0x");
    assert.equal(pos.unlockTime.toString(), "0", "holding never locks");
  });

  it("earns while simply holding, and claim pays out", async () => {
    await sleep(6000);
    const before = await bal(env.atas[alice.publicKey.toBase58()]);
    await claimFor(alice);
    const gained = (await bal(env.atas[alice.publicKey.toBase58()])) - before;

    console.log(`    sole holder earned ${Number(gained) / Number(ONE)} tokens`);
    assert.ok(gained > 0n, "a sole synced holder must earn");
    // Sole participant, so close to the full emission for the elapsed time.
    assert.ok(gained <= RATE * 30n, "cannot exceed rate * elapsed");
  });

  it("SECURITY: selling after sync stops the earnings", async () => {
    // Bob registers his full balance, then dumps almost all of it. If the program
    // paid on the registered figure he would keep earning on tokens he no longer
    // owns — the central exploit this model has to defend against.
    await syncFor(bob);
    const bobAta = env.atas[bob.publicKey.toBase58()];
    const aliceAta = env.atas[alice.publicKey.toBase58()];

    await transfer(
      provider.connection, bob, bobAta, aliceAta, bob,
      Number(900n * ONE), [], undefined, TP
    );
    const remaining = await bal(bobAta);
    assert.ok(remaining < 200n * ONE, "bob should be nearly empty now");

    await sleep(8000);

    const before = await bal(bobAta);
    await claimFor(bob);
    const gained = (await bal(bobAta)) - before;

    // He held ~100 of 1000 registered, so he should collect roughly a tenth of
    // what an honest holder of the same registered size would.
    const honestUpperBound = RATE * 8n;
    console.log(
      `    seller earned ${Number(gained) / Number(ONE)} tokens ` +
        `(an honest holder would get up to ${Number(honestUpperBound) / Number(ONE)})`
    );
    assert.ok(
      gained < honestUpperBound / 2n,
      `seller collected ${gained}, far too close to the honest amount`
    );
  });

  it("rejects syncing someone else's token account", async () => {
    try {
      await (program.methods as any).sync()
        .accounts({
          pool: env.poolPda,
          position: positionPda(bob.publicKey, HOLD),
          owner: bob.publicKey,
          // Alice's account — bob must not be able to register her balance.
          ownerAta: env.atas[alice.publicKey.toBase58()],
          systemProgram: SystemProgram.programId,
        })
        .signers([bob]).rpc();
      assert.fail("should have rejected a foreign token account");
    } catch (e: any) {
      assert.ok(e.toString().includes("WrongOwner"), e.toString());
    }
  });

  it("rejects stake() on the hold tier", async () => {
    try {
      await (program.methods as any).stake(HOLD, new anchor.BN((10n * ONE).toString()))
        .accounts({
          pool: env.poolPda, position: positionPda(alice.publicKey, HOLD),
          stakeMint: env.mint, owner: alice.publicKey,
          ownerAta: env.atas[alice.publicKey.toBase58()],
          stakeVault: env.stakeVault,
          tokenProgram: TP, systemProgram: SystemProgram.programId,
        }).signers([alice]).rpc();
      assert.fail("tier 0 must not accept deposits");
    } catch (e: any) {
      assert.ok(e.toString().includes("UseSyncForHolding"), e.toString());
    }
  });

  it("rejects unstake() on a hold position — nothing is locked", async () => {
    try {
      await (program.methods as any).unstake(new anchor.BN((1n * ONE).toString()))
        .accounts({
          pool: env.poolPda, position: positionPda(alice.publicKey, HOLD),
          stakeMint: env.mint, owner: alice.publicKey,
          ownerAta: env.atas[alice.publicKey.toBase58()],
          stakeVault: env.stakeVault, tokenProgram: TP,
        }).signers([alice]).rpc();
      assert.fail("hold positions hold nothing in the vault");
    } catch (e: any) {
      assert.ok(e.toString().includes("NothingLocked"), e.toString());
    }
  });

  it("locking still works and carries a higher weight per token", async () => {
    const amount = 100n * ONE;
    await (program.methods as any).stake(3, new anchor.BN(amount.toString()))
      .accounts({
        pool: env.poolPda, position: positionPda(alice.publicKey, 3),
        stakeMint: env.mint, owner: alice.publicKey,
        ownerAta: env.atas[alice.publicKey.toBase58()],
        stakeVault: env.stakeVault,
        tokenProgram: TP, systemProgram: SystemProgram.programId,
      }).signers([alice]).rpc();

    const pos: any = await (program.account as any).position.fetch(
      positionPda(alice.publicKey, 3)
    );
    assert.equal(pos.balance.toString(), amount.toString());
    assert.equal(pos.weight.toString(), (amount * 2n).toString(), "tier 3 is 2.0x");
    assert.ok(pos.unlockTime.toNumber() > 0, "locking sets a term");
  });

  it("exposes no instruction that can drain the vaults", () => {
    const names: string[] = idl.instructions.map((i: any) => i.name).sort();
    assert.deepEqual(
      names,
      // Reviewed individually. `poke` moves no funds at all: it only rewrites a
      // position weight to the balance read from the chain, and settles at
      // min(registered, current) so it can never pay more than was owed.
      ["claim", "fund_rewards", "initialize_pool", "poke", "stake", "sync", "unstake"].sort(),
      "unexpected instruction — review it before adding it here; it must not be able to move funds to an admin"
    );
  });
});

describe("bullbank — reserve solvency", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require("../target/idl/staking.json");
  const program = new anchor.Program(idl, provider) as Program;
  const authority = (provider.wallet as anchor.Wallet).payer;

  const carol = Keypair.generate();
  const HELD = 1_000n * ONE;
  const RUNWAY = 8n; // seconds of emissions
  const FUND = RATE * RUNWAY; // 8 tokens, and not one more

  let env: Awaited<ReturnType<typeof setup>>;

  const positionPda = (owner: PublicKey, tier: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), env.poolPda.toBuffer(), owner.toBuffer(), Buffer.from([tier])],
      program.programId
    )[0];

  before(async () => {
    env = await setup(provider, program, authority, [carol], HELD);
    await mintTo(provider.connection, authority, env.mint, env.authorityAta, authority, FUND, [], undefined, TP);
  });

  it("never pays out more than was funded, however long you wait", async () => {
    const ata = env.atas[carol.publicKey.toBase58()];
    const pos = positionPda(carol.publicKey, HOLD);

    // Register first, then fund, so the whole schedule is earnable by Carol —
    // the only participant.
    await (program.methods as any).sync()
      .accounts({
        pool: env.poolPda, position: pos, owner: carol.publicKey,
        ownerAta: ata, systemProgram: SystemProgram.programId,
      }).signers([carol]).rpc();

    await (program.methods as any)
      .fundRewards(new anchor.BN(FUND.toString()))
      .accounts({
        pool: env.poolPda, rewardMint: env.mint, funder: authority.publicKey,
        funderRewardAta: env.authorityAta, rewardVault: env.rewardVault, tokenProgram: TP,
      }).rpc();

    // Wait well past the end of the schedule. If accrual ignored
    // reward_end_time this would try to pay roughly 25 tokens out of an
    // 8-token reserve — either failing the transfer or draining it and leaving
    // later claimers with nothing.
    await sleep(25_000);

    const before = (await getAccount(provider.connection, ata, undefined, TP)).amount;
    await (program.methods as any).claim()
      .accounts({
        pool: env.poolPda, position: pos, rewardMint: env.mint, owner: carol.publicKey,
        ownerAta: ata, rewardVault: env.rewardVault, tokenProgram: TP,
      }).signers([carol]).rpc();
    const paid = (await getAccount(provider.connection, ata, undefined, TP)).amount - before;

    console.log(
      `    paid ${Number(paid) / Number(ONE)} of an ${Number(FUND) / Number(ONE)}-token schedule after waiting 25s`
    );
    assert.ok(paid <= FUND, `paid ${paid} from a reserve of ${FUND} — insolvent`);
    assert.ok(paid > FUND / 2n, "sole holder should receive most of the schedule");

    const vault = (await getAccount(provider.connection, env.rewardVault, undefined, TP)).amount;
    assert.equal(vault, FUND - paid, "reserve accounting must balance exactly");
  });

  it("stops paying once the schedule is exhausted", async () => {
    await sleep(3000);
    try {
      await (program.methods as any).claim()
        .accounts({
          pool: env.poolPda, position: positionPda(carol.publicKey, HOLD),
          rewardMint: env.mint, owner: carol.publicKey,
          ownerAta: env.atas[carol.publicKey.toBase58()],
          rewardVault: env.rewardVault, tokenProgram: TP,
        }).signers([carol]).rpc();
      assert.fail("emissions must stop at the end of the schedule");
    } catch (e: any) {
      assert.ok(e.toString().includes("NothingToClaim"), e.toString());
    }
  });
});

describe("bullbank — many holders share one reserve", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require("../target/idl/staking.json");
  const program = new anchor.Program(idl, provider) as Program;
  const authority = (provider.wallet as anchor.Wallet).payer;

  // Deliberately unequal: a 3:1 holding must produce a 3:1 payout.
  const big = Keypair.generate();
  const small = Keypair.generate();
  const HELD = 3_000n * ONE;
  const FUND = RATE * 3600n;

  let env: Awaited<ReturnType<typeof setup>>;

  const positionPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), env.poolPda.toBuffer(), owner.toBuffer(), Buffer.from([HOLD])],
      program.programId
    )[0];

  before(async () => {
    env = await setup(provider, program, authority, [big, small], HELD);
    await mintTo(provider.connection, authority, env.mint, env.authorityAta, authority, FUND, [], undefined, TP);
    await (program.methods as any)
      .fundRewards(new anchor.BN(FUND.toString()))
      .accounts({
        pool: env.poolPda, rewardMint: env.mint, funder: authority.publicKey,
        funderRewardAta: env.authorityAta, rewardVault: env.rewardVault, tokenProgram: TP,
      }).rpc();

    // Leave `small` holding a third of what `big` holds.
    await transfer(
      provider.connection, small, env.atas[small.publicKey.toBase58()],
      env.atas[big.publicKey.toBase58()], small,
      Number(2_000n * ONE), [], undefined, TP
    );
  });

  it("splits emissions in proportion to what each holder actually holds", async () => {
    const bigAta = env.atas[big.publicKey.toBase58()];
    const smallAta = env.atas[small.publicKey.toBase58()];

    // Both register in one transaction so neither gets a head start.
    const ixs = await Promise.all(
      [big, small].map((kp) =>
        (program.methods as any).sync()
          .accounts({
            pool: env.poolPda, position: positionPda(kp.publicKey),
            owner: kp.publicKey, ownerAta: env.atas[kp.publicKey.toBase58()],
            systemProgram: SystemProgram.programId,
          }).instruction()
      )
    );
    await provider.sendAndConfirm(new Transaction().add(...ixs), [big, small]);

    const bigHeld = (await getAccount(provider.connection, bigAta, undefined, TP)).amount;
    const smallHeld = (await getAccount(provider.connection, smallAta, undefined, TP)).amount;
    const ratio = Number(bigHeld) / Number(smallHeld);

    await sleep(10_000);

    // Claim together too, so both are measured over the same window.
    const b0 = (await getAccount(provider.connection, bigAta, undefined, TP)).amount;
    const s0 = (await getAccount(provider.connection, smallAta, undefined, TP)).amount;
    const claims = await Promise.all(
      [big, small].map((kp) =>
        (program.methods as any).claim()
          .accounts({
            pool: env.poolPda, position: positionPda(kp.publicKey), rewardMint: env.mint,
            owner: kp.publicKey, ownerAta: env.atas[kp.publicKey.toBase58()],
            rewardVault: env.rewardVault, tokenProgram: TP,
          }).instruction()
      )
    );
    await provider.sendAndConfirm(new Transaction().add(...claims), [big, small]);

    const bigGain = (await getAccount(provider.connection, bigAta, undefined, TP)).amount - b0;
    const smallGain = (await getAccount(provider.connection, smallAta, undefined, TP)).amount - s0;
    const paidRatio = Number(bigGain) / Number(smallGain);

    console.log(`    holdings ${ratio.toFixed(2)}:1  ->  payout ${paidRatio.toFixed(2)}:1`);
    assert.ok(bigGain > 0n && smallGain > 0n, "both holders must earn");
    assert.ok(
      Math.abs(paidRatio - ratio) / ratio < 0.05,
      `payout ratio ${paidRatio} should track the holding ratio ${ratio}`
    );
  });

  it("does not distribute more in total than the rate allows", async () => {
    const vault = (await getAccount(provider.connection, env.rewardVault, undefined, TP)).amount;
    const distributed = FUND - vault;
    // The pool has existed for well under a minute of test time.
    assert.ok(
      distributed <= RATE * 120n,
      `distributed ${distributed} exceeds what the rate could have emitted`
    );
  });
});

describe("bullbank — security review fixes", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = require("../target/idl/staking.json");
  const program = new anchor.Program(idl, provider) as Program;
  const authority = (provider.wallet as anchor.Wallet).payer;

  const griefer = Keypair.generate();
  const honest = Keypair.generate();
  const anyone = Keypair.generate();
  const HELD = 1_000n * ONE;
  const FUND = RATE * 3600n;

  let env: Awaited<ReturnType<typeof setup>>;

  const positionPda = (owner: PublicKey, tier = HOLD) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), env.poolPda.toBuffer(), owner.toBuffer(), Buffer.from([tier])],
      program.programId
    )[0];

  before(async () => {
    env = await setup(provider, program, authority, [griefer, honest], HELD);
    const s = await provider.connection.requestAirdrop(anyone.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(s);
    await mintTo(provider.connection, authority, env.mint, env.authorityAta, authority, FUND, [], undefined, TP);
    await (program.methods as any)
      .fundRewards(new anchor.BN(FUND.toString()))
      .accounts({
        pool: env.poolPda, rewardMint: env.mint, funder: authority.publicKey,
        funderRewardAta: env.authorityAta, rewardVault: env.rewardVault, tokenProgram: TP,
      }).rpc();
  });

  it("anyone can correct a stale position, killing the dilution grief", async () => {
    const grieferAta = env.atas[griefer.publicKey.toBase58()];
    const honestAta = env.atas[honest.publicKey.toBase58()];

    // Both register their real holdings.
    for (const kp of [griefer, honest]) {
      await (program.methods as any).sync()
        .accounts({
          pool: env.poolPda, position: positionPda(kp.publicKey), owner: kp.publicKey,
          ownerAta: env.atas[kp.publicKey.toBase58()], systemProgram: SystemProgram.programId,
        }).signers([kp]).rpc();
    }

    // The grief: dump everything and never sync again. Registered weight stays
    // high, permanently shrinking the honest holder's share.
    await transfer(
      provider.connection, griefer, grieferAta, honestAta, griefer,
      Number(HELD), [], undefined, TP
    );

    let pool: any = await (program.account as any).pool.fetch(env.poolPda);
    const inflated = BigInt(pool.totalWeighted.toString());
    let gpos: any = await (program.account as any).position.fetch(positionPda(griefer.publicKey));
    assert.equal(
      gpos.weight.toString(), HELD.toString(),
      "the stale weight should still be registered — that is the grief"
    );

    // A bystander pokes it. They gain nothing and pay the fee themselves.
    await (program.methods as any).poke()
      .accounts({
        pool: env.poolPda,
        position: positionPda(griefer.publicKey),
        ownerAta: grieferAta,
        caller: anyone.publicKey,
      }).signers([anyone]).rpc();

    gpos = await (program.account as any).position.fetch(positionPda(griefer.publicKey));
    pool = await (program.account as any).pool.fetch(env.poolPda);
    const corrected = BigInt(pool.totalWeighted.toString());

    console.log(
      `    total weight ${Number(inflated) / Number(ONE)} -> ${Number(corrected) / Number(ONE)} after poke`
    );
    assert.equal(gpos.weight.toString(), "0", "poked position must fall to its real balance");
    assert.ok(corrected < inflated, "the pool's inflated weight must come down");
  });

  it("poking cannot steal or inflate — it only writes the on-chain truth", async () => {
    const honestAta = env.atas[honest.publicKey.toBase58()];
    const before: any = await (program.account as any).position.fetch(positionPda(honest.publicKey));

    await (program.methods as any).poke()
      .accounts({
        pool: env.poolPda,
        position: positionPda(honest.publicKey),
        ownerAta: honestAta,
        caller: anyone.publicKey,
      }).signers([anyone]).rpc();

    const after: any = await (program.account as any).position.fetch(positionPda(honest.publicKey));
    const realBalance = (await getAccount(provider.connection, honestAta, undefined, TP)).amount;

    assert.equal(after.weight.toString(), realBalance.toString(), "weight must equal the real balance");
    assert.ok(
      BigInt(after.accrued.toString()) >= BigInt(before.accrued.toString()),
      "poking must never reduce what someone has already earned"
    );
    assert.equal(after.owner.toString(), honest.publicKey.toString(), "ownership is untouched");
  });

  it("rejects a poke that points at the wrong token account", async () => {
    try {
      await (program.methods as any).poke()
        .accounts({
          pool: env.poolPda,
          position: positionPda(honest.publicKey),
          // griefer's account, not honest's
          ownerAta: env.atas[griefer.publicKey.toBase58()],
          caller: anyone.publicKey,
        }).signers([anyone]).rpc();
      assert.fail("must not accept a token account belonging to someone else");
    } catch (e: any) {
      assert.ok(e.toString().includes("WrongOwner"), e.toString());
    }
  });

});
