var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var ALLOWED_METHODS = /* @__PURE__ */ new Set([
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
  "getHealth"
]);
var ALLOWED_SUBSCRIPTIONS = /* @__PURE__ */ new Set([
  "signatureSubscribe",
  "signatureUnsubscribe",
  "accountSubscribe",
  "accountUnsubscribe",
  "slotSubscribe",
  "slotUnsubscribe"
]);
var MAX_BODY_BYTES = 256 * 1024;
function upstreamHttp(env) {
  return env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : null;
}
__name(upstreamHttp, "upstreamHttp");
function upstreamWs(env) {
  return env.HELIUS_API_KEY ? `wss://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : null;
}
__name(upstreamWs, "upstreamWs");
function deny(reason, status = 403) {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "content-type": "application/json" }
  });
}
__name(deny, "deny");
function originAllowed(request, url) {
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
__name(originAllowed, "originAllowed");
function methodsAllowed(payload) {
  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.length > 100) {
    return { ok: false, bad: "batch size" };
  }
  for (const call of calls) {
    const method = call?.method;
    if (typeof method !== "string") return { ok: false, bad: "missing method" };
    if (!ALLOWED_METHODS.has(method)) return { ok: false, bad: method };
  }
  return { ok: true };
}
__name(methodsAllowed, "methodsAllowed");
async function proxyHttp(request, url, env) {
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
  let payload;
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
    body
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}
__name(proxyHttp, "proxyHttp");
function proxyWebSocket(request, url, env) {
  if (!originAllowed(request, url)) {
    return deny("Cross-origin requests are not accepted");
  }
  const target = upstreamWs(env);
  if (!target) {
    return deny("No subscription endpoint is configured", 503);
  }
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  const upstream = new WebSocket(target);
  const pending = [];
  server.accept();
  server.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : null;
    if (data === null) return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const method = parsed?.method;
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
  upstream.addEventListener("message", (event) => {
    server.send(event.data);
  });
  const closeBoth = /* @__PURE__ */ __name(() => {
    try {
      server.close();
    } catch {
    }
    try {
      upstream.close();
    } catch {
    }
  }, "closeBoth");
  upstream.addEventListener("close", closeBoth);
  upstream.addEventListener("error", closeBoth);
  server.addEventListener("close", closeBoth);
  server.addEventListener("error", closeBoth);
  return new Response(null, { status: 101, webSocket: client });
}
__name(proxyWebSocket, "proxyWebSocket");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/rpc" || url.pathname.startsWith("/rpc/")) {
      if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        return proxyWebSocket(request, url, env);
      }
      return proxyHttp(request, url, env);
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-5wilCs/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-5wilCs/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
