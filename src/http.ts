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
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANDING = path.join(APP_DIR, "index.html");
const HEALTH_HTML = path.join(APP_DIR, "health.html");
const MCP_EXPLORER_HTML = path.join(APP_DIR, "mcp_explorer.html");

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
      // Return application/json for POST responses instead of SSE — far more compatible with
      // MCP clients/registries (e.g. Glama's connector test) that don't consume the event stream.
      enableJsonResponse: true,
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

// GET (server->client SSE stream or Browser Explorer)
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    // If opened directly by a human in a web browser, serve the interactive MCP Protocol Explorer!
    if (req.headers.accept?.includes("text/html")) {
      return res.sendFile(MCP_EXPLORER_HTML, (err) => {
        if (err && !res.headersSent) {
          res.status(400).send("Invalid or missing session ID. Visit https://courier.auraajenticai.cloud for instructions.");
        }
      });
    }
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const entry = sessions.get(sessionId)!;
  entry.lastActiveAt = Date.now();
  await entry.transport.handleRequest(req, res);
});

// DELETE (end session) for an existing session.
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const entry = sessions.get(sessionId)!;
  entry.lastActiveAt = Date.now();
  await entry.transport.handleRequest(req, res);
});

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
  const status = payload.status;
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

/**
 * Live Consumer & Merchant Cyber-Dark Tracking Hub
 * GET /track/:code
 */
