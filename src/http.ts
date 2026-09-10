import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry } from "./registry.js";
import { loadConfig, EnvSource } from "./config.js";
import { buildMcpServer, TOOLS } from "./server.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const LANDING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");

// Pull this client's courier keys from request headers or query params, with fallback to environment
function keysFromRequest(req: Request): EnvSource {
  const h = req.headers;
  const q = req.query as Record<string, string | undefined>;
  const pick = (header: string, query: string, envVar?: string): string | undefined => {
    const hv = h[header];
    const v = (Array.isArray(hv) ? hv[0] : hv) ?? q[query];
    return v ? String(v) : (envVar ? process.env[envVar] : undefined);
  };

  return {
    STEADFAST_API_KEY: pick("x-steadfast-api-key", "steadfast_key", "STEADFAST_API_KEY"),
    STEADFAST_SECRET_KEY: pick("x-steadfast-secret-key", "steadfast_secret", "STEADFAST_SECRET_KEY"),
    STEADFAST_BASE_URL: pick("x-steadfast-base-url", "steadfast_base_url", "STEADFAST_BASE_URL"),
    PATHAO_CLIENT_ID: pick("x-pathao-client-id", "pathao_client_id", "PATHAO_CLIENT_ID"),
    PATHAO_CLIENT_SECRET: pick("x-pathao-client-secret", "pathao_client_secret", "PATHAO_CLIENT_SECRET"),
    PATHAO_USERNAME: pick("x-pathao-username", "pathao_username", "PATHAO_USERNAME"),
    PATHAO_PASSWORD: pick("x-pathao-password", "pathao_password", "PATHAO_PASSWORD"),
    PATHAO_STORE_ID: pick("x-pathao-store-id", "pathao_store_id", "PATHAO_STORE_ID"),
    PATHAO_BASE_URL: pick("x-pathao-base-url", "pathao_base_url", "PATHAO_BASE_URL"),
    REDX_API_TOKEN: pick("x-redx-api-token", "redx_token", "REDX_API_TOKEN"),
    REDX_BASE_URL: pick("x-redx-base-url", "redx_base_url", "REDX_BASE_URL"),
    REDX_PICKUP_STORE_ID: pick("x-redx-pickup-store-id", "redx_pickup_store_id", "REDX_PICKUP_STORE_ID"),
    PAPERFLY_API_KEY: pick("x-paperfly-api-key", "paperfly_key", "PAPERFLY_API_KEY"),
    PAPERFLY_USERNAME: pick("x-paperfly-username", "paperfly_username", "PAPERFLY_USERNAME"),
    PAPERFLY_PASSWORD: pick("x-paperfly-password", "paperfly_password", "PAPERFLY_PASSWORD"),
    PAPERFLY_STORE_NAME: pick("x-paperfly-store-name", "paperfly_store", "PAPERFLY_STORE_NAME"),
    GOOGLE_MAPS_API_KEY: pick("x-google-maps-key", "google_maps_key", "GOOGLE_MAPS_API_KEY"),
  };
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Allow browser-based and cross-origin MCP clients.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, x-steadfast-api-key, x-steadfast-secret-key, x-steadfast-base-url, x-pathao-client-id, x-pathao-client-secret, x-pathao-username, x-pathao-password, x-pathao-store-id, x-pathao-base-url, x-redx-api-token, x-redx-base-url, x-redx-pickup-store-id, x-paperfly-api-key, x-paperfly-username, x-paperfly-password, x-paperfly-store-name, x-google-maps-key"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Memory Leak Prevention: Managed Session with Automatic Idle Eviction & Garbage Collection
interface ManagedSession {
  transport: StreamableHTTPServerTransport;
  lastActiveAt: number;
}

const sessions = new Map<string, ManagedSession>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1-hour idle expiration

// Sweep abandoned sessions every 15 minutes to prevent heap bloat
setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of sessions.entries()) {
    if (now - entry.lastActiveAt > SESSION_TTL_MS) {
      console.log(`[Memory GC] Evicting stale MCP session: ${sid}`);
      try {
        entry.transport.close?.();
      } catch {}
      sessions.delete(sid);
    }
  }
}, 15 * 60 * 1000).unref();

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && sessions.has(sessionId)) {
    const entry = sessions.get(sessionId)!;
    entry.lastActiveAt = Date.now();
    transport = entry.transport;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    const registry = new CourierRegistry(loadConfig(keysFromRequest(req)));
    const server = buildMcpServer(registry);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, lastActiveAt: Date.now() });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: missing or invalid session. Send an initialize request first." },
      id: null,
    });
    return;
  }

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: `Internal error: ${err?.message || String(err)}` },
        id: null,
      });
    }
  }
});

