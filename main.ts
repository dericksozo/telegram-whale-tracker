// main.ts
// Telegram Whale Tracker - Complete whale tracking system
// Powered by Sim APIs (https://sim.dune.com)

/// <reference lib="deno.unstable" />

// ============== CONFIGURATION ==============

const SIM_API_KEY = Deno.env.get("SIM_API_KEY") || "sim_3HEp7EPlougJMPs9GhCOXVjqwyfwIhO0";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "8463582584:AAEca8NPbe9cF5cHDgd5stDj_64KcbEXfK4";
const _TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "";
const DEFAULT_CHAIN_ID = parseInt(Deno.env.get("DEFAULT_CHAIN_ID") || "1");

// Webhook configuration
const WEBHOOK_BASE_URL = Deno.env.get("WEBHOOK_BASE_URL") || "https://sim-whale-tracker.deno.dev";

// How many top holders to fetch per token (default: 3 for whale tracking)
const TOP_HOLDERS_LIMIT = parseInt(Deno.env.get("TOP_HOLDERS_LIMIT") || "3");

// Rate limiting: Sim APIs allows maximum 5 requests per second
// We use 250ms delay (4 req/sec) to be safe and account for request processing time
const RATE_LIMIT_DELAY_MS = 250;

// Open Deno KV once
const kv = await Deno.openKv();

// ============== UTILITY FUNCTIONS ==============

function nowISO() {
  return new Date().toISOString();
}

/**
 * Rate limiter for Sim APIs
 * Sim APIs has a limit of 5 requests per second
 * We use 250ms delay (4 req/sec) to stay safely under the limit
 */
async function rateLimitedDelay() {
  await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
}

function formatNumber(value) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(num);
}

function getExplorerLink(txHash, chainId) {
  const explorers = {
    1: "https://etherscan.io/tx/",
    10: "https://optimistic.etherscan.io/tx/",
    56: "https://bscscan.com/tx/",
    137: "https://polygonscan.com/tx/",
    8453: "https://basescan.org/tx/",
    42161: "https://arbiscan.io/tx/",
    43114: "https://snowtrace.io/tx/",
  };
  const baseUrl = explorers[chainId] || "https://etherscan.io/tx/";
  return `${baseUrl}${txHash}`;
}

function getAddressExplorerLink(address, chainId) {
  const explorers = {
    1: "https://etherscan.io/address/",
    10: "https://optimistic.etherscan.io/address/",
    56: "https://bscscan.com/address/",
    137: "https://polygonscan.com/address/",
    8453: "https://basescan.org/address/",
    42161: "https://arbiscan.io/address/",
    43114: "https://snowtrace.io/address/",
  };
  const baseUrl = explorers[chainId] || "https://etherscan.io/address/";
  return `${baseUrl}${address}`;
}

// ============== KV HELPERS ==============

