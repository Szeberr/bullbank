import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";

import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";
import "./wallet-overrides.css";

import App from "./App";
import { RPC_URL } from "./solana/config";

function Root() {
  /*
   * Wallet Standard means most modern wallets (Backpack, Glow, Coinbase, and
   * Phantom/Solflare themselves) are detected automatically without being listed
   * here. These two are registered explicitly only as a fallback for older
   * versions that do not announce themselves.
   */
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider
      endpoint={RPC_URL}
      config={{ commitment: "confirmed" }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
