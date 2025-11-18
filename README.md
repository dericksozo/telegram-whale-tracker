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

Returns the server status.

### Webhook
```bash
POST /webhook?secret=YOUR_WEBHOOK_SECRET
```

Receives transaction events from Sim's Subscriptions API. The webhook URL should include your `WEBHOOK_SECRET` as a query parameter for basic security.

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

Test the webhook endpoint:
```bash
curl -X POST "http://localhost:8000/webhook?secret=dev-secret-123" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-123",
    "type": "transaction",
    "data": {
      "transaction": {
        "hash": "0xtest",
        "from": "0x1234",
        "to": "0x5678",
        "blockNumber": 12345,
        "timestamp": 1234567890,
        "chainId": 1
      }
    }
  }'
```

## License

MIT

