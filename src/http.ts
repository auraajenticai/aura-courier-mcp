import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry } from "./registry.js";
import { loadConfig, EnvSource } from "./config.js";
import { buildMcpServer } from "./server.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8080);
// Marketing landing (index.html) sits at the repo root, one level above dist/.
const LANDING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");

// Pull this client's courier keys from request headers or query params.
// Captured once per session (on the initialize request) and bound to that session's server.
function keysFromRequest(req: Request): EnvSource {
  const h = req.headers;
  const q = req.query as Record<string, string | undefined>;
  const pick = (header: string, query: string): string | undefined => {
    const hv = h[header];
    const v = (Array.isArray(hv) ? hv[0] : hv) ?? q[query];
    return v ? String(v) : undefined;
  };
  return {
    STEADFAST_API_KEY: pick("x-steadfast-api-key", "steadfast_key"),
    STEADFAST_SECRET_KEY: pick("x-steadfast-secret-key", "steadfast_secret"),
    STEADFAST_BASE_URL: pick("x-steadfast-base-url", "steadfast_base_url"),
    PATHAO_CLIENT_ID: pick("x-pathao-client-id", "pathao_client_id"),
    PATHAO_CLIENT_SECRET: pick("x-pathao-client-secret", "pathao_client_secret"),
    PATHAO_USERNAME: pick("x-pathao-username", "pathao_username"),
    PATHAO_PASSWORD: pick("x-pathao-password", "pathao_password"),
    PATHAO_STORE_ID: pick("x-pathao-store-id", "pathao_store_id"),
    PATHAO_BASE_URL: pick("x-pathao-base-url", "pathao_base_url"),
    REDX_API_TOKEN: pick("x-redx-api-token", "redx_token"),
    REDX_BASE_URL: pick("x-redx-base-url", "redx_base_url"),
    REDX_PICKUP_STORE_ID: pick("x-redx-pickup-store-id", "redx_pickup_store_id"),
  };
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Allow browser-based and cross-origin MCP clients.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, x-steadfast-api-key, x-steadfast-secret-key, x-steadfast-base-url, x-pathao-client-id, x-pathao-client-secret, x-pathao-username, x-pathao-password, x-pathao-store-id, x-pathao-base-url, x-redx-api-token, x-redx-base-url, x-redx-pickup-store-id"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Active sessions: sessionId -> transport (each bound to one client's keys).
const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // Existing session — reuse its server (already holds this client's keys).
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New session — capture THIS client's courier keys now.
    const registry = new CourierRegistry(loadConfig(keysFromRequest(req)));
    const server = buildMcpServer(registry);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
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
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}
app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "aura-courier-mcp", version: "2.1.0", sessions: Object.keys(transports).length })
);

app.get("/", (_req, res) => {
  // Serve the marketing landing page; fall back to a minimal page if it's missing.
  res.sendFile(LANDING, (err) => {
    if (err && !res.headersSent) {
      res
        .type("html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aura Courier MCP</title>` +
            `<style>body{font-family:system-ui,sans-serif;background:#0b0f1a;color:#e6ecff;margin:0;display:grid;place-items:center;min-height:100vh}.b{max-width:640px;padding:40px;text-align:center}h1{font-size:28px;margin:0 0 10px}code{background:#141c30;padding:2px 8px;border-radius:6px;color:#7dd3fc;font-size:13px}a{color:#7dd3fc}p{line-height:1.6;color:#9fb0d0}</style></head>` +
            `<body><div class="b"><h1>🚚 Aura Courier MCP</h1><p>Live remote MCP endpoint for Bangladesh couriers — Steadfast &amp; Pathao.</p>` +
            `<p>Connect your AI to <code>POST /mcp</code> and pass your courier keys as headers (<code>x-steadfast-api-key</code>, <code>x-steadfast-secret-key</code>) or query params (<code>?steadfast_key=…&amp;steadfast_secret=…</code>).</p>` +
            `<p>By <a href="https://auraajenticai.cloud">Aura Ajentic AI</a> · <a href="https://courier.auraajenticai.cloud">docs &amp; setup</a></p></div></body></html>`
        );
    }
  });
});

app.listen(PORT, () => {
  console.log(`Aura Courier MCP (HTTP) listening on :${PORT} — POST /mcp`);
});
