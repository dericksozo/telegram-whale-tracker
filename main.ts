// main.ts
// Webhook server for Sim API subscriptions with KV storage
// - POST /activities       (activity payloads from Sim)
// - POST /transactions     (transaction payloads from Sim)
// - GET  /health           (health check)
// Run: deno task start

/// <reference lib="deno.unstable" />

// Will be used in later steps for Sim API calls and Telegram
const _SIM_API_KEY = Deno.env.get("SIM_API_KEY") || "sim_3HEp7EPlougJMPs9GhCOXVjqwyfwIhO0";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "dev-secret-123";

let REQ_ID = 0;

// --- KV: open once (Deploy auto-provisions; CLI uses local store). ---
const kv = await Deno.openKv();

function nowISO() {
  return new Date().toISOString();
}

function logDivider(id: number, label: string) {
  console.log(`\n========== [${label} #${id} @ ${nowISO()}] ==========\n`);
}

function logRequest(id: number, req: Request, bodyText: string) {
  const url = new URL(req.url);
  logDivider(id, "REQUEST");
  console.log(`[REQ #${id}] ${req.method} ${url.pathname}${url.search}`);
  console.log(`[REQ #${id}] Headers:`);
  for (const [k, v] of req.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`[REQ #${id}] Raw Body (${bodyText.length} chars):`);
  console.log(bodyText || "<empty>");
}

function logJSONParse(id: number, ok: boolean, parsed: unknown, err?: unknown) {
  console.log(`[REQ #${id}] JSON parse ${ok ? "OK" : "FAILED"}`);
  if (ok) {
    try {
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(parsed);
    }
  } else {
    console.log("Error:", err);
  }
}

// deno-lint-ignore no-explicit-any
function logActivitiesSummary(id: number, payload: any) {
  const acts = payload?.activities;
  if (!Array.isArray(acts)) {
    console.log(`[REQ #${id}] No valid 'activities' array found.`);
    return;
  }
  console.log(`[REQ #${id}] activities.length = ${acts.length}`);
  const counts: Record<string, number> = {};
  // deno-lint-ignore no-explicit-any
  acts.forEach((a: any, i: number) => {
    const t = a?.type ?? "unknown";
    counts[t] = (counts[t] ?? 0) + 1;
    console.log(
      `[REQ #${id}] Activity[${i}] type=${t} chain_id=${a?.chain_id} block=${a?.block_number} tx=${a?.tx_hash}`,
    );
  });
  console.log(`[REQ #${id}] Activity type counts:`, counts);
}

// deno-lint-ignore no-explicit-any
function logTransactionsSummary(id: number, payload: any) {
  const txs = payload?.transactions;
  if (!Array.isArray(txs)) {
    console.log(`[REQ #${id}] No valid 'transactions' array found.`);
    return;
  }
  console.log(`[REQ #${id}] transactions.length = ${txs.length}`);

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

    console.log(`[REQ #${id}] Tx[${i}] chain=${tx?.chain}/${tx?.chain_id} index=${tx?.index}`);
    console.log(`[REQ #${id}]   hash=${tx?.hash}`);
    console.log(`[REQ #${id}]   address=${tx?.address} from=${tx?.from} to=${tx?.to}`);
    console.log(`[REQ #${id}]   block=${tx?.block_number} time=${tx?.block_time}`);
    console.log(`[REQ #${id}]   type=${ttype} success=${success} value=${tx?.value}`);
    console.log(
      `[REQ #${id}]   gas_price=${tx?.gas_price} gas_used=${tx?.gas_used} eff_gas_price=${tx?.effective_gas_price}`,
    );
    if (tx?.decoded) {
      console.log(
        `[REQ #${id}]   decoded.name=${tx.decoded?.name} inputs=${
          Array.isArray(tx.decoded?.inputs) ? tx.decoded.inputs.length : 0
        }`,
      );
    }
    console.log(`[REQ #${id}]   logs=${logsLen}`);
    if (logsLen > 0) {
      const firstLog = tx.logs[0];
      console.log(`[REQ #${id}]     logs[0].address=${firstLog?.address}`);
      console.log(
        `[REQ #${id}]     logs[0].topics_count=${Array.isArray(firstLog?.topics) ? firstLog.topics.length : 0}`,
      );
      if (firstLog?.decoded) {
        console.log(
          `[REQ #${id}]     logs[0].decoded.name=${firstLog.decoded?.name} inputs=${
            Array.isArray(firstLog.decoded?.inputs) ? firstLog.decoded.inputs.length : 0
          }`,
        );
      }
    }
  });

  console.log(`[REQ #${id}] Transaction type counts:`, typeCounts);
  console.log(`[REQ #${id}] Success counts:`, successCounts);
  console.log(`[REQ #${id}] Total logs across transactions: ${logsTotal}`);
}

