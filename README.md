# Telegram Whale Tracker

A real-time Telegram bot that monitors large cryptocurrency holders ("whales") and sends alerts when they execute on-chain transactions. Tracks 150+ top ERC20 tokens across 20+ blockchains.

## Architecture

- **Dune Analytics**: Identifies popular ERC20 tokens by volume across chains
- **Sim APIs Token Holders**: Identifies top holders (whales) for each token
- **Sim APIs Subscriptions**: Creates webhooks to monitor whale wallet activities
- **Webhook Server**: Deno server that receives and processes blockchain events
- **Telegram Bot**: Sends beautifully formatted whale alerts to subscribers
- **Deno KV**: Stores whale addresses and webhook metadata

## Getting Started

### Prerequisites

- [Deno](https://deno.land/) installed
- Sim API key (get one at [sim.io](https://sim.io))
- Telegram bot token (create via [@BotFather](https://t.me/botfather))

### Telegram Bot Setup

1. **Create a bot**:
   - Message [@BotFather](https://t.me/botfather) on Telegram
   - Send `/newbot` and follow the instructions
   - Copy the bot token (format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

2. **Get your Chat ID**:
   - Start a conversation with your new bot
   - Send any message to the bot
   - Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` in your browser
   - Find your chat ID in the JSON response (look for `"chat":{"id":123456789...}`)
   - Alternatively, message [@userinfobot](https://t.me/userinfobot) to get your chat ID

3. **Add the credentials to your `.env` file**:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   ```

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd telegram-whale-tracker
```

2. Copy the environment variables template:
```bash
cp .env.example .env
```

3. Edit `.env` and add your API keys

### Running the Server

```bash
deno run --allow-net --allow-env --allow-read --unstable-kv main.ts
```

The server will start on port 8000 by default.

**Required Permissions:**
- `--allow-net`: Network access for Sim APIs and Telegram
- `--allow-env`: Environment variables (API keys, tokens)
- `--allow-read`: Read filtered tokens JSON file
- `--unstable-kv`: Deno KV database access

## 🚀 Quick Start - Setup Workflow

Once your server is running, you need to:
1. **Fetch whale addresses** from top token holders
2. **Create webhooks** to monitor these whale addresses
3. **Subscribe** to Telegram alerts

### Step 1: Fetch Whale Addresses

This endpoint fetches the top 20 token holders for each of the 150+ filtered tokens and stores them in Deno KV:

```bash
# Fetch and store all whale addresses
curl https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/fetch-whales
```

**What it does:**
- Reads `data/top_erc20_tokens_filtered.json` (150+ tokens)
- Calls Sim APIs Token Holders endpoint for each token
- Stores whale addresses in Deno KV database
- Takes ~5-10 minutes to complete

**Expected output:**
```json
{
  "ok": true,
  "message": "Whale fetching complete",
  "total_tokens": 151,
  "processed_tokens": 151,
  "total_whales": 3020,
  "duration_ms": 456789
}
```

### Step 2: Create Webhooks

This endpoint creates Sim APIs webhooks to monitor all whale addresses:

```bash
# Create webhooks to monitor whales
curl -X POST https://sim-whale-tracker--subscriptions-setup.deno.dev/setup/create-webhooks
```

**What it does:**
- Retrieves all whale addresses from KV
- Groups them by chain ID
- Creates a single webhook with all addresses (no artificial limits)
- Stores webhook ID in KV for management

**Expected output:**
```json
{
  "ok": true,
  "message": "Webhook creation complete",
  "success": true,
  "webhooks_created": 1,
  "webhook_ids": ["uuid-webhook-id"],
  "total_addresses": 3020,
  "chains": [1, 56, 137, 8453, 42161, ...]
}
```

### Step 3: Subscribe to Telegram Alerts

1. Find your Telegram bot (created with @BotFather)
2. Send `/start` to the bot
3. You'll receive a welcome message
4. Done! You'll now receive whale alerts in real-time

### Check Setup Status

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
    "count": 3,
    "ids": ["uuid-1", "uuid-2", "uuid-3"]
  },
  "telegram": {
    "subscribers_count": 5
  },
  "status": "ready"
}
```

## API Endpoints

### Health Check
```bash
GET /health
```

Returns the server status and timestamp.

### Setup Endpoints

#### `GET/POST /setup/fetch-whales`
Fetches top token holders for all tokens and stores them as whales.

**Configuration:**
- `TOP_HOLDERS_LIMIT`: Number of holders per token (default: 20)
- Input file: `data/top_erc20_tokens_filtered.json`

#### `GET/POST /setup/create-webhooks`  
Creates Sim APIs webhooks to monitor all whale addresses.

**Configuration:**
- `WEBHOOK_BASE_URL`: Your deployment URL (e.g., `https://your-app.deno.dev`)
- Webhook endpoint: `/activities`
- Batch size: 1000 addresses per webhook

#### `GET /setup/status`
Check current setup status and statistics.

#### `GET/POST /setup/clear`
Clear all stored whale and webhook data (useful for testing/reset).

### Activities Webhook
```bash
POST /activities?secret=YOUR_WEBHOOK_SECRET
```

Receives activity payloads from Sim's Subscriptions API. Stores raw payloads in Deno KV for deduplication and traceability.

### Transactions Webhook
```bash
POST /transactions?secret=YOUR_WEBHOOK_SECRET
```

Receives transaction payloads from Sim's Subscriptions API. Stores raw payloads in Deno KV with comprehensive logging of transaction details including gas, decoded data, and event logs.

### Balances Webhook
```bash
POST /balances?secret=YOUR_WEBHOOK_SECRET
```

Receives balance change payloads from Sim's Subscriptions API. Stores raw payloads in Deno KV and logs balance change direction counts and asset information. **Also sends formatted Telegram messages for each balance change.**

### Telegram Message Format

The bot sends beautifully formatted whale alerts with dynamic emoji intensity:

#### Example: Large Transfer ($5M+)
```
🚨 🚨 🚨 🚨 🚨 50,000,000 #USDC ($50,000,000) transferred from [0x742d...] to [0x8ac2...]

[Tx Link] · Powered by Sim APIs
```

#### Example: Burn Event
```
🔥 🔥 🔥 🔥 1,000,000 #WETH ($2,800,000) burned at [0x1234...]

[Tx Link] · Powered by Sim APIs
```

#### Example: Swap
```
🔄 🔄 🔄 250,000 #UNI ($1,500,000) swapped by [0x5678...]

[Tx Link] · Powered by Sim APIs
```

**Emoji Scale (based on USD value):**
- 🚨 x1: $100k - $500k
- 🚨 x2: $500k - $1M
- 🚨 x3: $1M - $5M
- 🚨 x4: $5M - $10M
- 🚨 x5: $10M - $50M
- 🚨 x6-9: $50M+ (up to $500M+)

**Features:**
- Clickable wallet addresses → block explorer
- Clickable transaction link → block explorer
- Token hashtags for easy searching
- USD value display (when pricing available)
- "Powered by Sim APIs" branding

## Development Roadmap

- [x] Step 1: Build webhook server infrastructure
- [x] Step 2: Data collection with Dune (identify popular tokens)
- [x] Step 3: Whale identification with Token Holders API
- [x] Step 4: Subscription setup with Subscriptions API
- [x] Step 5: Telegram bot integration
- [x] Step 6: Message processing and formatting
- [x] Step 7: Automated whale fetching and webhook creation
- [ ] Step 8: Filtering system (volume thresholds, token categories)
- [ ] Step 9: Deployment to Deno Deploy
- [ ] Step 10: Performance optimization and monitoring

## Testing

Test the health endpoint:
```bash
curl http://localhost:8000/health
```

Test the transactions webhook endpoint:
```bash
curl -X POST "http://localhost:8000/transactions?secret=dev-secret-123" \
  -H "Content-Type: application/json" \
  -d '{
    "transactions": [{
      "hash": "0xtest",
      "from": "0x1234",
      "to": "0x5678",
      "chain": "ethereum",
      "chain_id": 1,
      "block_number": 12345,
      "block_time": "2024-01-01T00:00:00Z",
      "transaction_type": "contract_execution",
      "success": true,
      "value": "1000000000000000000",
      "logs": []
    }]
  }'
```

Test the activities webhook endpoint:
```bash
curl -X POST "http://localhost:8000/activities?secret=dev-secret-123" \
  -H "Content-Type: application/json" \
  -d '{
    "activities": [{
      "type": "erc20_transfer",
      "chain_id": 1,
      "block_number": 12345,
      "tx_hash": "0xtest"
    }]
  }'
```

Test the balances webhook endpoint:
```bash
curl -X POST "http://localhost:8000/balances?secret=dev-secret-123" \
  -H "Content-Type: application/json" \
  -d '{
    "balance_changes": [{
      "amount_delta": "392126",
      "direction": "in",
      "asset": {
        "symbol": "USDC",
        "decimals": 6
      },
      "subscribed_address": "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
      "transaction_hash": "0x51a97de72ba1fb37f74046706147eb9469e7e90f2ab3671c6cca99a8111e74f0"
    }]
  }'
```

## ✨ Features

### Whale Tracking
- **Automated Discovery**: Fetches top 20 holders for 150+ tokens across 20+ chains
- **Multi-Chain Support**: Ethereum, BSC, Polygon, Arbitrum, Base, Avalanche, and more
- **Smart Filtering**: Tracks only high-volume tokens from Dune Analytics
- **Deduplication**: Prevents duplicate alerts for whale-to-whale transfers

### Real-Time Alerts
- **Instant Notifications**: Sub-second alerts when whales move tokens
- **USD Value Tracking**: Shows transaction value in USD using live pricing
- **Smart Emoji System**: Alert intensity scales with transaction size (1-9 🚨 based on USD value)
- **Activity Types**: Tracks sends, swaps, mints, and burns
- **Rich Metadata**: Token symbols, amounts, wallet links, transaction links

### Technical Features
- **Deno KV Storage**: Stores whale addresses and webhook metadata
- **Batch Processing**: Handles 1000s of addresses per webhook
- **Rate Limiting**: Respectful API usage with automatic delays
- **Idempotent**: Prevents duplicate webhook processing
- **Comprehensive Logging**: Detailed console logs for debugging
- **Zero Downtime**: Handles webhook creation without interrupting alerts

### Telegram Bot
- **Multi-User**: Support for unlimited subscribers via `/start` command
- **Markdown Formatting**: Beautiful, readable messages with clickable links
- **Status Command**: Check subscription status with `/status`
- **UTF-8 Safe**: Automatic sanitization for special characters

## Configuration

### Environment Variables

Create a `.env` file or set these environment variables:

```bash
# Required
SIM_API_KEY=sim_your_api_key_here
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# Required for webhook creation
WEBHOOK_BASE_URL=https://your-deployment.deno.dev

# Optional
DEFAULT_CHAIN_ID=1                    # Default: 1 (Ethereum)
TOP_HOLDERS_LIMIT=20                  # Default: 20 holders per token
```

### Data Files

**`data/top_erc20_tokens_filtered.json`**

This file contains the curated list of top ERC20 tokens to track. Each entry includes:
```json
{
  "blockchain": "ethereum",
  "rank": 1,
  "symbol": "USDC",
  "price_usd": 1.0,
  "volume_24h": 1000000000,
  "contract_address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "chain_id": "1",
  "category": "stable"
}
```

**Categories:**
- `stable`: Stablecoins (USDC, USDT, DAI, etc.)
- `blue_chip`: Major tokens (WBTC, WETH, etc.)
- `degen`: High-volume but volatile tokens

**Total tokens:** ~151 tokens across 20+ chains

### Supported Chains

The system supports all Sim APIs chains:
- Ethereum (1)
- Binance Smart Chain (56)
- Polygon (137)
- Arbitrum (42161)
- Base (8453)
- Optimism (10)
- Avalanche C-Chain (43114)
- And 15+ more (see `top_erc20_tokens_filtered.json`)

### Rate Limits

**Sim APIs Rate Limit: Maximum 5 requests per second**

The system respects this limit with automatic delays:
- **Delay Between Requests**: 250ms (4 req/sec for safety margin)
- **Token Holders API**: 250ms delay between each token fetch
- **Webhook Creation**: 250ms delay between webhook creations
- **Webhook Batching**: Max 1000 addresses per webhook
- **Estimated Setup Time**: ~1 minute for 151 tokens (250ms × 151 = 37.75 seconds + API processing time)

### Storage (Deno KV)

**KV Keys:**
- `["whales", chainId, tokenAddress]` - Whale holder data
- `["webhooks", "ids", webhookId]` - Webhook metadata
- `["telegram", "subscribers", chatId]` - Telegram subscribers
- `["sim", "webhooks", type, id]` - Raw webhook payloads

## Deployment

### Deno Deploy

1. **Install Deno Deploy CLI:**
```bash
deno install --allow-read --allow-write --allow-env --allow-net --allow-run -n deployctl --no-check -r -f https://deno.land/x/deploy/deployctl.ts
```

2. **Deploy:**
```bash
deployctl deploy --project=whale-tracker main.ts
```

3. **Set environment variables** in Deno Deploy dashboard:
   - `SIM_API_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `WEBHOOK_BASE_URL` (your deployment URL)

4. **Run setup:**
```bash
# Fetch whales
curl https://your-project.deno.dev/setup/fetch-whales

# Create webhooks
curl -X POST https://your-project.deno.dev/setup/create-webhooks
```

### Alternative: Local Development

```bash
# Clone the repository
git clone <your-repo-url>
cd telegram-whale-tracker

# Create .env file
cp .env.example .env
# Edit .env with your API keys

# Run the server
deno run --allow-net --allow-env --allow-read --unstable-kv main.ts

# In another terminal, run setup
curl http://localhost:8000/setup/fetch-whales
curl -X POST http://localhost:8000/setup/create-webhooks
```

## Troubleshooting

### "No whale addresses found"
- **Cause**: Haven't run `/setup/fetch-whales` yet
- **Solution**: Run `curl http://your-url/setup/fetch-whales` first

### "Failed to create webhook"
- **Cause**: Invalid `WEBHOOK_BASE_URL` or Sim API key
- **Solution**: Check environment variables and ensure URL is accessible

### "Token info not found"
- **Cause**: Token might not be on the expected chain
- **Solution**: System will try multiple chains automatically

### Rate Limiting Errors
- **Cause**: Making too many requests to Sim APIs
- **Solution**: The system has built-in rate limiting, but you can increase delays if needed

### Telegram Messages Not Sending
- **Cause**: Invalid bot token or no subscribers
- **Solution**: 
  1. Verify `TELEGRAM_BOT_TOKEN` is correct
  2. Send `/start` to your bot on Telegram
  3. Check logs for error messages

## Contributing

Contributions welcome! This is designed to be:
- **Portable**: Easy to move from Deno to Node.js if needed
- **Minimal TypeScript**: Written as JavaScript with minimal type annotations
- **Single File**: All logic in `main.ts` for easy deployment

## License

MIT

