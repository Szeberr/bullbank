import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Buffer/process/global for @solana/web3.js, spl-token and Anchor. Doing this
    // by hand fails: Vite pre-bundles dependencies into a chunk that is evaluated
    // before any application module, so spl-token touches Buffer at eval time and
    // throws before a hand-rolled polyfill can run.
    nodePolyfills({ include: ["buffer"], globals: { Buffer: true, global: true, process: true } }),
  ],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  define: {
    // @solana/web3.js and Anchor still reach for Node globals in a couple of
    // paths. Without these the bundle builds fine and then dies at runtime with
    // "global is not defined" the first time a transaction is constructed.
    global: "globalThis",
    "process.env": {},
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        // Split the Solana stack out of the app chunk. It is large and changes
        // far less often than the UI, so it caches independently. Written as a
        // function because Rollup's typings only accept the record form on a
        // narrower overload.
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("wallet-adapter")) return "wallet";
            if (
              id.includes("@solana/") ||
              id.includes("@coral-xyz/") ||
              id.includes("borsh") ||
              id.includes("bn.js")
            ) {
              return "solana";
            }
          }
        },
      },
    },
  },
});