function logResponse(id: number, status: number, bodyText: string, headers: HeadersInit) {
  logDivider(id, "RESPONSE");
  console.log(`[RES #${id}] Status: ${status}`);
  console.log(`[RES #${id}] Headers:`);
  const h = new Headers(headers);
  for (const [k, v] of h.entries()) console.log(`  ${k}: ${v}`);
  console.log(`[RES #${id}] Body (${bodyText.length} chars):`);
  console.log(bodyText || "<empty>");
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
async function kvStoreRaw(kind: string, id: number, req: Request, rawBody: string) {
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
    const res = await kv.atomic().check({ key, versionstamp: null }).set(key, value).commit();
    const vs = res.ok ? res.versionstamp : null;
    console.log(
      `[REQ #${id}] KV ${res.ok ? "PUT OK" : "SKIP (duplicate)"} key=${JSON.stringify(key)} vs=${vs}`,
    );
  } catch (e) {
    console.log(`[REQ #${id}] KV ERROR:`, e);
  }
}

Deno.serve(async (req) => {
  const id = ++REQ_ID;
  const start = performance.now();
  let rawBody = "";

  // Read the body as text for logging (safe even for GET -> empty string)
  try {
    rawBody = await req.text();
  } catch (e) {
    console.log(`[REQ #${id}] Error reading body:`, e);
  }

  // Log EVERY request (any path, any method)
  logRequest(id, req, rawBody);

  const { pathname, searchParams } = new URL(req.url);

  // Verify webhook secret for all webhook endpoints
  const secret = searchParams.get("secret");
  const isWebhookPath = pathname === "/activities" || pathname === "/transactions";
  if (isWebhookPath && req.method === "POST" && secret !== WEBHOOK_SECRET) {
    console.warn(`[REQ #${id}] Unauthorized webhook attempt`);
    const body = JSON.stringify({ error: "Unauthorized" });
    const headers = { "content-type": "application/json; charset=utf-8" };
    logResponse(id, 401, body, headers);
    return new Response(body, { status: 401, headers });
  }

  // ---------- /health ----------
  if (pathname === "/health" && req.method === "GET") {
    const body = JSON.stringify({ ok: true, status: "healthy", timestamp: nowISO() });
    const headers = { "content-type": "application/json; charset=utf-8" };
    logResponse(id, 200, body, headers);
    return new Response(body, { status: 200, headers });
  }

  // ---------- /activities ----------
  if (pathname === "/activities" && req.method === "GET") {
    const body = JSON.stringify({ ok: true, message: "POST webhook payloads to this endpoint." });
    const headers = { "content-type": "application/json; charset=utf-8" };
    logResponse(id, 200, body, headers);
    return new Response(body, { status: 200, headers });
  }

  if (pathname === "/activities" && req.method === "POST") {
    // Store raw payload ASAP (before parsing), keyed by webhook-id or hash
    await kvStoreRaw("activities", id, req, rawBody);

    // deno-lint-ignore no-explicit-any
    let parsed: any;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : undefined;
      logJSONParse(id, true, parsed);
    } catch (err) {
      logJSONParse(id, false, undefined, err);
      const body = "Invalid JSON body";
      const headers = { "content-type": "text/plain; charset=utf-8" };
      logResponse(id, 400, body, headers);
      return new Response(body, { status: 400, headers });
    }

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.activities)) {
      console.log(`[REQ #${id}] Validation FAILED: expected { activities: [] }`);
      const body = "Body must be an object with an 'activities' array.";
      const headers = { "content-type": "text/plain; charset=utf-8" };
      logResponse(id, 422, body, headers);
      return new Response(body, { status: 422, headers });
    }

    logActivitiesSummary(id, parsed);

    const first = parsed.activities[0]
      ? {
        type: parsed.activities[0].type,
        chain_id: parsed.activities[0].chain_id,
        block_number: parsed.activities[0].block_number,
        tx_hash: parsed.activities[0].tx_hash,
      }
      : null;

    const counts: Record<string, number> = {};
    for (const a of parsed.activities) {
      const t = a?.type ?? "unknown";
      counts[t] = (counts[t] ?? 0) + 1;
    }

    const res = {
      ok: true,
      received: parsed.activities.length,
      counts,
      first_activity_preview: first,
      request_id: id,
      received_at: nowISO(),
      duration_ms: Math.round(performance.now() - start),
    };

    const body = JSON.stringify(res, null, 2);
    const headers = { "content-type": "application/json; charset=utf-8" };
    logResponse(id, 200, body, headers);
    return new Response(body, { status: 200, headers });
  }

  // ---------- /transactions ----------
  if (pathname === "/transactions" && req.method === "GET") {
    const body = JSON.stringify({ ok: true, message: "POST transaction payloads to this endpoint." });
    const headers = { "content-type": "application/json; charset=utf-8" };
    logResponse(id, 200, body, headers);
    return new Response(body, { status: 200, headers });
  }

  if (pathname === "/transactions" && req.method === "POST") {
    // Store raw payload ASAP (before parsing), keyed by webhook-id or hash
    await kvStoreRaw("transactions", id, req, rawBody);

    // deno-lint-ignore no-explicit-any
    let parsed: any;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : undefined;
      logJSONParse(id, true, parsed);
    } catch (err) {
      logJSONParse(id, false, undefined, err);
      const body = "Invalid JSON body";
      const headers = { "content-type": "text/plain; charset=utf-8" };
      logResponse(id, 400, body, headers);
      return new Response(body, { status: 400, headers });
    }

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.transactions)) {
      console.log(`[REQ #${id}] Validation FAILED: expected { transactions: [] }`);
      const body = "Body must be an object with a 'transactions' array.";
      const headers = { "content-type": "text/plain; charset=utf-8" };
      logResponse(id, 422, body, headers);
      return new Response(body, { status: 422, headers });
    }

    logTransactionsSummary(id, parsed);

    const txs = parsed.transactions;
    const typeCounts: Record<string, number> = {};
    const successCounts: Record<string, number> = { true: 0, false: 0 };
    for (const tx of txs) {
      const ttype = tx?.transaction_type ?? "unknown";
      typeCounts[ttype] = (typeCounts[ttype] ?? 0) + 1;
      const success = Boolean(tx?.success);
      successCounts[String(success)] = (successCounts[String(success)] ?? 0) + 1;
    }

    const first = txs[0]
      ? {
        hash: txs[0].hash,
        chain: txs[0].chain,
        chain_id: txs[0].chain_id,
        from: txs[0].from,
        to: txs[0].to,
        block_number: txs[0].block_number,
        success: Boolean(txs[0].success),
        decoded_name: txs[0]?.decoded?.name ?? null,
        logs_count: Array.isArray(txs[0]?.logs) ? txs[0].logs.length : 0,
      }
      : null;

    const res = {
      ok: true,
      received: txs.length,
      type_counts: typeCounts,
      success_counts: successCounts,
      first_transaction_preview: first,
      request_id: id,
      received_at: nowISO(),
      duration_ms: Math.round(performance.now() - start),
    };

    // TODO: Process whale transactions and send to Telegram (later step)

    const body = JSON.stringify(res, null, 2);
    const headers = { "content-type": "application/json; charset=utf-8" };
    logResponse(id, 200, body, headers);
    return new Response(body, { status: 200, headers });
  }

  // ---------- Fallback ----------
  const notFoundText = "Not Found";
  const headers = { "content-type": "text/plain; charset=utf-8" };
  logResponse(id, 404, notFoundText, headers);
  return new Response(notFoundText, { status: 404, headers });
});