async function sha256Hex(data) {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function headersToObject(h) {
  const obj = {};
  for (const [k, v] of h.entries()) obj[k] = v;
  return obj;
}

async function kvStoreRaw(kind, req, rawBody) {
  try {
    const webhookId = req.headers.get("sim-webhook-id") ||
      req.headers.get("x-webhook-id") ||
      req.headers.get("webhook-id");
    const fallback = rawBody ? await sha256Hex(rawBody) : crypto.randomUUID();
    const unique = webhookId || fallback;

    const key = ["sim", "webhooks", kind, unique];
    const value = {
      received_at: nowISO(),
      path: new URL(req.url).pathname,
      headers: headersToObject(req.headers),
      body_text: rawBody,
    };

    await kv.atomic().check({ key, versionstamp: null }).set(key, value).commit();
  } catch (e) {
    console.error("KV storage error:", e);
  }
}

// ============== LOGGING HELPERS ==============

function logActivitiesSummary(payload) {
  console.log("\n========== RAW ACTIVITIES PAYLOAD ==========");
  console.log(JSON.stringify(payload, null, 2));
  console.log("============================================\n");

  const acts = payload?.activities;
  if (!Array.isArray(acts)) {
    console.log("No valid 'activities' array found.");
    return;
  }

  console.log(`\n========== ACTIVITIES (${acts.length}) @ ${nowISO()} ==========`);

  const counts = {};
  acts.forEach((a, i) => {
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

// ============== SIM API HELPERS ==============

async function fetchTokenHolders(tokenAddress, chainId) {
  // Correct URL format: /token-holders/{chain_id}/{token_address}?api_key=xxx
  const url = `https://api.sim.dune.com/v1/evm/token-holders/${chainId}/${tokenAddress}?api_key=${SIM_API_KEY}&limit=${TOP_HOLDERS_LIMIT}`;
  console.log(`🔍 Fetching token holders: ${url.replace(SIM_API_KEY, 'xxx...')}`); // Hide API key in logs
  
  try {
    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Failed to fetch token holders for ${tokenAddress}: ${response.status}`);
      console.warn(`  Response: ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log(`✅ Fetched ${data?.holders?.length || 0} holders for ${tokenAddress}`);
    return data;
  } catch (error) {
    console.error(`❌ Error fetching token holders for ${tokenAddress}:`, error);
    return null;
  }
}

async function fetchTokenInfo(tokenAddress, chainId) {
  const url = `https://api.sim.dune.com/v1/evm/token-info/${tokenAddress}?chain_ids=${chainId}`;
  console.log(`🌐 Fetching token info: ${url}`);
  
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Sim-Api-Key": SIM_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Failed to fetch token info for ${tokenAddress}: ${response.status}`);
      console.warn(`  Response: ${errorText}`);
      return null;
    }

    const data = await response.json();
    if (data?.tokens && Array.isArray(data.tokens) && data.tokens.length > 0) {
      const tokenInfo = data.tokens[0];
      if (tokenInfo?.symbol && tokenInfo?.name) {
        console.log(`✅ Fetched token info: ${tokenInfo.symbol} (${tokenInfo.name})`);
        return tokenInfo;
      }
    }
    
    console.warn(`⚠️ Token info API returned no valid tokens`);
    return null;
  } catch (error) {
    console.error(`❌ Error fetching token info for ${tokenAddress}:`, error);
    return null;
  }
}

async function createWebhook(
  name: string,
  addresses: string[],
  chainIds: number[],
  tokenAddress: string | null = null
) {
  const url = "https://api.sim.dune.com/beta/evm/subscriptions/webhooks";
  
  const payload: Record<string, unknown> = {
    name: name,
    url: `${WEBHOOK_BASE_URL}/activities`,
    type: "activities",
    addresses: addresses,
    chain_ids: chainIds
  };

  // Add token_address filter if provided (for per-token whale tracking)
  if (tokenAddress) {
    payload.token_address = tokenAddress;
  }

  const chainDisplay = chainIds.length === 1 ? `chain ${chainIds[0]}` : `${chainIds.length} chains`;
  const tokenDisplay = tokenAddress ? ` for token ${tokenAddress.slice(0, 10)}...` : '';
  console.log(`📤 Creating webhook with ${addresses.length} addresses on ${chainDisplay}${tokenDisplay}`);
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Sim-Api-Key": SIM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to create webhook: ${response.status}`);
      console.error(`  Response: ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log(`✅ Webhook created: ${data.id}`);
    return data;
  } catch (error) {
    console.error(`❌ Error creating webhook:`, error);
    return null;
  }
}

// ============== TELEGRAM HELPERS ==============

async function addSubscriber(chatId) {
  const key = ["telegram", "subscribers", chatId];
  await kv.set(key, { chat_id: chatId, subscribed_at: nowISO() });
  console.log(`➕ Added subscriber: ${chatId}`);
}

async function getAllSubscribers() {
  const entries = kv.list({ prefix: ["telegram", "subscribers"] });
  const chatIds = [];
  for await (const entry of entries) {
    chatIds.push(entry.value.chat_id);
  }
  return chatIds;
}

function sanitizeForTelegram(text) {
  if (typeof text !== 'string') {
    text = String(text);
  }
  text = text.replace(/\0/g, '');
  try {
    text = text.normalize('NFC');
  } catch (e) {
    console.warn("Failed to normalize text:", e);
  }
  // deno-lint-ignore no-control-regex
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  return text;
}

async function sendTelegramMessage(text, chatId) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    const sanitizedText = sanitizeForTelegram(text);
    const telegramPayload = {
      chat_id: chatId,
      text: sanitizedText,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };

    console.log("📤 Sending to Telegram:", telegramPayload);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(telegramPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Telegram API error (${response.status}):`, errorText);
      
      if (errorText.includes("parse") || errorText.includes("Markdown")) {
        console.log("⚠️ Retrying without Markdown formatting...");
        const fallbackResponse = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: sanitizedText,
            disable_web_page_preview: true,
          }),
        });

        if (fallbackResponse.ok) {
          console.log(`✅ Telegram message sent (plain text fallback) to ${chatId}`);
          return true;
        }
      }
      return false;
    }

    console.log(`✅ Telegram message sent to ${chatId}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to send Telegram message:", error);
    return false;
  }
}

async function broadcastToSubscribers(text) {
  const subscribers = await getAllSubscribers();
  if (subscribers.length === 0) {
    console.warn("⚠️ No subscribers to send message to");
    return;
  }
  console.log(`📢 Broadcasting to ${subscribers.length} subscriber(s)`);
  for (const chatId of subscribers) {
    await sendTelegramMessage(text, chatId);
  }
}

function formatActivityMessage(activity, tokenSymbol, _tokenName, tokenPrice, tokenDecimals, chainId) {
  const type = activity?.type || "unknown";
  const rawValue = activity?.value || "0";
  const actualAmount = parseFloat(rawValue) / Math.pow(10, tokenDecimals);
  const formattedAmount = formatNumber(actualAmount);
  const symbol = tokenSymbol || "unknown token";
  const txHash = activity?.tx_hash || "unknown";

  let usdString = "";
  if (tokenPrice && tokenPrice > 0) {
    const usdValue = actualAmount * tokenPrice;
    usdString = ` ($${formatNumber(usdValue)})`;
  }

  const detailsLink = getExplorerLink(txHash, chainId);

  let emoji = "🔔";
  switch (type) {
    case "send":
    case "receive": {
      const usdValue = (tokenPrice && tokenPrice > 0) ? actualAmount * tokenPrice : 0;
      let emojiCount = 1;
      if (usdValue >= 500_000_000) emojiCount = 9;
      else if (usdValue >= 100_000_000) emojiCount = 8;
      else if (usdValue >= 50_000_000) emojiCount = 7;
      else if (usdValue >= 10_000_000) emojiCount = 6;
      else if (usdValue >= 5_000_000) emojiCount = 5;
      else if (usdValue >= 1_000_000) emojiCount = 4;
      else if (usdValue >= 500_000) emojiCount = 3;
      else if (usdValue >= 100_000) emojiCount = 2;
      emoji = "🚨 ".repeat(emojiCount).trim();
      break;
    }
    case "burn":
      emoji = "🔥 ".repeat(4).trim();
      break;
    case "mint":
      emoji = "💵 ".repeat(4).trim();
      break;
    case "swap":
      emoji = "🔄 ".repeat(3).trim();
      break;
  }

  let message = "";
  const from = activity?.from || "unknown wallet";
  const to = activity?.to || "unknown wallet";

  const fromLink = from !== "unknown wallet" ? `[${from}](${getAddressExplorerLink(from, chainId)})` : from;
  const toLink = to !== "unknown wallet" ? `[${to}](${getAddressExplorerLink(to, chainId)})` : to;

  if (type === "mint") {
    message = `${emoji} ${formattedAmount} #${symbol}${usdString} minted at ${toLink}`;
  } else if (type === "burn") {
    message = `${emoji} ${formattedAmount} #${symbol}${usdString} burned at ${fromLink}`;
  } else if (type === "send" || type === "receive") {
    message = `${emoji} ${formattedAmount} #${symbol}${usdString} transferred from ${fromLink} to ${toLink}`;
  } else if (type === "swap") {
    message = `${emoji} ${formattedAmount} #${symbol}${usdString} swapped by ${fromLink}`;
  } else {
    message = `${emoji} ${formattedAmount} #${symbol}${usdString} ${type} from ${fromLink} to ${toLink}`;
  }

  message += `\n\n[Tx Link](${detailsLink}) · Powered by [Sim APIs](https://sim.dune.com/)`;
  return message;
}

