# Telegram Whale Tracker

A real-time Telegram bot that monitors large cryptocurrency holders ("whales") and sends alerts when they execute on-chain transactions.

## Architecture

- **Dune Analytics**: Identifies popular ERC20 tokens across chains
- **Sim APIs**: Token Holders API (identify whales) + Subscriptions API (monitor transactions)
- **Webhook Server**: Deno server that receives events and processes them
- **Telegram Bot**: Sends formatted alerts to a Telegram group

## Getting Started

### Prerequisites

- [Deno](https://deno.land/) installed
- Sim API key (get one at [sim.io](https://sim.io))
- Telegram bot token (create via [@BotFather](https://t.me/botfather))

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
deno run --allow-net --allow-env main.ts
```

The server will start on port 8000 by default.

## API Endpoints

### Health Check
```bash
GET /health
```

Returns the server status and timestamp.

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

Receives balance change payloads from Sim's Subscriptions API. Stores raw payloads in Deno KV and logs balance change direction counts and asset information.

## Development Roadmap

- [x] Step 1: Build webhook server infrastructure
- [ ] Step 2: Data collection with Dune (identify popular tokens)
- [ ] Step 3: Whale identification with Token Holders API
- [ ] Step 4: Subscription setup with Subscriptions API
- [ ] Step 5: Telegram bot integration
- [ ] Step 6: Message processing and formatting
- [ ] Step 7: Deployment

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

## Features

- **Deno KV Storage**: Automatically stores all webhook payloads with deduplication
- **Idempotent**: Uses webhook IDs or SHA-256 hashes to prevent duplicate storage on retries
- **Comprehensive Logging**: Detailed request/response logging with transaction breakdowns
- **Security**: URL secret-based authentication for webhook endpoints
- **Fast Response**: Responds quickly to avoid webhook retry behavior

## License

MIT