// GET (server->client SSE stream) and DELETE (end session) for an existing session.
async function handleSessionRequest(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const entry = sessions.get(sessionId)!;
  entry.lastActiveAt = Date.now();
  await entry.transport.handleRequest(req, res);
}
app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

/**
 * Official Steadfast Webhook Integration Endpoint
 * Callback URL: https://courier.auraajenticai.cloud/webhooks/steadfast
 */
app.post("/webhooks/steadfast", (req: Request, res: Response) => {
  const payload = req.body;
  console.log("[Steadfast Webhook Received]:", JSON.stringify(payload));

  if (!payload || !payload.consignment_id) {
    return res.status(400).json({
      status: "error",
      message: "Invalid consignment ID.",
    });
  }

  const notifType = payload.notification_type || "delivery_status";
  const consignmentId = payload.consignment_id;
  const status = payload.status; // pending, delivered, partial_delivered, cancelled, unknown
  const invoice = payload.invoice;

  console.log(`[Steadfast Update] Consignment: ${consignmentId} | Invoice: ${invoice} | Type: ${notifType} | Status: ${status}`);

  if (status === "cancelled") {
    console.warn(`[Steadfast NDR Alert] Consignment ${consignmentId} was cancelled. Initiating NDR triage.`);
  }

  return res.status(200).json({
    status: "success",
    message: "Webhook received successfully.",
  });
});

/**
 * Official Pathao Webhook Integration Endpoint
 * Callback URL: https://courier.auraajenticai.cloud/webhooks/pathao
 */
app.post("/webhooks/pathao", (req: Request, res: Response) => {
  const payload = req.body;
  console.log("[Pathao Webhook Received]:", JSON.stringify(payload));
  return res.status(200).json({
    status: "success",
    message: "Pathao webhook received successfully.",
  });
});

/**
 * Official RedX Webhook Integration Endpoint
 * Callback URL: https://courier.auraajenticai.cloud/webhooks/redx
 */
app.post("/webhooks/redx", (req: Request, res: Response) => {
  const payload = req.body;
  console.log("[RedX Webhook Received]:", JSON.stringify(payload));
  return res.status(200).json({
    status: "success",
    message: "RedX webhook received successfully.",
  });
});

/**
 * Official Paperfly Webhook Integration Endpoint
 * Callback URL: https://courier.auraajenticai.cloud/webhooks/paperfly
 */
app.post("/webhooks/paperfly", (req: Request, res: Response) => {
  const payload = req.body;
  console.log("[Paperfly Webhook Received]:", JSON.stringify(payload));
  return res.status(200).json({
    status: "success",
    message: "Paperfly webhook received successfully.",
  });
});

app.get("/health", (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    service: "aura-courier-mcp",
    version: "2.4.0",
    tools_count: TOOLS.length,
    spatial_engine: "Google Maps Platform (gmp_git_agentskills_v1)",
    fraud_engine: "Steadfast Nationwide API + BD Prefix Validator",
    webhooks: {
      steadfast: "/webhooks/steadfast",
      pathao: "/webhooks/pathao",
      redx: "/webhooks/redx",
      paperfly: "/webhooks/paperfly",
    },
    performance: {
      sessions_active: sessions.size,
      heap_used_mb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heap_total_mb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      rss_mb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      uptime_seconds: Math.round(process.uptime()),
    },
  });
});

app.get("/", (_req, res) => {
  res.sendFile(LANDING, (err) => {
    if (err && !res.headersSent) {
      res
        .type("html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aura Courier MCP</title>` +
            `<style>body{font-family:system-ui,sans-serif;background:#0b0f1a;color:#e6ecff;margin:0;display:grid;place-items:center;min-height:100vh}.b{max-width:640px;padding:40px;text-align:center}h1{font-size:28px;margin:0 0 10px}code{background:#141c30;padding:2px 8px;border-radius:6px;color:#7dd3fc;font-size:13px}a{color:#7dd3fc}p{line-height:1.6;color:#9fb0d0}</style></head>` +
            `<body><div class="b"><h1>🚚 Aura Courier MCP v2.4.0</h1><p>Enterprise Bangladesh courier MCP &amp; Google Maps Platform spatial hub.</p>` +
            `<p>Connect your AI to <code>POST /mcp</code> with Streamable-HTTP.</p>` +
            `<p>Webhooks: <code>POST /webhooks/steadfast</code> · <code>POST /webhooks/pathao</code></p>` +
            `<p>By <a href="https://auraajenticai.cloud">Aura Ajentic AI</a> · <a href="https://courier.auraajenticai.cloud">docs &amp; setup</a></p></div></body></html>`
        );
    }
  });
});

app.listen(PORT, () => {
  console.log(`Aura Courier MCP (HTTP) listening on :${PORT} — POST /mcp`);
});
