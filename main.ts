// main.ts
// Webhook server for Sim API subscriptions with KV storage
// - POST /activities       (activity payloads from Sim)
// - POST /transactions     (transaction payloads from Sim)
// - POST /balances         (balance change payloads from Sim)
// - GET  /health           (health check)
// Run: deno task start

/// <reference lib="deno.unstable" />

// Will be used in later steps for Sim API calls and Telegram
const _SIM_API_KEY = Deno.env.get("SIM_API_KEY") || "sim_3HEp7EPlougJMPs9GhCOXVjqwyfwIhO0";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "dev-secret-123";

// --- KV: open once (Deploy auto-provisions; CLI uses local store). ---
const kv = await Deno.openKv();

function nowISO() {
  return new Date().toISOString();
}

// --- KV helpers ---

async function sha256Hex(data: string) {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function headersToObject(h: Headers) {
  const obj: Record<string, string> = {};
  for (const [k, v] of h.entries()) obj[k] = v;
  return obj;
}

/**
 * Store the ORIGINAL raw body (unmodified) plus headers for traceability.
 * Keyed by sim-webhook-id (or similar) when present; otherwise by SHA-256 of the body.
 * Uses an atomic check to avoid overwriting on retries (idempotent insert).
 */
async function kvStoreRaw(kind: string, req: Request, rawBody: string) {
  try {
    const webhookId = req.headers.get("sim-webhook-id") ||
      req.headers.get("x-webhook-id") ||
      req.headers.get("webhook-id");
    const fallback = rawBody ? await sha256Hex(rawBody) : crypto.randomUUID();
    const unique = webhookId || fallback;

    const key = ["sim", "webhooks", kind, unique] as const;
    const value = {
      received_at: nowISO(),
      path: new URL(req.url).pathname,
      headers: headersToObject(req.headers),
      body_text: rawBody, // original payload as-is
    };

    // Insert only if key does not exist (no overwrite on retry).
    await kv.atomic().check({ key, versionstamp: null }).set(key, value).commit();
  } catch (e) {
    console.error("KV storage error:", e);
  }
}

Deno.serve(async (req) => {
  const start = performance.now();
  let rawBody = "";

  try {
    rawBody = await req.text();
  } catch (e) {
    console.error("Error reading body:", e);
  }

  const { pathname, searchParams } = new URL(req.url);

  // Verify webhook secret for all webhook endpoints
  const secret = searchParams.get("secret");
  const isWebhookPath = pathname === "/activities" || pathname === "/transactions" || pathname === "/balances";
  if (isWebhookPath && req.method === "POST" && secret !== WEBHOOK_SECRET) {
    console.warn("Unauthorized webhook attempt:", pathname);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // ---------- /health ----------
  if (pathname === "/health" && req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, status: "healthy", timestamp: nowISO() }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  // ---------- /activities ----------
  if (pathname === "/activities" && req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, message: "POST webhook payloads to this endpoint." }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  if (pathname === "/activities" && req.method === "POST") {
    await kvStoreRaw("activities", req, rawBody);

    // deno-lint-ignore no-explicit-any
    let parsed: any;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : undefined;
    } catch (err) {
      console.error("JSON parse error:", err);
      return new Response("Invalid JSON body", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.activities)) {
      console.warn("Validation failed: expected { activities: [] }");
      return new Response("Body must be an object with an 'activities' array.", {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const counts: Record<string, number> = {};
    for (const a of parsed.activities) {
      const t = a?.type ?? "unknown";
      counts[t] = (counts[t] ?? 0) + 1;
    }

    console.log(`Received ${parsed.activities.length} activities:`, counts);

    return new Response(
      JSON.stringify({
        ok: true,
        received: parsed.activities.length,
        counts,
        received_at: nowISO(),
        duration_ms: Math.round(performance.now() - start),
      }, null, 2),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  // ---------- /transactions ----------
  if (pathname === "/transactions" && req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, message: "POST transaction payloads to this endpoint." }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  if (pathname === "/transactions" && req.method === "POST") {
    await kvStoreRaw("transactions", req, rawBody);

    // deno-lint-ignore no-explicit-any
    let parsed: any;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : undefined;
    } catch (err) {
      console.error("JSON parse error:", err);
      return new Response("Invalid JSON body", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.transactions)) {
      console.warn("Validation failed: expected { transactions: [] }");
      return new Response("Body must be an object with a 'transactions' array.", {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const txs = parsed.transactions;
    const typeCounts: Record<string, number> = {};
    const successCounts: Record<string, number> = { true: 0, false: 0 };
    for (const tx of txs) {
      const ttype = tx?.transaction_type ?? "unknown";
      typeCounts[ttype] = (typeCounts[ttype] ?? 0) + 1;
      const success = Boolean(tx?.success);
      successCounts[String(success)] = (successCounts[String(success)] ?? 0) + 1;
    }

    console.log(`Received ${txs.length} transactions - types:`, typeCounts, "success:", successCounts);

    // TODO: Process whale transactions and send to Telegram (later step)

    return new Response(
      JSON.stringify({
        ok: true,
        received: txs.length,
        type_counts: typeCounts,
        success_counts: successCounts,
        received_at: nowISO(),
        duration_ms: Math.round(performance.now() - start),
      }, null, 2),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  // ---------- /balances ----------
  if (pathname === "/balances" && req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, message: "POST balance change payloads to this endpoint." }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  if (pathname === "/balances" && req.method === "POST") {
    await kvStoreRaw("balances", req, rawBody);

    // deno-lint-ignore no-explicit-any
    let parsed: any;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : undefined;
    } catch (err) {
      console.error("JSON parse error:", err);
      return new Response("Invalid JSON body", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.balance_changes)) {
      console.warn("Validation failed: expected { balance_changes: [] }");
      return new Response("Body must be an object with a 'balance_changes' array.", {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const changes = parsed.balance_changes;
    const directionCounts: Record<string, number> = { in: 0, out: 0 };
    const assetSymbols = new Set<string>();
    
    for (const change of changes) {
      const dir = change?.direction ?? "unknown";
      directionCounts[dir] = (directionCounts[dir] ?? 0) + 1;
      if (change?.asset?.symbol) {
        assetSymbols.add(change.asset.symbol);
      }
    }

    console.log(
      `Received ${changes.length} balance changes - direction:`,
      directionCounts,
      "assets:",
      Array.from(assetSymbols).join(", ")
    );

    // TODO: Process whale balance changes and send to Telegram (later step)

    return new Response(
      JSON.stringify({
        ok: true,
        received: changes.length,
        direction_counts: directionCounts,
        unique_assets: assetSymbols.size,
        received_at: nowISO(),
        duration_ms: Math.round(performance.now() - start),
      }, null, 2),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  // ---------- Fallback ----------
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
});
