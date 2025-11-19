// main.ts
// Webhook server for Sim API subscriptions with KV storage
// - POST /activities       (activity payloads from Sim)
// - POST /transactions     (transaction payloads from Sim)
// - POST /balances         (balance change payloads from Sim)
// - GET  /health           (health check)
// Run: deno task start

// USDC on Ethereum contract address: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

/// <reference lib="deno.unstable" />

// Will be used in later steps for Sim API calls and Telegram
const _SIM_API_KEY = Deno.env.get("SIM_API_KEY") || "sim_3HEp7EPlougJMPs9GhCOXVjqwyfwIhO0";

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

// --- Logging helpers ---

// deno-lint-ignore no-explicit-any
function logActivitiesSummary(payload: any) {
  console.log("\n========== RAW ACTIVITIES PAYLOAD ==========");
  console.log(JSON.stringify(payload, null, 2));
  console.log("============================================\n");

  const acts = payload?.activities;
  if (!Array.isArray(acts)) {
    console.log("No valid 'activities' array found.");
    return;
  }

  console.log(`\n========== ACTIVITIES (${acts.length}) @ ${nowISO()} ==========`);

  const counts: Record<string, number> = {};
  // deno-lint-ignore no-explicit-any
  acts.forEach((a: any, i: number) => {
    const t = a?.type ?? "unknown";
    counts[t] = (counts[t] ?? 0) + 1;
    console.log(`\n[Activity ${i}]`);
    console.log(`  Type: ${t}`);
    console.log(`  Chain: ${a?.chain_id}`);
    console.log(`  Block: ${a?.block_number}`);
    console.log(`  Transaction: ${a?.tx_hash}`);
    console.log(`  Address: ${a?.address}`);
    console.log(`  From: ${a?.from}`);
    console.log(`  To: ${a?.to}`);
  });

  console.log(`\nSummary: ${acts.length} activities - type counts:`, counts);
}

// deno-lint-ignore no-explicit-any
function logTransactionsSummary(payload: any) {
  console.log("\n========== RAW TRANSACTIONS PAYLOAD ==========");
  console.log(JSON.stringify(payload, null, 2));
  console.log("==============================================\n");

  const txs = payload?.transactions;
  if (!Array.isArray(txs)) {
    console.log("No valid 'transactions' array found.");
    return;
  }

  console.log(`\n========== TRANSACTIONS (${txs.length}) @ ${nowISO()} ==========`);

  const typeCounts: Record<string, number> = {};
  const successCounts: Record<string, number> = { true: 0, false: 0 };
  let logsTotal = 0;

  // deno-lint-ignore no-explicit-any
  txs.forEach((tx: any, i: number) => {
    const ttype = tx?.transaction_type ?? "unknown";
    typeCounts[ttype] = (typeCounts[ttype] ?? 0) + 1;
    const success = Boolean(tx?.success);
    successCounts[String(success)] = (successCounts[String(success)] ?? 0) + 1;
    const logsLen = Array.isArray(tx?.logs) ? tx.logs.length : 0;
    logsTotal += logsLen;

    console.log(`\n[Transaction ${i}]`);
    console.log(`  Chain: ${tx?.chain} (${tx?.chain_id})`);
    console.log(`  Hash: ${tx?.hash}`);
    console.log(`  Block: ${tx?.block_number} @ ${tx?.block_time}`);
    console.log(`  From: ${tx?.from}`);
    console.log(`  To: ${tx?.to}`);
    console.log(`  Type: ${ttype}`);
    console.log(`  Success: ${success}`);
    console.log(`  Value: ${tx?.value}`);
    console.log(`  Gas Price: ${tx?.gas_price}`);
    console.log(`  Gas Used: ${tx?.gas_used}`);
    if (tx?.decoded) {
      console.log(`  Decoded: ${tx.decoded?.name} (${Array.isArray(tx.decoded?.inputs) ? tx.decoded.inputs.length : 0} inputs)`);
    }
    console.log(`  Logs: ${logsLen}`);
  });

  console.log(`\nSummary: ${txs.length} transactions`);
  console.log(`  Type counts:`, typeCounts);
  console.log(`  Success counts:`, successCounts);
  console.log(`  Total logs: ${logsTotal}`);
}

// deno-lint-ignore no-explicit-any
function logBalancesSummary(payload: any) {
  console.log("\n========== RAW BALANCE PAYLOAD ==========");
  console.log(JSON.stringify(payload, null, 2));
  console.log("=========================================\n");

  const changes = payload?.balance_changes;
  if (!Array.isArray(changes)) {
    console.log("No valid 'balance_changes' array found.");
    return;
  }

  console.log(`\n========== BALANCE CHANGES (${changes.length}) @ ${nowISO()} ==========`);

  const directionCounts: Record<string, number> = { in: 0, out: 0 };
  const assetSymbols = new Set<string>();

  // deno-lint-ignore no-explicit-any
  changes.forEach((change: any, i: number) => {
    const dir = change?.direction ?? "unknown";
    directionCounts[dir] = (directionCounts[dir] ?? 0) + 1;
    if (change?.asset?.symbol) {
      assetSymbols.add(change.asset.symbol);
    }

    console.log(`\n[Balance ${i}]`);
    console.log(`  Address: ${change?.address}`);
    console.log(`  Chain: ${change?.chain} (${change?.chain_id})`);
    console.log(`  Direction: ${change?.direction}`);
    console.log(`  Amount: ${change?.amount} (raw: ${change?.amount_raw})`);
    console.log(`  Asset: ${change?.asset?.symbol} (${change?.asset?.name})`);
    console.log(`  Contract: ${change?.asset?.contract_address}`);
    console.log(`  Decimals: ${change?.asset?.decimals}`);
    console.log(`  Block: ${change?.block_number} @ ${change?.block_time}`);
    console.log(`  Transaction: ${change?.tx_hash}`);
  });

  console.log(`\nSummary: ${changes.length} balance changes`);
  console.log(`  Direction counts:`, directionCounts);
  console.log(`  Assets:`, Array.from(assetSymbols).join(", "));
}

Deno.serve(async (req) => {
  const start = performance.now();
  let rawBody = "";

  try {
    rawBody = await req.text();
  } catch (e) {
    console.error("Error reading body:", e);
  }

  const { pathname } = new URL(req.url);

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

    logActivitiesSummary(parsed);

    const counts: Record<string, number> = {};
    for (const a of parsed.activities) {
      const t = a?.type ?? "unknown";
      counts[t] = (counts[t] ?? 0) + 1;
    }

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

    logTransactionsSummary(parsed);

    const txs = parsed.transactions;
    const typeCounts: Record<string, number> = {};
    const successCounts: Record<string, number> = { true: 0, false: 0 };
    for (const tx of txs) {
      const ttype = tx?.transaction_type ?? "unknown";
      typeCounts[ttype] = (typeCounts[ttype] ?? 0) + 1;
      const success = Boolean(tx?.success);
      successCounts[String(success)] = (successCounts[String(success)] ?? 0) + 1;
    }

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

    logBalancesSummary(parsed);

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
