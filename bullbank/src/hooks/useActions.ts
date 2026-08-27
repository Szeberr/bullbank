import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { BN, buildProgram, positionPda } from "../solana/program";
import { ADDRESSES } from "../solana/config";

export type ActionKind = "sync" | "deposit" | "settle" | "withdraw";

export interface TxState {
  kind: ActionKind | null;
  stage: "idle" | "building" | "signing" | "confirming" | "success" | "error";
  signature: string | null;
  message: string | null;
}

const IDLE: TxState = { kind: null, stage: "idle", signature: null, message: null };

/**
 * Translate a raw transaction failure into something a person can act on.
 *
 * Anchor surfaces custom errors inconsistently depending on whether the failure
 * happened in simulation or on chain, so both the structured error code and the
 * raw log text are checked.
 */
function humanize(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const blob = raw + " " + JSON.stringify((e as { logs?: string[] })?.logs ?? []);

  if (/User rejected|rejected the request|4001/i.test(blob))
    return "Transaction cancelled in your wallet.";
  if (/StillLocked/.test(blob))
    return "This account is still within its term. Principal unlocks when the term ends.";
  if (/UseSyncForHolding/.test(blob))
    return "Holding does not lock tokens — use Sync instead.";
  if (/NothingLocked/.test(blob))
    return "This position has no locked tokens to withdraw.";
  if (/WrongOwner|WrongMint/.test(blob))
    return "That token account does not belong to your wallet.";
  if (/NothingToClaim/.test(blob))
    return "Nothing has accrued yet — there is nothing to settle.";
  if (/InsufficientStake/.test(blob))
    return "Amount exceeds the balance held in this account.";
  if (/ZeroAmount/.test(blob)) return "Enter an amount greater than zero.";
  if (/BadTier/.test(blob)) return "Invalid account tier.";
  if (/FundTooSmall/.test(blob))
    return "Deposit too small to register against the emission rate.";
  if (/insufficient funds|InsufficientFunds|0x1\b/.test(blob))
    return "Insufficient balance for this transaction.";
  if (/Blockhash not found|block height exceeded/i.test(blob))
    return "The network dropped the transaction before it landed. Nothing was charged — please try again.";
  if (/Attempt to debit an account but found no record/i.test(blob))
    return "This wallet has no SOL to pay network fees.";
  if (/simulation failed/i.test(blob) && /custom program error/i.test(blob))
    return "The program rejected this transaction. Your funds were not moved.";
  return raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
}

