// Will be used in later steps for Sim API calls
const _SIM_API_KEY = Deno.env.get("SIM_API_KEY") || "sim_3HEp7EPlougJMPs9GhCOXVjqwyfwIhO0";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "dev-secret-123";

interface WebhookPayload {
  id: string;
  type: string;
  data: {
    transaction: {
      hash: string;
      from: string;
      to: string;
      value?: string;
      blockNumber: number;
      timestamp: number;
      chainId: number;
      // Add more fields as needed based on Sim API response
    };
  };
}

async function handleWebhook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");

  // Verify webhook secret for basic security
  if (secret !== WEBHOOK_SECRET) {
    console.warn("Unauthorized webhook attempt");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload: WebhookPayload = await req.json();
    console.log("Received webhook event:", {
      id: payload.id,
      type: payload.type,
      txHash: payload.data?.transaction?.hash,
      from: payload.data?.transaction?.from,
      to: payload.data?.transaction?.to,
    });

    // TODO: Process the transaction and send to Telegram
    // We'll implement this in later steps

    // Respond quickly to avoid retries
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const { pathname } = new URL(req.url);

  // Health check endpoint
  if (pathname === "/health" && req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Webhook endpoint
  if (pathname === "/webhook" && req.method === "POST") {
    return await handleWebhook(req);
  }

  // 404 for all other routes
  return new Response("Not Found", { status: 404 });
});
