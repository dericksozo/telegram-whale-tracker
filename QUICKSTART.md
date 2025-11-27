# Whale Tracker - Quick Start Guide

## 🚀 Get Started in 2 Steps

The whale tracker is deployed on Deno Deploy and ready to use!

### Deployment URL (Testing Branch)
**https://sim-whale-tracker--subscriptions-setup.deno.dev**

---

## 📋 Prerequisites

- Telegram account (to receive alerts)
- That's it! No local setup needed.

---

## 🎯 Setup Process

### Step 1: Fetch Whale Addresses (One-time, ~1-2 minutes)

This fetches the top 20 token holders for each of the 151 tokens and stores them in Deno KV:

```bash
curl https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/fetch-whales
```

**What happens:**
1. Fetches 151 tokens from GitHub Gist
2. For each token, calls Sim APIs Token Holders endpoint
3. Stores ~3,000 whale addresses in Deno KV
4. Takes 1-2 minutes (250ms delay between requests for rate limiting)

**Expected output:**
```json
{
  "ok": true,
  "message": "Whale fetching complete",
  "total_tokens": 151,
  "processed_tokens": 151,
  "total_whales": 3020,
  "results": [...],
  "duration_ms": 90000
}
```

**If you see errors:**
- Check that `SIM_API_KEY` environment variable is set in Deno Deploy
- Some tokens may fail (404) - that's okay, just means holders aren't available for that token
- As long as `processed_tokens > 0`, you're good to proceed

---

### Step 2: Create Webhook (One-time, ~2 seconds)

This creates a Sim APIs webhook to monitor all whale addresses:

```bash
curl -X POST https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/create-webhooks
```

**What happens:**
1. Retrieves all whale addresses from Deno KV
2. Groups by chain ID
3. Creates webhook with Sim APIs Subscriptions API
4. Webhook will send events to `/activities` endpoint

**Expected output:**
```json
{
  "ok": true,
  "message": "Webhook creation complete",
  "success": true,
  "webhooks_created": 1,
  "webhook_ids": ["uuid-here"],
  "total_addresses": 3020,
  "chains": [1, 56, 137, 8453, 42161, ...]
}
```

**If webhook creation fails:**
- Verify `WEBHOOK_BASE_URL` is set correctly in environment
- Check that whales were fetched successfully in Step 1
- Ensure your Sim API key has webhook creation permissions

---

### Step 3: Subscribe to Alerts

1. Open Telegram
2. Search for your bot (the one created with @BotFather)
3. Send `/start` to the bot
4. You'll receive a welcome message

**Done! 🎉** You're now tracking 3,000+ whale wallets across 20+ blockchains.

---

## 📊 Check Status

Check system status and statistics:

```bash
curl https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/status
```

**Output:**
```json
{
  "ok": true,
  "whales": {
    "tokens_processed": 151,
    "total_whale_addresses": 3020
  },
  "webhooks": {
    "count": 1,
    "ids": ["uuid-here"]
  },
  "telegram": {
    "subscribers_count": 1
  },
  "status": "ready"
}
```

---

## 🔔 What Happens Next?

Once setup is complete, here's the flow:

1. **Whale makes a transaction** (send, swap, mint, burn)
2. **Sim APIs detects it** instantly (sub-second)
3. **Sends webhook** to your `/activities` endpoint
4. **Server processes** the activity:
   - Filters activity type (only send, swap, mint, burn)
   - Fetches token metadata (symbol, name, price, decimals)
   - Calculates USD value
5. **Formats beautiful message** with emojis and links
6. **Broadcasts to all Telegram subscribers**

---

## 📱 Example Alerts

### Large Transfer ($50M+)
```
🚨 🚨 🚨 🚨 🚨 50,000,000 #USDC ($50,000,000) 
transferred from [0x742d35Cc6...] to [0x8ac2...]

[Tx Link] · Powered by Sim APIs
```

### Burn Event
```
🔥 🔥 🔥 🔥 1,000,000 #WETH ($2,800,000) 
burned at [0x1234...]

[Tx Link] · Powered by Sim APIs
```

### Swap
```
🔄 🔄 🔄 250,000 #UNI ($1,500,000) 
swapped by [0x5678...]

[Tx Link] · Powered by Sim APIs
```

**Emoji Scale (based on USD value):**
- 🚨 x1: $100k - $500k
- 🚨 x2: $500k - $1M  
- 🚨 x3: $1M - $5M
- 🚨 x4: $5M - $10M
- 🚨 x5: $10M - $50M
- 🚨 x6-9: $50M+ (scales up to $500M+)

---

## 🛠️ Useful Commands

### Health Check
```bash
curl https://sim-whale-tracker--subscriptions-setup.deno.dev/health
```

