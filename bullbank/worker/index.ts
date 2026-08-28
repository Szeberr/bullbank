/**
 * RPC proxy.
 *
 * The site needs a Solana RPC endpoint, and a good one needs an API key. Every
 * `VITE_` value is compiled into the JavaScript bundle, so a key put there is a
 * key published — readable in devtools by anyone, scraped within days, and the
 * quota spent by strangers. Domain restrictions would help, but the provider's
 * free plan does not offer them.
 *
 * So the key never reaches the browser at all. The site calls its own origin at
 * `/rpc`, and this Worker adds the key server-side from Cloudflare's secret
 * store. That store is a real one: not in the bundle, not in the repo, not
 * visible to visitors.
 *
 * Everything else on the domain is served straight from the static build.
 *
 * Two things this deliberately is not:
 *
 * - An open relay. Anything reachable at a public URL that forwards to a paid
 *   API will be found and used by someone else. Requests are restricted to the
 *   JSON-RPC methods this app actually calls, so it cannot be repurposed as
 *   free general-purpose infrastructure.
 *
 * - HTTP only. `confirmTransaction` subscribes over a WebSocket, and web3.js
 *   derives that URL from the HTTP one — so proxying only HTTP would leave
 *   every send hanging until the blockhash expired. The upgrade is proxied too.
 */

interface Env {
  /** Cloudflare secret. Absent in local dev and before it is configured. */
  HELIUS_API_KEY?: string;
  /** Static assets binding, declared in wrangler.jsonc. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/**
 * Methods the frontend actually uses, plus what Anchor and wallet-adapter call
 * underneath it. Anything absent is rejected — including the expensive sweeps
 * (`getProgramAccounts`) that make an open proxy worth stealing.
 */
const ALLOWED_METHODS = new Set([
  // Reads the app makes directly
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getBlockTime",
  "getSlot",
  "getBlockHeight",
  // Sending, and confirming what was sent
  "getLatestBlockhash",
  "sendTransaction",
  "simulateTransaction",
  "getSignatureStatuses",
  "getFeeForMessage",
  "getMinimumBalanceForRentExemption",
  "getRecentPrioritizationFees",
  // Handshake noise from web3.js and wallets
  "getEpochInfo",
  "getGenesisHash",
  "getVersion",
  "getHealth",
]);

/** Subscriptions the confirmation path needs, for the WebSocket side. */
const ALLOWED_SUBSCRIPTIONS = new Set([
  "signatureSubscribe",
  "signatureUnsubscribe",
  "accountSubscribe",
  "accountUnsubscribe",
  "slotSubscribe",
  "slotUnsubscribe",
]);

/** Enough for a large signed transaction, far short of anything abusive. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * There is deliberately no public-endpoint fallback.
 *
 * `api.mainnet-beta.solana.com` refuses datacenter traffic — verified from this
 * proxy, which got "Your IP or provider is blocked" — and Workers egress from
 * datacenters. A fallback would therefore fail anyway, but fail as an opaque
 * upstream 403 that looks like a bug in this code. Saying plainly that the key
 * is missing costs one deploy step and saves an afternoon.
 */
function upstreamHttp(env: Env): string | null {
  return env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
    : null;
}

function upstreamWs(env: Env): string | null {
  return env.HELIUS_API_KEY
    ? `wss://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
    : null;
}

function deny(reason: string, status = 403): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Reject requests a browser made on behalf of another site.
 *
 * Browsers always attach `Origin` to a cross-origin POST, so this stops other
 * websites embedding this endpoint. A missing `Origin` is allowed rather than
 * blocked: non-browser clients omit it, and some wallet in-app browsers are
 * inconsistent about it — breaking real users to inconvenience a scripted one
 * is the wrong trade when the method whitelist already caps what is on offer.
 */
function originAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  if (origin === url.origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Every method in a single or batched JSON-RPC payload must be allowed. */
function methodsAllowed(payload: unknown): { ok: true } | { ok: false; bad: string } {
  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.length > 100) {
    return { ok: false, bad: "batch size" };
  }
  for (const call of calls) {
    const method = (call as { method?: unknown })?.method;
    if (typeof method !== "string") return { ok: false, bad: "missing method" };
    if (!ALLOWED_METHODS.has(method)) return { ok: false, bad: method };
  }
  return { ok: true };
}

async function proxyHttp(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return deny("JSON-RPC requests must be POST", 405);
  }
  if (!originAllowed(request, url)) {
    return deny("Cross-origin requests are not accepted");
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return deny("Request body too large", 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return deny("Body is not valid JSON", 400);
  }

  const check = methodsAllowed(payload);
  if (!check.ok) {
    return deny(`Method not permitted through this proxy: ${check.bad}`);
  }

  const target = upstreamHttp(env);
  if (!target) {
    return deny(
      "RPC is not configured: the HELIUS_API_KEY secret is not set on this Worker",
      503
    );
  }

  const upstream = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  // Pass the RPC response through untouched, but do not let upstream headers
  // (or any CORS grant) leak into a response served from this origin.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

/**
 * Proxy the subscription socket.
 *
 * Both sides are relayed by hand rather than passing the upgrade straight
 * through, so client-to-upstream frames can be checked the same way HTTP calls
 * are. Without that, the WebSocket would be an unrestricted hole beside a
 * carefully restricted door.
 */
function proxyWebSocket(request: Request, url: URL, env: Env): Response {
  if (!originAllowed(request, url)) {
    return deny("Cross-origin requests are not accepted");
  }

  const target = upstreamWs(env);
  if (!target) {
    // No key configured: say so plainly instead of holding a socket open that
    // will never deliver anything.
    return deny("No subscription endpoint is configured", 503);
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

  const upstream = new WebSocket(target);
  const pending: string[] = [];

  server.accept();

  server.addEventListener("message", (event: MessageEvent) => {
    const data = typeof event.data === "string" ? event.data : null;
    if (data === null) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const method = (parsed as { method?: unknown })?.method;
    if (typeof method !== "string" || !ALLOWED_SUBSCRIPTIONS.has(method)) {
      return;
    }

    if (upstream.readyState === WebSocket.READY_STATE_OPEN) {
      upstream.send(data);
    } else {
      pending.push(data);
    }
  });

  upstream.addEventListener("open", () => {
    for (const message of pending.splice(0)) upstream.send(message);
  });
  upstream.addEventListener("message", (event: MessageEvent) => {
    server.send(event.data as string);
  });

  const closeBoth = () => {
    try {
      server.close();
    } catch {
      /* already closed */
    }
    try {
      upstream.close();
    } catch {
      /* already closed */
    }
  };
  upstream.addEventListener("close", closeBoth);
  upstream.addEventListener("error", closeBoth);
  server.addEventListener("close", closeBoth);
  server.addEventListener("error", closeBoth);

  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/rpc" || url.pathname.startsWith("/rpc/")) {
      if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        return proxyWebSocket(request, url, env);
      }
      return proxyHttp(request, url, env);
    }

    return env.ASSETS.fetch(request);
  },
};