// ============== SETUP FUNCTIONS ==============

async function fetchAllWhales() {
  console.log("🐋 Starting whale fetching process...");
  
  // Fetch the filtered tokens from GitHub Gist
  console.log("📥 Fetching token list from GitHub Gist...");
  const tokensUrl = "https://gist.githubusercontent.com/dericksozo/3ad9c3caab9c1a6e0603f804affcda24/raw/297ea8b8c1156fe3e499bdd148bff744445636b2/top_erc20_tokens_filtered.json";
  const tokensResponse = await fetch(tokensUrl);
  
  if (!tokensResponse.ok) {
    throw new Error(`Failed to fetch tokens from GitHub Gist: ${tokensResponse.status} ${tokensResponse.statusText}`);
  }
  
  const tokens = await tokensResponse.json();
  console.log(`✅ Fetched ${tokens.length} tokens from GitHub Gist`);
  
  console.log(`⏱️  Rate limit: 5 req/sec max, using 250ms delay between requests`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(tokens.length * 0.25 / 60)} minutes (${tokens.length} requests × 250ms)`);
  
  let totalWhales = 0;
  let processedTokens = 0;
  const results = [];

  for (const token of tokens) {
    const chainId = parseInt(token.chain_id);
    const tokenAddress = token.contract_address;
    const symbol = token.symbol;

    console.log(`\n🔄 Processing ${symbol} on chain ${chainId}...`);

    // Fetch token holders
    const holdersData = await fetchTokenHolders(tokenAddress, chainId);
    
    if (holdersData && holdersData.holders && holdersData.holders.length > 0) {
      const holders = holdersData.holders;
      
      // Store in KV: ["whales", chainId, tokenAddress] -> holders data
      const key = ["whales", chainId.toString(), tokenAddress.toLowerCase()];
      const value = {
        token_address: tokenAddress,
        chain_id: chainId,
        symbol: symbol,
        blockchain: token.blockchain,
        holders: holders,
        fetched_at: nowISO(),
      };
      
      await kv.set(key, value);
      
      totalWhales += holders.length;
      processedTokens++;
      
      results.push({
        token: symbol,
        chain_id: chainId,
        holders_count: holders.length,
        status: "success",
      });
      
      console.log(`✅ Stored ${holders.length} whales for ${symbol}`);
    } else {
      results.push({
        token: symbol,
        chain_id: chainId,
        holders_count: 0,
        status: "failed",
      });
      console.log(`⚠️ Failed to fetch holders for ${symbol}`);
    }

    // Rate limiting: Sim APIs allows max 5 req/sec, we use 250ms (4 req/sec) to be safe
    await rateLimitedDelay();
  }

  console.log(`\n✅ Whale fetching complete!`);
  console.log(`   Processed: ${processedTokens}/${tokens.length} tokens`);
  console.log(`   Total whales: ${totalWhales}`);

  return {
    total_tokens: tokens.length,
    processed_tokens: processedTokens,
    total_whales: totalWhales,
    results: results,
  };
}

async function createWebhooksForWhales() {
  console.log("🪝 Starting per-token webhook creation process...");

  // Count tokens first to show progress
  let tokenCount = 0;
  const tokensToProcess: Array<{
    key: string[];
    value: {
      token_address: string;
      chain_id: number;
      symbol: string;
      blockchain: string;
      holders: Array<{ wallet_address: string; balance?: string }>;
    };
  }> = [];
  
  const entriesForCount = kv.list({ prefix: ["whales"] });
  for await (const entry of entriesForCount) {
    tokenCount++;
    tokensToProcess.push({
      key: entry.key as string[],
      value: entry.value as {
        token_address: string;
        chain_id: number;
        symbol: string;
        blockchain: string;
        holders: Array<{ wallet_address: string; balance?: string }>;
      },
    });
  }

  if (tokenCount === 0) {
    console.error("❌ No whale data found. Run /setup/fetch-whales first.");
    return {
      success: false,
      error: "No whale data found. Run /setup/fetch-whales first.",
    };
  }

  console.log(`📊 Found ${tokenCount} tokens in KV store`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(tokenCount * 0.25 / 60)} minutes (${tokenCount} webhooks × 250ms)`);
  console.log(`\n🚀 Creating individual webhooks for each token...\n`);

  let webhooksCreated = 0;
  let webhooksFailed = 0;
  const webhookIds: string[] = [];
  const results: Array<{
    token: string;
    chain_id: number;
    webhook_id: string | null;
    status: string;
    addresses_count: number;
  }> = [];

  for (const { value: tokenData } of tokensToProcess) {
    const { token_address, chain_id, symbol, blockchain, holders } = tokenData;

    // Get top 3 holder addresses (or fewer if less available)
    const topHolders = holders.slice(0, 3);
    const holderAddresses = topHolders
      .map(h => h.wallet_address)
      .filter(addr => addr && addr.length > 0);

    if (holderAddresses.length === 0) {
      console.log(`⚠️ Skipping ${symbol} on ${blockchain} - no holder addresses found`);
      results.push({
        token: symbol,
        chain_id: chain_id,
        webhook_id: null,
        status: "skipped_no_addresses",
        addresses_count: 0,
      });
      webhooksFailed++;
      continue;
    }

    // Create webhook name
    const webhookName = `Whale Tracker - ${symbol} on ${blockchain}`;

    console.log(`📤 [${webhooksCreated + webhooksFailed + 1}/${tokenCount}] Creating webhook for ${symbol} on ${blockchain}...`);
    console.log(`   Token: ${token_address}`);
    console.log(`   Chain: ${chain_id}`);
    console.log(`   Top holders: ${holderAddresses.length}`);

    // Create webhook with token_address filter
    const webhook = await createWebhook(
      webhookName,
      holderAddresses,
      [chain_id],        // Single chain
      token_address      // Token filter
    );

    if (webhook && webhook.id) {
      // Store webhook ID with full token metadata
      const webhookKey = ["webhooks", "ids", webhook.id];
      await kv.set(webhookKey, {
        id: webhook.id,
        name: webhookName,
        token_address: token_address,
        chain_id: chain_id,
        symbol: symbol,
        blockchain: blockchain,
        holder_addresses: holderAddresses,
        addresses_count: holderAddresses.length,
        created_at: nowISO(),
      });

      // Also store a reverse lookup by token
      const tokenWebhookKey = ["webhooks", "by_token", chain_id.toString(), token_address.toLowerCase()];
      await kv.set(tokenWebhookKey, {
        webhook_id: webhook.id,
        symbol: symbol,
      });

      webhookIds.push(webhook.id);
      webhooksCreated++;
      results.push({
        token: symbol,
        chain_id: chain_id,
        webhook_id: webhook.id,
        status: "success",
        addresses_count: holderAddresses.length,
      });

      console.log(`   ✅ Webhook created: ${webhook.id}\n`);
    } else {
      webhooksFailed++;
      results.push({
        token: symbol,
        chain_id: chain_id,
        webhook_id: null,
        status: "failed",
        addresses_count: holderAddresses.length,
      });
      console.log(`   ❌ Failed to create webhook\n`);
    }

    // Rate limiting: Sim APIs allows max 5 req/sec
    await rateLimitedDelay();
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ Webhook creation complete!`);
  console.log(`   Created: ${webhooksCreated}/${tokenCount} webhooks`);
  console.log(`   Failed: ${webhooksFailed}/${tokenCount}`);
  console.log(`${"=".repeat(60)}\n`);

  return {
    success: webhooksCreated > 0,
    webhooks_created: webhooksCreated,
    webhooks_failed: webhooksFailed,
    total_tokens: tokenCount,
    webhook_ids: webhookIds,
    results: results,
  };
}

async function getSetupStatus() {
  // Count tokens/whales
  let tokenCount = 0;
  let totalWhales = 0;
  const entries = kv.list({ prefix: ["whales"] });
  
  for await (const entry of entries) {
    tokenCount++;
    const data = entry.value;
    if (data.holders && Array.isArray(data.holders)) {
      totalWhales += data.holders.length;
    }
  }

  // Count webhooks
  let webhookCount = 0;
  const webhookEntries = kv.list({ prefix: ["webhooks", "ids"] });
  const webhookIds = [];
  
  for await (const entry of webhookEntries) {
    webhookCount++;
    webhookIds.push(entry.value.id);
  }

  // Count subscribers
  const subscribers = await getAllSubscribers();

  return {
    whales: {
      tokens_processed: tokenCount,
      total_whale_addresses: totalWhales,
    },
    webhooks: {
      count: webhookCount,
      ids: webhookIds,
    },
    telegram: {
      subscribers_count: subscribers.length,
    },
    status: tokenCount > 0 && webhookCount > 0 ? "ready" : "incomplete",
  };
}

async function getAllWhalesAsJson() {
  console.log("📥 Retrieving all whale addresses from KV...");
  
  const uniqueAddresses = new Set();
  const chainIds = new Set();
  let tokenCount = 0;
  
  const entries = kv.list({ prefix: ["whales"] });
  
  for await (const entry of entries) {
    const data = entry.value;
    tokenCount++;
    
    if (data.chain_id) {
      chainIds.add(data.chain_id);
    }
    
    if (data.holders && Array.isArray(data.holders)) {
      data.holders.forEach(holder => {
        // API returns 'wallet_address' field
        if (holder.wallet_address) {
          uniqueAddresses.add(holder.wallet_address.toLowerCase());
        }
      });
    }
  }
  
  const addresses = Array.from(uniqueAddresses);
  
  console.log(`✅ Retrieved ${tokenCount} tokens with ${addresses.length} unique whale addresses across ${chainIds.size} chains`);
  
  return {
    tokens_count: tokenCount,
    unique_whale_addresses: addresses.length,
    chains_count: chainIds.size,
    chains: Array.from(chainIds).sort((a, b) => a - b),
    addresses: addresses.sort(),
  };
}

async function clearSetupData() {
  console.log("🗑️ Clearing setup data...");
  
  let deletedWhales = 0;
  let deletedWebhooks = 0;

  // Delete whales
  const whaleEntries = kv.list({ prefix: ["whales"] });
  for await (const entry of whaleEntries) {
    await kv.delete(entry.key);
    deletedWhales++;
  }

  // Delete webhook IDs
  const webhookEntries = kv.list({ prefix: ["webhooks", "ids"] });
  for await (const entry of webhookEntries) {
    await kv.delete(entry.key);
    deletedWebhooks++;
  }

  console.log(`✅ Deleted ${deletedWhales} whale entries and ${deletedWebhooks} webhook entries`);

  return {
    deleted_whales: deletedWhales,
    deleted_webhooks: deletedWebhooks,
  };
}

// ============== HTTP SERVER ==============

Deno.serve(async (req) => {
  const start = performance.now();
  let rawBody = "";

  try {
    rawBody = await req.text();
  } catch (e) {
    console.error("Error reading body:", e);
  }

  const { pathname } = new URL(req.url);

  // ========== HEALTH CHECK ==========
  if (pathname === "/health" && req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, status: "healthy", timestamp: nowISO() }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }

  // ========== SETUP: FETCH WHALES ==========
  if (pathname === "/setup/fetch-whales" && (req.method === "GET" || req.method === "POST")) {
    console.log("🚀 Starting whale fetch process...");
    try {
      const result = await fetchAllWhales();
      return new Response(
        JSON.stringify({
          ok: true,
          message: "Whale fetching complete",
          ...result,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    } catch (error) {
      console.error("❌ Error fetching whales:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }

  // ========== SETUP: CREATE WEBHOOKS ==========
  if (pathname === "/setup/create-webhooks" && (req.method === "GET" || req.method === "POST")) {
    console.log("🚀 Starting webhook creation...");
    try {
      const result = await createWebhooksForWhales();
      return new Response(
        JSON.stringify({
          ok: result.success,
          message: "Webhook creation complete",
          ...result,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    } catch (error) {
      console.error("❌ Error creating webhooks:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }

  // ========== SETUP: STATUS ==========
  if (pathname === "/setup/status" && req.method === "GET") {
    try {
      const status = await getSetupStatus();
      return new Response(
        JSON.stringify({
          ok: true,
          ...status,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    } catch (error) {
      console.error("❌ Error getting status:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
        }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }

  // ========== SETUP: GET WHALES JSON ==========
  if (pathname === "/setup/get-whales-json" && req.method === "GET") {
    try {
      const whalesData = await getAllWhalesAsJson();
      return new Response(
        JSON.stringify({
          ok: true,
          ...whalesData,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    } catch (error) {
      console.error("❌ Error getting whales:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
        }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }

  // ========== SETUP: TOP HOLDERS ==========
  // Returns top 3 holders for each token in a structured format
  if (pathname === "/setup/top-holders" && req.method === "GET") {
    try {
      console.log("📥 Retrieving top holders for all tokens...");
      
      const tokens: Array<{
        symbol: string;
        blockchain: string;
        chain_id: number;
        token_address: string;
        top_holders: Array<{
          rank: number;
          address: string;
          balance: string;
        }>;
        fetched_at: string;
      }> = [];

      const entries = kv.list({ prefix: ["whales"] });
      for await (const entry of entries) {
        const data = entry.value as {
          token_address: string;
          chain_id: number;
          symbol: string;
          blockchain: string;
          holders: Array<{ wallet_address: string; balance?: string }>;
          fetched_at: string;
        };

        const topHolders = data.holders.slice(0, 3).map((holder, index) => ({
          rank: index + 1,
          address: holder.wallet_address,
          balance: holder.balance || "unknown",
        }));

        tokens.push({
          symbol: data.symbol,
          blockchain: data.blockchain,
          chain_id: data.chain_id,
          token_address: data.token_address,
          top_holders: topHolders,
          fetched_at: data.fetched_at,
        });
      }

      // Sort by blockchain then symbol for readability
      tokens.sort((a, b) => {
        if (a.blockchain !== b.blockchain) {
          return a.blockchain.localeCompare(b.blockchain);
        }
        return a.symbol.localeCompare(b.symbol);
      });

      console.log(`✅ Retrieved top holders for ${tokens.length} tokens`);

      return new Response(
        JSON.stringify({
          ok: true,
          tokens_count: tokens.length,
          total_holders: tokens.reduce((sum, t) => sum + t.top_holders.length, 0),
          tokens: tokens,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    } catch (error) {
      console.error("❌ Error getting top holders:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
        }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }

  // ========== SETUP: VIEW WEBHOOKS ==========
  if (pathname === "/setup/view-webhooks" && req.method === "GET") {
    try {
      const url = "https://api.sim.dune.com/beta/evm/subscriptions/webhooks";
      console.log("🔍 Fetching webhooks from Sim API...");
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Sim-Api-Key": SIM_API_KEY,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch webhooks: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Retrieved ${data?.webhooks?.length || 0} webhook(s)`);

      return new Response(
        JSON.stringify({
          ok: true,
          count: data?.webhooks?.length || 0,
          webhooks: data.webhooks || [],
          next_offset: data.next_offset || null,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    } catch (error) {
      console.error("❌ Error fetching webhooks:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
        }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }

  // ========== SETUP: CLEAR DATA ==========
  if (pathname === "/setup/clear" && (req.method === "GET" || req.method === "POST")) {
    try {
      const result = await clearSetupData();
      return new Response(
        JSON.stringify({
          ok: true,
          message: "Setup data cleared",
          ...result,
          duration_ms: Math.round(performance.now() - start),
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    } catch (error) {
      console.error("❌ Error clearing data:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error.message,
        }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  }

  // ========== TELEGRAM WEBHOOK ==========
  if (pathname === "/telegram/webhook" && req.method === "POST") {
    let parsed;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : undefined;
    } catch (err) {
      console.error("JSON parse error:", err);
      return new Response("Invalid JSON", { status: 400 });
    }

    if (parsed?.message) {
      const chatId = parsed.message.chat.id?.toString();
      const text = parsed.message.text || "";
      const username = parsed.message.from?.username || "unknown";

      console.log(`📨 Telegram message from @${username} (${chatId}): ${text}`);

      if (text.startsWith("/start")) {
        await addSubscriber(chatId);
        await sendTelegramMessage(
          "🐋 *Welcome to Whale Tracker!*\n\n" +
          "You're now subscribed to whale alerts. You'll receive notifications when large holders move tokens.\n\n" +
          "Commands:\n" +
          "/start - Subscribe to alerts\n" +
          "/status - Check subscription status",
          chatId
        );
      } else if (text.startsWith("/status")) {
        const subscribers = await getAllSubscribers();
        const isSubscribed = subscribers.includes(chatId);
        await sendTelegramMessage(
          isSubscribed
            ? "✅ You're subscribed to whale alerts!"
            : "❌ You're not subscribed. Send /start to subscribe.",
          chatId
        );
      } else {
        await sendTelegramMessage(
          "Send /start to subscribe to whale alerts!",
          chatId
        );
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // ========== ACTIVITIES WEBHOOK ==========
  if (pathname === "/activities" && req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, message: "POST webhook payloads to this endpoint." }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }

  if (pathname === "/activities" && req.method === "POST") {
    await kvStoreRaw("activities", req, rawBody);

    let parsed;
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

    const activities = parsed.activities;
    const counts = {};

    // Build transaction hash map for deduplication
    const txHashMap = new Map();
    activities.forEach((activity) => {
      const txHash = activity?.tx_hash;
      if (txHash) {
        if (!txHashMap.has(txHash)) {
          txHashMap.set(txHash, []);
        }
        txHashMap.get(txHash).push(activity);
      }
    });

    for (const activity of activities) {
      const t = activity?.type ?? "unknown";
      counts[t] = (counts[t] ?? 0) + 1;

      // Filter: Only track send, swap, mint, burn
      if (!["send", "swap", "mint", "burn"].includes(t)) {
        console.log(`ℹ️ Skipping activity type: ${t}`);
        continue;
      }

      // Deduplicate: Skip 'receive' if same tx has 'send'
      if (t === "receive") {
        const txHash = activity?.tx_hash;
        const txActivities = txHashMap.get(txHash) || [];
        const hasSend = txActivities.some((a) => a.type === "send");
        if (hasSend) {
          console.log(`ℹ️ Skipping duplicate 'receive' for tx ${txHash}`);
          continue;
        }
      }

      // Skip non-ERC20 activities
      if (activity?.asset_type !== "erc20" || !activity?.token_address) {
        console.log(`ℹ️ Skipping activity: ${t} (asset_type: ${activity?.asset_type})`);
        continue;
      }

      const tokenAddress = activity.token_address;
      const chainId = activity.chain_id || DEFAULT_CHAIN_ID;

      // Fetch token info for pricing and metadata
      let tokenSymbol = "unknown";
      let tokenName = "unknown";
      let tokenPrice = null;
      let tokenDecimals = 18;

      if (chainId && tokenAddress) {
        console.log(`🔍 Fetching token info for ${tokenAddress} on chain ${chainId}`);
        const tokenInfo = await fetchTokenInfo(tokenAddress, chainId);
        
        if (tokenInfo && tokenInfo.symbol && tokenInfo.name) {
          tokenSymbol = tokenInfo.symbol;
          tokenName = tokenInfo.name;
          tokenDecimals = tokenInfo.decimals || 18;
          tokenPrice = tokenInfo.price_usd || tokenInfo.price || null;
          console.log(`✅ Got token: ${tokenSymbol} (${tokenName}) - Price: $${tokenPrice || 'N/A'}`);
        }
      }

      // Format and broadcast Telegram message
      const message = formatActivityMessage(
        activity,
        tokenSymbol,
        tokenName,
        tokenPrice,
        tokenDecimals,
        chainId
      );
      await broadcastToSubscribers(message);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        received: activities.length,
        counts,
        received_at: nowISO(),
        duration_ms: Math.round(performance.now() - start),
      }, null, 2),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }

  // ========== FALLBACK ==========
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
});