### Get Setup Status
```bash
curl https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/status
```

### Get All Whales as JSON (Debug)
```bash
curl https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/get-whales-json
```

Returns all whale data from Deno KV - useful for debugging webhook creation issues.

### Clear All Data (Reset)
```bash
curl https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/clear
```

### Re-fetch Whales
```bash
curl https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/fetch-whales
```

### Re-create Webhook
```bash
curl -X POST https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/create-webhooks
```

---

## 🐛 Troubleshooting

### "No whale addresses found"
**Cause:** Haven't run Step 1 yet  
**Solution:** Run `curl .../setup/fetch-whales`

### "Failed to fetch tokens from GitHub Gist"
**Cause:** Network issue or Gist URL changed  
**Solution:** Check the Gist URL is accessible in browser

### "Unauthorized" from Sim APIs
**Cause:** Invalid or missing `SIM_API_KEY`  
**Solution:** Check environment variables in Deno Deploy dashboard

### "Failed to create webhook"
**Cause:** Invalid webhook URL or no whales fetched  
**Solution:** 
1. Verify `WEBHOOK_BASE_URL` environment variable
2. Ensure Step 1 completed successfully
3. Check webhook URL is publicly accessible

### All token holders return 404
**Cause:** Incorrect API endpoint format  
**Solution:** Code now uses correct format: `/token-holders/{chain_id}/{address}?api_key=xxx`

### Telegram messages not arriving
**Cause:** No subscribers or invalid bot token  
**Solution:**
1. Send `/start` to your bot on Telegram
2. Verify `TELEGRAM_BOT_TOKEN` in Deno Deploy dashboard
3. Check logs for error messages

### Some tokens fail to fetch
**Cause:** Not all tokens have holder data available on all chains  
**Solution:** This is normal - as long as SOME tokens succeed, the system will work

---

## 📈 Expected Timeline

### Initial Setup
- **Step 1** (Fetch Whales): 1-2 minutes
- **Step 2** (Create Webhook): 2-3 seconds
- **Step 3** (Subscribe): 10 seconds
- **Total**: ~2-3 minutes

### First Alert
- Depends on whale activity
- High-volume chains (Base, BSC) usually see activity within minutes
- Lower-volume chains may take longer

---

## ✅ Success Indicators

You'll know it's working when:

1. ✅ `/setup/status` shows:
   - `tokens_processed > 0`
   - `webhooks.count = 1`
   - `subscribers_count > 0`
   - `status = "ready"`

2. ✅ Telegram bot responds to `/start` with welcome message

3. ✅ You receive your first whale alert (may take a few minutes)

---

## 💡 Pro Tips

1. **Monitor the logs** - Deno Deploy dashboard shows real-time logs
2. **Start small** - Subscribe with one account first, test it works
3. **Be patient** - First alert may take a few minutes (whales don't move constantly)
4. **Check high-volume chains** - Base and BSC are usually very active
5. **Use /status command** - In Telegram, send `/status` to check subscription

---

## 🎓 Understanding the System

### What Are Whales?
Top 20 token holders for each of the 151 tracked tokens.

### What Gets Tracked?
- **Sends**: When whales transfer tokens
- **Swaps**: When whales trade tokens
- **Mints**: When new tokens are created
- **Burns**: When tokens are destroyed

### What Gets Filtered Out?
- Approvals (too noisy)
- Receives (deduplicated if send exists)
- Non-ERC20 activities
- Activities without token addresses

### How Are USD Values Calculated?
- Fetches token price from Sim APIs Token Info endpoint
- Multiplies amount × price
- Displays in message if price is available

---

## 🔐 Environment Variables

These should be set in Deno Deploy dashboard:

```
SIM_API_KEY=sim_your_api_key_here
TELEGRAM_BOT_TOKEN=your_bot_token_here
WEBHOOK_BASE_URL=https://sim-whale-tracker--subscriptions-setup.deno.dev
```

**Optional:**
```
DEFAULT_CHAIN_ID=1
TOP_HOLDERS_LIMIT=20
```

---

## 🎊 You're All Set!

Once both setup steps complete successfully:
- ✅ System is monitoring 3,000+ whale wallets
- ✅ Tracking activity across 20+ blockchains
- ✅ Sending real-time alerts to Telegram
- ✅ Beautiful formatted messages with USD values

**Questions?** Check the logs in Deno Deploy dashboard - every step is logged with emoji indicators! 🔍 ✅ ❌ ⚠️

---

## 📚 Additional Resources

- **Main Documentation**: See [README.md](README.md)
- **Source Code**: See [main.ts](main.ts)
- **Sim APIs Docs**: https://docs.sim.dune.com
- **Telegram Bot API**: https://core.telegram.org/bots/api