app.get("/track/:code", async (req: Request, res: Response) => {
  const code = req.params.code;
  const format = req.query.format as string | undefined;

  let courier = (req.query.courier as string) || "";
  if (!courier) {
    if (code.toUpperCase().startsWith("DS") || code.toUpperCase().startsWith("DB")) courier = "pathao";
    else if (code.toUpperCase().startsWith("SF") || /^\d{8,12}$/.test(code)) courier = "steadfast";
    else if (code.toUpperCase().startsWith("REDX") || code.toUpperCase().startsWith("RX")) courier = "redx";
    else if (code.toUpperCase().startsWith("PF")) courier = "paperfly";
    else courier = "pathao";
  }

  const registry = new CourierRegistry(loadConfig(keysFromRequest(req)));
  let trackResult: any = null;
  let errorMsg: string | null = null;

  try {
    trackResult = await registry.trackParcel(code, courier as any);
  } catch (err: any) {
    errorMsg = err?.message || String(err);
  }

  if (format === "json" || (!req.headers.accept?.includes("text/html") && format !== "html")) {
    return res.json(trackResult || { success: false, tracking_code: code, error: errorMsg });
  }

  const statusText = trackResult?.status || (trackResult?.raw_response?.data?.order_status) || "In Transit";
  const raw = trackResult?.raw_response?.data || trackResult?.raw_response || {};
  const recipientName = raw.recipient_name || raw.customer_name || raw.name || "Verified Customer";
  const recipientAddress = raw.recipient_address || raw.address || "Bangladesh";
  const codAmount = raw.order_amount || raw.amount_to_collect || raw.cod_amount || raw.collectable_amount || 0;
  const carrierName = courier === "pathao" ? "Pathao Express" : (courier === "steadfast" ? "Steadfast Courier" : courier === "redx" ? "RedX Delivery" : courier === "paperfly" ? "Paperfly Go" : courier.toUpperCase());
  const shortLink = raw.short_link || (courier === "pathao" ? `https://merchant.pathao.com/tracking?consignment_id=${code}` : (courier === "steadfast" ? `https://steadfast.com.bd/t/${code}` : ""));
  const updatedAt = raw.order_status_updated_at || trackResult?.updated_at || new Date().toLocaleString();

  const isDelivered = statusText.toLowerCase().includes("deliv");
  const isPickedUp = isDelivered || statusText.toLowerCase().includes("transit") || statusText.toLowerCase().includes("hub") || statusText.toLowerCase().includes("way") || statusText.toLowerCase().includes("pick");

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aura Live Tracking — ${code}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <style>
    :root {
      --bg: #07090e;
      --card: rgba(13, 17, 28, 0.85);
      --border: rgba(0, 240, 255, 0.18);
      --cyan: #00f0ff;
      --purple: #818cf8;
      --green: #10b981;
      --text: #f8fafc;
      --text-dim: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      overflow-x: hidden;
    }
    .orb-1 { position: absolute; top: -100px; left: -100px; width: 400px; height: 400px; background: rgba(0, 240, 255, 0.15); filter: blur(100px); border-radius: 50%; pointer-events: none; }
    .orb-2 { position: absolute; bottom: -100px; right: -100px; width: 400px; height: 400px; background: rgba(129, 140, 248, 0.15); filter: blur(100px); border-radius: 50%; pointer-events: none; }
    .track-card {
      width: 100%;
      max-width: 580px;
      background: var(--card);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 28px;
      padding: 32px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5), 0 0 40px rgba(0, 240, 255, 0.08);
      position: relative;
      z-index: 10;
    }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 20px; margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon { width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, #00f0ff, #818cf8); display: grid; place-items: center; font-size: 20px; color: #07090e; }
    .brand-text h1 { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
    .brand-text p { font-size: 11px; color: var(--text-dim); }
    .status-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 20px;
      font-size: 12px; font-weight: 700; background: rgba(0, 240, 255, 0.1); color: var(--cyan); border: 1px solid rgba(0, 240, 255, 0.3);
    }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 10px var(--cyan); animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.3); } }
    .tracking-code-box {
      background: rgba(0,0,0,0.35); border: 1px dashed rgba(255,255,255,0.15); border-radius: 16px; padding: 14px 18px;
      display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;
    }
    .code-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700; }
    .code-val { font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 700; color: #fff; letter-spacing: 0.5px; }
    .timeline { position: relative; padding-left: 28px; margin-bottom: 24px; }
    .timeline::before { content: ''; position: absolute; left: 8px; top: 8px; bottom: 8px; width: 2px; background: rgba(255,255,255,0.1); }
    .timeline-step { position: relative; margin-bottom: 20px; }
    .timeline-step:last-child { margin-bottom: 0; }
    .step-dot { position: absolute; left: -28px; top: 3px; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; background: #1e293b; border: 2px solid #64748b; color: #fff; }
    .step-dot.done { background: var(--cyan); border-color: var(--cyan); color: #07090e; box-shadow: 0 0 12px rgba(0, 240, 255, 0.4); }
    .step-dot.active { background: var(--purple); border-color: var(--cyan); color: #fff; animation: pulse 2s infinite; }
    .step-title { font-size: 14px; font-weight: 700; color: #fff; }
    .step-sub { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .info-item { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 12px 14px; }
    .info-item-label { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
    .info-item-val { font-size: 13px; font-weight: 700; color: #fff; }
    .actions { display: flex; gap: 10px; }
    .btn { flex: 1; padding: 12px; border-radius: 14px; font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; cursor: pointer; transition: all 0.2s; }
    .btn-primary { background: linear-gradient(135deg, #00f0ff, #38bdf8); color: #07090e; border: none; font-weight: 800; box-shadow: 0 4px 20px rgba(0, 240, 255, 0.3); }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 25px rgba(0, 240, 255, 0.4); }
    .btn-secondary { background: rgba(255,255,255,0.06); color: #fff; border: 1px solid rgba(255,255,255,0.12); }
    .btn-secondary:hover { background: rgba(255,255,255,0.1); }
  </style>
</head>
<body>
  <div class="orb-1"></div>
  <div class="orb-2"></div>
  <div class="track-card">
    <div class="header">
      <div class="brand">
        <div class="brand-icon"><i class="fa-solid fa-truck-fast"></i></div>
        <div class="brand-text">
          <h1>Aura Live Tracking</h1>
          <p>${carrierName} • Direct Live Telemetry</p>
        </div>
      </div>
      <div class="status-badge">
        <div class="pulse-dot"></div>
        <span>${statusText}</span>
      </div>
    </div>

    <div class="tracking-code-box">
      <div>
        <div class="code-label">Consignment Tracking ID</div>
        <div class="code-val">${code}</div>
      </div>
      <div style="text-align: right;">
        <div class="code-label">Carrier</div>
        <div style="font-weight: 700; color: var(--cyan); font-size: 13px;">${carrierName}</div>
      </div>
    </div>

    <div class="timeline">
      <div class="timeline-step">
        <div class="step-dot done"><i class="fa-solid fa-check"></i></div>
        <div class="step-title">Order Booked & Confirmed</div>
        <div class="step-sub">Aura Dispatch Engine initialized booking.</div>
      </div>
      <div class="timeline-step">
        <div class="step-dot ${isPickedUp ? 'done' : 'active'}"><i class="fa-solid fa-check"></i></div>
        <div class="step-title">Picked Up by Rider</div>
        <div class="step-sub">Central Merchant Fulfillment Hub</div>
      </div>
      <div class="timeline-step">
        <div class="step-dot ${isDelivered ? 'done' : 'active'}"><i class="fa-solid fa-arrow-right"></i></div>
        <div class="step-title">${statusText}</div>
        <div class="step-sub">Live Telemetry: ${updatedAt}</div>
      </div>
      <div class="timeline-step">
        <div class="step-dot ${isDelivered ? 'done' : ''}"><i class="fa-solid fa-house"></i></div>
        <div class="step-title">Destination Delivery</div>
        <div class="step-sub">Destination: ${recipientAddress}</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item">
        <div class="info-item-label">Customer</div>
        <div class="info-item-val">${recipientName}</div>
      </div>
      <div class="info-item">
        <div class="info-item-label">Cash on Delivery (COD)</div>
        <div class="info-item-val">৳ ${Number(codAmount).toLocaleString()}</div>
      </div>
    </div>

    <div class="actions">
      ${shortLink ? `<a href="${shortLink}" target="_blank" class="btn btn-primary"><i class="fa-solid fa-location-arrow"></i> Official Carrier Map Tracker</a>` : ''}
      <button onclick="window.location.reload()" class="btn btn-secondary"><i class="fa-solid fa-rotate-right"></i> Refresh Live Status</button>
    </div>
  </div>
</body>
</html>`);
});

/**
 * Health & Live Telemetry Endpoint
 * Serves visual SaaS Dashboard for browsers, and JSON for API monitors & Docker probes.
 */
app.get("/health", (req, res) => {
  const mem = process.memoryUsage();
  const data = {
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
  };

  // If a browser is viewing /health and hasn't explicitly asked for format=json, serve the visual dashboard!
  if (req.headers.accept?.includes("text/html") && req.query.format !== "json") {
    return res.sendFile(HEALTH_HTML, (err) => {
      if (err && !res.headersSent) res.json(data);
    });
  }

  // Otherwise return JSON for curl, metrics monitors, and Docker health checks
  res.json(data);
});

app.get("/", (_req, res) => {
  res.sendFile(LANDING, (err) => {
    if (err && !res.headersSent) {
      res
        .type("html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aura Courier MCP</title>` +
            `<style>body{font-family:system-ui,sans-serif;background:#07080a;color:#f4f5f7;margin:0;display:grid;place-items:center;min-height:100vh}.b{max-width:640px;padding:40px;text-align:center}h1{font-size:28px;margin:0 0 10px}code{background:#0f1115;padding:2px 8px;border-radius:6px;color:#00d4ff;font-size:13px}a{color:#00d4ff}p{line-height:1.6;color:#a4a8b3}</style></head>` +
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
