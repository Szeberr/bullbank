import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ADDRESSES, isConfigured, LAUNCHED, TIERS } from "../solana/config";
import {
  buildProgram,
  decodePool,
  decodePosition,
  positionPda,
} from "../solana/program";
import type { PoolState, PositionState } from "../solana/accrual";

export interface AccountPosition extends PositionState {
  pda: PublicKey;
}

export interface ChainState {
  pool: (PoolState & { rewardVault: PublicKey; stakeVault: PublicKey }) | null;
  positions: AccountPosition[];
  walletBalance: bigint | null;
  reserveBalance: bigint | null;
  tokenProgram: PublicKey;
  /** chainTime - localTime, in seconds. */
  clockOffset: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
}

const POLL_MS = 30_000;

/**
 * Single source of truth for on-chain state.
 *
 * Design notes:
 * - Positions are fetched with one `fetchMultiple`, not four round trips.
 * - The chain clock is sampled and stored as an offset. Accrual is a function of
 *   time, so projecting with an unsynced local clock would show a claimable
 *   figure the program disagrees with — a user whose PC runs a minute fast would
 *   see money that is not there yet and get a failed transaction when they try
 *   to take it.
 * - The token program is detected from the mint owner instead of assumed. The
 *   old site hardcoded Token-2022; if the real mint is classic SPL, every
 *   instruction fails.
 */
export function useChainState(): ChainState {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [pool, setPool] = useState<ChainState["pool"]>(null);
  const [positions, setPositions] = useState<AccountPosition[]>([]);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [reserveBalance, setReserveBalance] = useState<bigint | null>(null);
  const [tokenProgram, setTokenProgram] = useState<PublicKey>(TOKEN_PROGRAM_ID);
  const [clockOffset, setClockOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Guards against overlapping polls and against setting state after unmount.
  const inFlight = useRef(false);
  // Set when a refresh is requested while one is already running. Dropping that
  // request is what made the dashboard show zeros after a reload: the first
  // fetch starts before the wallet has auto-reconnected, so it reads no
  // publicKey and writes empty positions; the refetch triggered a moment later
  // by the wallet connecting was then silently discarded, leaving the stale
  // zeros on screen until the next 30s poll.
  const queued = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Keyed on the public key rather than the whole wallet object. `refresh`
  // depends on this, and the mount effect depends on `refresh` — so if the
  // wallet object's identity ever changed per render, this would rebuild the
  // program and re-fetch on every render. The public key is the only part that
  // affects what gets read.
  const program = useMemo(
    () => buildProgram(connection, wallet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connection, wallet.publicKey]
  );

  const detectTokenProgram = useCallback(async (): Promise<PublicKey> => {
    if (!ADDRESSES.tokenMint) return TOKEN_PROGRAM_ID;
    try {
      const info = await connection.getAccountInfo(ADDRESSES.tokenMint);
      if (info?.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
    } catch {
      /* fall through to the classic program */
    }
    return TOKEN_PROGRAM_ID;
  }, [connection]);

  const refresh = useCallback(async () => {
    if (!isConfigured() || !program || !ADDRESSES.poolPda || !ADDRESSES.programId) {
      setLoading(false);
      return;
    }
    // Queue rather than drop. The caller wanted fresh data and the run already
    // in flight may have started under different conditions (no wallet yet).
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    setRefreshing(true);

    try {
      const tp = await detectTokenProgram();
      if (alive.current) setTokenProgram(tp);

      // Chain clock. Failure here is non-fatal — we fall back to the local clock
      // and simply keep the previous offset.
      try {
        const slot = await connection.getSlot("confirmed");
        const blockTime = await connection.getBlockTime(slot);
        if (blockTime && alive.current) {
          setClockOffset(blockTime - Math.floor(Date.now() / 1000));
        }
      } catch {
        /* keep previous offset */
      }

      const accounts = program.account as unknown as Record<
        string,
        {
          fetchNullable: (a: PublicKey) => Promise<unknown>;
          fetchMultiple: (a: PublicKey[]) => Promise<unknown[]>;
        }
      >;

      const rawPool = await accounts.pool.fetchNullable(ADDRESSES.poolPda);
      if (!rawPool) {
        if (alive.current) {
          // Before launch there is legitimately no pool, and a red error banner
          // would make a working pre-launch site look broken. After launch a
          // missing pool is a genuine misconfiguration and must be loud.
          setError(
            LAUNCHED
              ? "Reserve account not found on this cluster. Check VITE_POOL_PDA and VITE_CLUSTER."
              : null
          );
          setPool(null);
          setPositions([]);
        }
        return;
      }

      const decodedPool = decodePool(rawPool as never);
      if (alive.current) {
        setPool(decodedPool);
        setError(null);
      }

      // Reserve (emissions vault) balance — drives the runway readout.
      try {
        const bal = await connection.getTokenAccountBalance(decodedPool.rewardVault);
        if (alive.current) setReserveBalance(BigInt(bal.value.amount));
      } catch {
        if (alive.current) setReserveBalance(null);
      }

      if (wallet.publicKey) {
        const pdas = TIERS.map((t) =>
          positionPda(
            ADDRESSES.poolPda!,
            wallet.publicKey!,
            t.tier,
            ADDRESSES.programId!
          )
        );

        // One RPC call for all four tiers rather than four.
        const raw = await accounts.position.fetchMultiple(pdas);
        const found: AccountPosition[] = [];
        raw.forEach((r, i) => {
          if (!r) return;
          const decoded = decodePosition(r as never);
          // A closed position lingers as a zeroed account; do not show it.
          if (decoded.balance === 0n && decoded.accrued === 0n) return;
          found.push({ ...decoded, pda: pdas[i] });
        });
        if (alive.current) setPositions(found);

        try {
          const ata = getAssociatedTokenAddressSync(
            ADDRESSES.tokenMint!,
            wallet.publicKey,
            false,
            tp
          );
          const bal = await connection.getTokenAccountBalance(ata);
          if (alive.current) setWalletBalance(BigInt(bal.value.amount));
        } catch {
          // No token account yet is a normal state, not an error — it means a
          // zero balance and it gets created on first deposit.
          if (alive.current) setWalletBalance(0n);
        }
      } else {
        if (alive.current) {
          setPositions([]);
          setWalletBalance(null);
        }
      }

      if (alive.current) setLastUpdated(Date.now());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (alive.current) setError(msg);
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setRefreshing(false);
        setLoading(false);
      }
      // Serve whoever was turned away while this was running. Reads the ref
      // through a getter so it always calls the current closure, and clears the
      // flag first so a long chain of queued requests collapses to one re-run.
      if (queued.current && alive.current) {
        queued.current = false;
        void refreshRef.current?.();
      }
    }
  }, [connection, program, wallet.publicKey, detectTokenProgram]);

  // The queued re-run above needs the latest `refresh` without making `refresh`
  // depend on itself.
  const refreshRef = useRef<typeof refresh | null>(null);
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll, but only while the tab is visible. A background tab does not need
  // fresh chain state and the local projection keeps the display honest anyway.
  useEffect(() => {
    let id: number | undefined;

    const start = () => {
      if (id === undefined) id = window.setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (id !== undefined) {
        window.clearInterval(id);
        id = undefined;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return {
    pool,
    positions,
    walletBalance,
    reserveBalance,
    tokenProgram,
    clockOffset,
    loading,
    refreshing,
    error,
    lastUpdated,
    refresh,
  };
}