export function useActions(onDone?: () => void) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [tx, setTx] = useState<TxState>(IDLE);

  const reset = useCallback(() => setTx(IDLE), []);

  /**
   * Send and confirm, using the blockhash + lastValidBlockHeight strategy.
   *
   * The older `confirmTransaction(signature)` form can hang indefinitely on a
   * transaction that was never accepted. Tying confirmation to the block height
   * the blockhash expires at means a dropped transaction fails in bounded time
   * with a message that says so, instead of a spinner that never resolves.
   */
  const sendAndConfirm = useCallback(
    async (instructions: TransactionInstruction[], kind: ActionKind) => {
      if (!wallet.publicKey || !wallet.sendTransaction) {
        throw new Error("Connect a wallet first.");
      }

      setTx({ kind, stage: "building", signature: null, message: null });

      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction();
      transaction.add(...instructions);
      transaction.feePayer = wallet.publicKey;
      transaction.recentBlockhash = latest.blockhash;

      setTx({ kind, stage: "signing", signature: null, message: null });
      const signature = await wallet.sendTransaction(transaction, connection);

      setTx({ kind, stage: "confirming", signature, message: null });
      const result = await connection.confirmTransaction(
        {
          signature,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed"
      );

      if (result.value.err) {
        throw new Error(
          `Transaction failed on chain: ${JSON.stringify(result.value.err)}`
        );
      }

      setTx({ kind, stage: "success", signature, message: null });
      onDone?.();
      return signature;
    },
    [connection, wallet, onDone]
  );

  /** Prepend an ATA creation only when the account genuinely does not exist. */
  const ataInstructionIfNeeded = useCallback(
    async (
      owner: PublicKey,
      tokenProgram: PublicKey
    ): Promise<{ ata: PublicKey; ix: TransactionInstruction | null }> => {
      const ata = getAssociatedTokenAddressSync(
        ADDRESSES.tokenMint!,
        owner,
        false,
        tokenProgram
      );
      const info = await connection.getAccountInfo(ata);
      if (info) return { ata, ix: null };
      return {
        ata,
        ix: createAssociatedTokenAccountInstruction(
          owner,
          ata,
          owner,
          ADDRESSES.tokenMint!,
          tokenProgram
        ),
      };
    },
    [connection]
  );

  const run = useCallback(
    async (kind: ActionKind, build: () => Promise<TransactionInstruction[]>) => {
      try {
        const ixs = await build();
        return await sendAndConfirm(ixs, kind);
      } catch (e) {
        setTx({
          kind,
          stage: "error",
          signature: null,
          message: humanize(e),
        });
        return null;
      }
    },
    [sendAndConfirm]
  );

  const deposit = useCallback(
    async (tier: number, baseUnits: bigint, tokenProgram: PublicKey) =>
      run("deposit", async () => {
        const program = buildProgram(connection, wallet);
        if (!program || !wallet.publicKey) throw new Error("Not connected.");

        const { ata, ix: ataIx } = await ataInstructionIfNeeded(
          wallet.publicKey,
          tokenProgram
        );

        const ix = await program.methods
          .stake(tier, new BN(baseUnits.toString()))
          .accounts({
            pool: ADDRESSES.poolPda!,
            position: positionPda(
              ADDRESSES.poolPda!,
              wallet.publicKey,
              tier,
              ADDRESSES.programId!
            ),
            stakeMint: ADDRESSES.tokenMint!,
            owner: wallet.publicKey,
            ownerAta: ata,
            stakeVault: ADDRESSES.stakeVault!,
            tokenProgram,
            systemProgram: SystemProgram.programId,
          })
          .instruction();

        return ataIx ? [ataIx, ix] : [ix];
      }),
    [run, connection, wallet, ataInstructionIfNeeded]
  );

  /**
   * Register the wallet balance so it earns. Moves no tokens — it only points
   * the program at the holder's own token account, which the program reads and
   * verifies rather than trusting a number from the client.
   */
  const sync = useCallback(
    async (tokenProgram: PublicKey) =>
      run("sync", async () => {
        const program = buildProgram(connection, wallet);
        if (!program || !wallet.publicKey) throw new Error("Not connected.");

        // The ATA must exist before it can be read, so create it if this is a
        // brand-new wallet with no token account yet.
        const { ata, ix: ataIx } = await ataInstructionIfNeeded(
          wallet.publicKey,
          tokenProgram
        );

        const ix = await program.methods
          .sync()
          .accounts({
            pool: ADDRESSES.poolPda!,
            position: positionPda(
              ADDRESSES.poolPda!,
              wallet.publicKey,
              0,
              ADDRESSES.programId!
            ),
            owner: wallet.publicKey,
            ownerAta: ata,
            systemProgram: SystemProgram.programId,
          })
          .instruction();

        return ataIx ? [ataIx, ix] : [ix];
      }),
    [run, connection, wallet, ataInstructionIfNeeded]
  );

  const settle = useCallback(
    async (tier: number, tokenProgram: PublicKey) =>
      run("settle", async () => {
        const program = buildProgram(connection, wallet);
        if (!program || !wallet.publicKey) throw new Error("Not connected.");

        const { ata, ix: ataIx } = await ataInstructionIfNeeded(
          wallet.publicKey,
          tokenProgram
        );

        const ix = await program.methods
          .claim()
          .accounts({
            pool: ADDRESSES.poolPda!,
            position: positionPda(
              ADDRESSES.poolPda!,
              wallet.publicKey,
              tier,
              ADDRESSES.programId!
            ),
            rewardMint: ADDRESSES.tokenMint!,
            owner: wallet.publicKey,
            ownerAta: ata,
            rewardVault: ADDRESSES.rewardVault!,
            tokenProgram,
          })
          .instruction();

        return ataIx ? [ataIx, ix] : [ix];
      }),
    [run, connection, wallet, ataInstructionIfNeeded]
  );

  const withdraw = useCallback(
    async (tier: number, baseUnits: bigint, tokenProgram: PublicKey) =>
      run("withdraw", async () => {
        const program = buildProgram(connection, wallet);
        if (!program || !wallet.publicKey) throw new Error("Not connected.");

        const { ata, ix: ataIx } = await ataInstructionIfNeeded(
          wallet.publicKey,
          tokenProgram
        );

        const ix = await program.methods
          .unstake(new BN(baseUnits.toString()))
          .accounts({
            pool: ADDRESSES.poolPda!,
            position: positionPda(
              ADDRESSES.poolPda!,
              wallet.publicKey,
              tier,
              ADDRESSES.programId!
            ),
            stakeMint: ADDRESSES.tokenMint!,
            owner: wallet.publicKey,
            ownerAta: ata,
            stakeVault: ADDRESSES.stakeVault!,
            tokenProgram,
          })
          .instruction();

        return ataIx ? [ataIx, ix] : [ix];
      }),
    [run, connection, wallet, ataInstructionIfNeeded]
  );

  return { tx, reset, sync, deposit, settle, withdraw };
}
