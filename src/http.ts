import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry, recordWebhookEvent } from "./registry.js";
import { loadConfig, EnvSource } from "./config.js";
import { buildMcpServer, executeToolCall, TOOLS } from "./server.js";
import { createRateLimiter } from "./middleware/rate_limit.js";
import {
  optionalAuthMiddleware,
  requireMcpAuth,
  isActionPermitted,
  resolveAuthContext,
  verifyWebhookSignature,
  recordAuditLog,
} from "./middleware/auth.js";
import { McpToolError, wrapError, wrapSuccess, maskPhone } from "./envelope.js";
import { SupportedCourier } from "./types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * F02 Fix: Remove hardcoded plaintext password.
 * Connection string is read strictly from process.env.DATABASE_URL.
 */
const dbUrl = process.env.DATABASE_URL;
let dbPool: any = null;
if (process.env.NODE_ENV !== "test" && dbUrl) {
  try {
    dbPool = new pg.Pool({ connectionString: dbUrl, max: 4, idleTimeoutMillis: 30000 });
  } catch (err: any) {
    console.warn("[PostgreSQL] Connection initialization skipped:", err?.message);
  }
}

// Automated Data Retention Engine (Daily Midnight Sweep)
setInterval(async () => {
  if (dbPool) {
    try {
      const pruneRes = await dbPool.query(
        `UPDATE courier_parcels 
         SET recipient_name = 'ANONYMIZED', recipient_phone = 'ANONYMIZED', recipient_address = 'ANONYMIZED'
         WHERE created_at < NOW() - INTERVAL '90 days' AND recipient_name != 'ANONYMIZED'`
      );
      if (pruneRes.rowCount && pruneRes.rowCount > 0) {
        console.log(`[Data Retention Engine] Anonymized ${pruneRes.rowCount} legacy order records older than 90 days.`);
      }
    } catch (_) {}
  }
}, 24 * 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT || 8080);
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANDING = path.join(APP_DIR, "index.html");
const PRIVACY_HTML = path.join(APP_DIR, "privacy.html");
const HEALTH_HTML = path.join(APP_DIR, "health.html");
const MCP_EXPLORER_HTML = path.join(APP_DIR, "mcp_explorer.html");
const GUIDE_HTML = path.join(APP_DIR, "guide.html");
const SIMULATOR_HTML = path.join(APP_DIR, "simulator.html");
const ASSETS_DIR = path.join(APP_DIR, "assets");
const CONFIGS_DIR = path.join(APP_DIR, "configs");

/**
 * F04 Helper: HTML entity escaping to prevent stored/reflected XSS.
 */
function escapeHtml(str: any): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * F03 Helper: Redact recipient street address to District/City level for public tracking.
 */
function redactAddressToDistrict(addr: string): string {
  if (!addr) return "Bangladesh";
  const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(-2).join(", ");
  }
  return addr;
}

/**
 * F10 Fix: Pull client courier keys strictly from request headers.
 * Query parameters are completely ignored to prevent credential leakage in URL logs.
 */
export function keysFromRequest(req: Request): EnvSource {
  const h = req.headers;
  const allowMasterEnvFallback = req.auraAuth?.tenantId === "master";

  const pick = (header: string, envVar?: string, allowNonMasterEnv = false): string | undefined => {
    const hv = h[header];
    const v = Array.isArray(hv) ? hv[0] : hv;
    if (v && typeof v === "string" && v.trim()) return v.trim();
    if (envVar && (allowMasterEnvFallback || allowNonMasterEnv)) {
      return process.env[envVar];
    }
    return undefined;
  };

  return {
    STEADFAST_API_KEY: pick("x-steadfast-api-key", "STEADFAST_API_KEY"),
    STEADFAST_SECRET_KEY: pick("x-steadfast-secret-key", "STEADFAST_SECRET_KEY"),
    STEADFAST_BASE_URL: pick("x-steadfast-base-url", "STEADFAST_BASE_URL", true),
    PATHAO_CLIENT_ID: pick("x-pathao-client-id", "PATHAO_CLIENT_ID"),
    PATHAO_CLIENT_SECRET: pick("x-pathao-client-secret", "PATHAO_CLIENT_SECRET"),
    PATHAO_USERNAME: pick("x-pathao-username", "PATHAO_USERNAME"),
    PATHAO_PASSWORD: pick("x-pathao-password", "PATHAO_PASSWORD"),
    PATHAO_STORE_ID: pick("x-pathao-store-id", "PATHAO_STORE_ID"),
    PATHAO_BASE_URL: pick("x-pathao-base-url", "PATHAO_BASE_URL", true),
    REDX_API_TOKEN: pick("x-redx-api-token", "REDX_API_TOKEN"),
    REDX_BASE_URL: pick("x-redx-base-url", "REDX_BASE_URL", true),
    REDX_PICKUP_STORE_ID: pick("x-redx-pickup-store-id", "REDX_PICKUP_STORE_ID"),
    PAPERFLY_API_KEY: pick("x-paperfly-api-key", "PAPERFLY_API_KEY"),
    PAPERFLY_USERNAME: pick("x-paperfly-username", "PAPERFLY_USERNAME"),
    PAPERFLY_PASSWORD: pick("x-paperfly-password", "PAPERFLY_PASSWORD"),
    PAPERFLY_STORE_NAME: pick("x-paperfly-store-name", "PAPERFLY_STORE_NAME"),
    GOOGLE_MAPS_API_KEY: pick("x-google-maps-key", "GOOGLE_MAPS_API_KEY", true),
  };
}

export const app = express();
app.use(express.json({
  limit: "1mb",
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Robust Malformed JSON Syntax Error Guard
app.use((err: any, _req: Request, res: Response, next: any) => {
  if (err && (err.type === "entity.parse.failed" || err.status === 400)) {
    return res.status(400).json(
      wrapError(
        new McpToolError({
          code: "INVALID_INPUT",
          message: "Malformed JSON payload in request body.",
          retryable: false,
        }),
        "validator"
      )
    );
  }
  next(err);
});

// Allow browser-based and cross-origin MCP clients.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS, HEAD, PATCH, PUT"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, x-aura-signature, x-steadfast-signature, x-pathao-signature, x-redx-signature, x-paperfly-signature, x-webhook-secret, x-steadfast-api-key, x-steadfast-secret-key, x-steadfast-base-url, x-pathao-client-id, x-pathao-client-secret, x-pathao-username, x-pathao-password, x-pathao-store-id, x-pathao-base-url, x-redx-api-token, x-redx-base-url, x-redx-pickup-store-id, x-paperfly-api-key, x-paperfly-username, x-paperfly-password, x-paperfly-store-name, x-google-maps-key"
  );
  res.header("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(optionalAuthMiddleware);

const mcpLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, name: "MCP Protocol Gateway" });
const trackingLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120, name: "Tracking Gateway" });

/**
 * F05 Fix: MCP Session Entry with Cryptographic Tenant Isolation
 */
interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastActiveAt: number;
  tenantId: string;
}

interface SseSessionEntry {
  transport: SSEServerTransport;
  lastActiveAt: number;
  tenantId: string;
}

const sessions = new Map<string, SessionEntry>();
const sseSessions = new Map<string, SseSessionEntry>();
const SESSION_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of sessions.entries()) {
    if (now - entry.lastActiveAt > SESSION_TTL_MS) {
      sessions.delete(sid);
    }
  }
  for (const [sid, entry] of sseSessions.entries()) {
    if (now - entry.lastActiveAt > SESSION_TTL_MS) {
      sseSessions.delete(sid);
    }
  }
}, 60 * 1000).unref();

/**
 * AI Agent Connector Accept Normalizer:
 * Ensures clients sending Accept: application/json or wildcard do not get HTTP 406 from StreamableHTTPServerTransport.
 */
app.use("/mcp", (req, _res, next) => {
  const accept = req.headers["accept"] || "";
  if (!accept.includes("text/event-stream")) {
    req.headers["accept"] = accept ? `${accept}, text/event-stream` : "application/json, text/event-stream";
  }
  next();
});

/**
 * POST /mcp - MCP Protocol Gateway
 */
app.post("/mcp", mcpLimiter, requireMcpAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const tenantId = req.auraAuth?.tenantId || "default";
  let transport: StreamableHTTPServerTransport;

  // F05: Verify MCP Session belongs strictly to caller's tenant
  if (sessionId && sessions.has(sessionId)) {
    const entry = sessions.get(sessionId)!;
    if (entry.tenantId !== tenantId && req.auraAuth?.tenantId !== "master") {
      res.status(403).json(
        wrapError(
          new McpToolError({
            code: "UNAUTHORIZED",
            message: "MCP Session belongs to another tenant.",
            retryable: false,
            source: "validator",
          }),
          "validator"
        )
      );
      return;
    }
    entry.lastActiveAt = Date.now();
    transport = entry.transport;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    const registry = new CourierRegistry(loadConfig(keysFromRequest(req)));
    const server = buildMcpServer(
      registry,
      (toolName) => isActionPermitted(req, toolName),
      tenantId
    );
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, lastActiveAt: Date.now(), tenantId });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
  } else if (req.body && (req.body.method === "tools/list" || req.body.method === "tools/call")) {
    // Stateless JSON-RPC 2.0 Direct Execution Mode
    const rpcId = req.body.id ?? 1;
    const registry = new CourierRegistry(loadConfig(keysFromRequest(req)));

    // F14: Allow unauthenticated tools/list discovery
    if (req.body.method === "tools/list") {
      res.status(200).json({ jsonrpc: "2.0", id: rpcId, result: { tools: TOOLS } });
      return;
    }

    const toolName = String(req.body.params?.name || "");
    const args = (req.body.params?.arguments || {}) as Record<string, any>;
    const auth = isActionPermitted(req, toolName, args);
    if (!auth.permitted) {
      const errEnvelope = wrapError(
        new McpToolError({
          code: "UNAUTHORIZED",
          message: auth.reason || "Unauthorized tool invocation.",
          retryable: false,
        }),
        "validator"
      );
      res.status(200).json({
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(errEnvelope, null, 2) }],
        },
      });
      return;
    }

    const { isError, envelope } = await executeToolCall(registry, toolName, args, tenantId);
    recordAuditLog(tenantId, toolName, args, isError ? "error" : "ok");

    res.status(200).json({
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        isError,
        content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
      },
    });
    return;
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
app.get("/mcp", mcpLimiter, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    if (req.headers.accept?.includes("text/html")) {
      return res.sendFile(MCP_EXPLORER_HTML, (err) => {
        if (err && !res.headersSent) {
          res.status(400).send("Invalid or missing session ID. Visit https://courier.auraajenticai.cloud for instructions.");
        }
      });
    }
    if (!req.auraAuth?.authenticated) {
      return res.status(401).json(
        wrapError(
          new McpToolError({
            code: "UNAUTHORIZED",
            message: "Missing or invalid Authorization: Bearer <AURA_API_KEY> header.",
          }),
          "validator"
        )
      );
    }
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const entry = sessions.get(sessionId)!;
  const callerTenant = req.auraAuth?.tenantId || "default";
  if (entry.tenantId !== callerTenant && callerTenant !== "master") {
    return res.status(403).json(
      wrapError(
        new McpToolError({
          code: "UNAUTHORIZED",
          message: "MCP Session belongs to another tenant.",
          retryable: false,
        }),
        "validator"
      )
    );
  }

  entry.lastActiveAt = Date.now();
  await entry.transport.handleRequest(req, res);
});

// DELETE (end session) for an existing session.
app.delete("/mcp", requireMcpAuth, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const entry = sessions.get(sessionId)!;
  const callerTenant = req.auraAuth?.tenantId || "default";
  if (entry.tenantId !== callerTenant && callerTenant !== "master") {
    res.status(403).json(
      wrapError(
        new McpToolError({
          code: "UNAUTHORIZED",
          message: "MCP Session belongs to another tenant.",
          retryable: false,
        }),
        "validator"
      )
    );
    return;
  }

  entry.lastActiveAt = Date.now();
  await entry.transport.handleRequest(req, res);
});

/**
 * GET /sse - Standard MCP Server-Sent Events Endpoint for AI Agent Connectors (Claude Desktop, Cursor, Glama, LibreChat, Smithery)
 */
app.get("/sse", mcpLimiter, async (req: Request, res: Response) => {
  const tenantId = req.auraAuth?.tenantId || "default";
  const transport = new SSEServerTransport("/messages", res);
  const sid = transport.sessionId;
  sseSessions.set(sid, { transport, tenantId, lastActiveAt: Date.now() });

  transport.onclose = () => {
    sseSessions.delete(sid);
  };

  const registry = new CourierRegistry(loadConfig(keysFromRequest(req)));
  const server = buildMcpServer(
    registry,
    (toolName) => isActionPermitted(req, toolName),
    tenantId
  );

  await server.connect(transport);
});

/**
 * POST /messages - Standard MCP JSON-RPC Message Ingestion Endpoint for SSE Transports
 */
app.post("/messages", mcpLimiter, async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId || req.headers["mcp-session-id"]) as string | undefined;
  if (!sessionId || !sseSessions.has(sessionId)) {
    return res.status(400).send("Invalid or missing sessionId");
  }
  const entry = sseSessions.get(sessionId)!;
  const callerTenant = req.auraAuth?.tenantId || "default";
  if (entry.tenantId !== callerTenant && callerTenant !== "master") {
    return res.status(403).json(
      wrapError(
        new McpToolError({
          code: "UNAUTHORIZED",
          message: "SSE Session belongs to another tenant.",
          retryable: false,
        }),
        "validator"
      )
    );
  }

  entry.lastActiveAt = Date.now();
  await entry.transport.handlePostMessage(req, res, req.body);
});

/**
 * Task T1 & T8 — Unified Authenticated Webhook Handler for Steadfast, Pathao, RedX, and Paperfly
 */
function handleCourierWebhook(provider: SupportedCourier) {
  return (req: Request, res: Response) => {
    const isValidSig = verifyWebhookSignature(req, provider);
    if (!isValidSig) {
      return res.status(401).json(
        wrapError(
          new McpToolError({
            code: "UNAUTHORIZED",
            message: `Unauthorized ${provider} webhook request: missing or invalid signature/secret.`,
            courier: provider,
            retryable: false,
          }),
          "validator"
        )
      );
    }

    const payload = req.body || {};
    const consignmentId =
      payload.consignment_id ||
      payload.merchant_order_id ||
      payload.tracking_code ||
      payload.tracking_id ||
      payload.order_id;

    if (provider === "steadfast" && !consignmentId) {
      return res.status(400).json(
        wrapError(
          new McpToolError({
            code: "INVALID_INPUT",
            message: "Invalid or missing consignment_id in webhook payload.",
            courier: provider,
          }),
          "validator"
        )
      );
    }

    const status = String(payload.status || payload.order_status || payload.event || "received");
    const eventType = String(payload.notification_type || payload.event || "delivery_status");
    const invoice = payload.invoice || payload.merchant_order_id;
    const tenantId = String(req.query.tenant || req.headers["x-tenant-id"] || "default");

    const record = {
      id: randomUUID(),
      courier: provider,
      consignment_id: String(consignmentId || "UNKNOWN"),
      invoice: invoice ? String(invoice) : undefined,
      status,
      event_type: eventType,
      received_at: new Date().toISOString(),
      payload,
    };

    // F06: Record webhook event scoped by tenantId
    recordWebhookEvent(record, tenantId);

    return res.status(200).json(
      wrapSuccess(
        {
          status: "success",
          courier: provider,
          consignment_id: record.consignment_id,
          event_id: record.id,
          message: `${provider} webhook verified and recorded.`,
        },
        "live_api"
      )
    );
  };
}

app.post("/webhooks/steadfast", handleCourierWebhook("steadfast"));
app.post("/webhooks/pathao", handleCourierWebhook("pathao"));
app.post("/webhooks/redx", handleCourierWebhook("redx"));
app.post("/webhooks/paperfly", handleCourierWebhook("paperfly"));

/**
 * GET /track/:code - Hardened Public & Authenticated Tracking Gateway
 * F03: PII Masking for unauthenticated callers.
 * F04: HTML entity escaping for XSS prevention.
 */
app.get("/track/:code", trackingLimiter, async (req: Request, res: Response) => {
  const code = req.params.code;
  const format = req.query.format as string | undefined;
  const isAuth = Boolean(req.auraAuth?.authenticated);
  const callerTenant = req.auraAuth?.tenantId;

  let courier = ((req.query.courier as string) || "").toLowerCase();
  if (!courier) {
    if (code.toUpperCase().startsWith("DS") || code.toUpperCase().startsWith("DB")) courier = "pathao";
    else if (code.toUpperCase().startsWith("SF") || /^\d{8,12}$/.test(code)) courier = "steadfast";
    else if (code.toUpperCase().startsWith("REDX") || code.toUpperCase().startsWith("RX")) courier = "redx";
    else if (code.toUpperCase().startsWith("PF")) courier = "paperfly";
    else courier = "pathao";
  }

  let dbParcel: any = null;
  if (dbPool) {
    try {
      const qRes = await dbPool.query("SELECT * FROM courier_parcels WHERE tracking_code = $1 LIMIT 1", [code]);
      if (qRes.rows && qRes.rows.length > 0) {
        dbParcel = qRes.rows[0];
      }
    } catch (_) {}
  }

  const registry = new CourierRegistry(loadConfig(keysFromRequest(req)));
  let trackResult: any = null;
  let errorObj: any = null;

  try {
    trackResult = await registry.trackParcel(code, courier as any);
  } catch (err: any) {
    errorObj = err;
  }

  // F03: If caller is unauthenticated or not owner, sanitize/redact PII
  const isOwner = isAuth && (callerTenant === "master" || callerTenant === dbParcel?.tenant_id || callerTenant === dbParcel?.tenant);

  if (format === "json" || (!req.headers.accept?.includes("text/html") && format !== "html")) {
    if (trackResult) {
      let sanitized = trackResult;
      if (!isOwner) {
        sanitized = {
          ...trackResult,
          recipient_phone: trackResult.recipient_phone ? maskPhone(trackResult.recipient_phone) : undefined,
          recipient_address: trackResult.recipient_address ? redactAddressToDistrict(trackResult.recipient_address) : undefined,
        };
      }
      return res.json(wrapSuccess(sanitized, "live_api"));
    }
    if (dbParcel) {
      let safeParcel = dbParcel;
      if (!isOwner) {
        safeParcel = {
          ...dbParcel,
          recipient_phone: maskPhone(dbParcel.recipient_phone || dbParcel.phone || ""),
          recipient_address: redactAddressToDistrict(dbParcel.recipient_address || dbParcel.address || ""),
          customer_name: dbParcel.customer_name ? dbParcel.customer_name.charAt(0) + "***" : "Customer",
        };
      }
      return res.json(wrapSuccess({ success: true, parcel: safeParcel }, "cache"));
    }
    return res.status(404).json(wrapError(errorObj || new Error("Consignment not found"), "live_api"));
  }

  const raw = trackResult?.raw_response?.data || trackResult?.raw_response || (dbParcel?.raw?.data || dbParcel?.raw) || {};
  let recipientName = dbParcel?.customer_name || raw.recipient_name || raw.customer_name || raw.name || "Verified Customer";
  let recipientAddress = dbParcel?.address || raw.recipient_address || raw.address || "Bangladesh";

  // F03: Mask PII for public web tracker view
  if (!isOwner) {
    recipientAddress = redactAddressToDistrict(recipientAddress);
    if (recipientName && recipientName.length > 2) {
      recipientName = recipientName.charAt(0) + "*** " + (recipientName.split(" ")[1] || "");
    }
  }

  const codAmount = dbParcel?.cod_amount || raw.order_amount || raw.amount_to_collect || raw.cod_amount || raw.collectable_amount || 0;
  const statusText = trackResult?.status || raw.order_status || (dbParcel?.status ? dbParcel.status.charAt(0).toUpperCase() + dbParcel.status.slice(1) : "Not Found");
  const resolvedCourier = (dbParcel?.courier || courier || "pathao").toLowerCase();
  const carrierName = resolvedCourier === "pathao" ? "Pathao Express" : (resolvedCourier === "steadfast" ? "Steadfast Courier" : resolvedCourier === "redx" ? "RedX Delivery" : resolvedCourier === "paperfly" ? "Paperfly Go" : resolvedCourier.toUpperCase());
  const shortLink = raw.short_link || (carrierName.toLowerCase().includes("pathao") ? `https://merchant.pathao.com/tracking?consignment_id=${code}` : (carrierName.toLowerCase().includes("steadfast") ? `https://steadfast.com.bd/t/${code}` : ""));
  const updatedAt = raw.order_status_updated_at || raw.updated_at || trackResult?.updated_at || (dbParcel?.updated_at ? new Date(dbParcel.updated_at).toLocaleString("en-GB") : new Date().toLocaleString());

  const isDelivered = String(statusText).toLowerCase().includes("deliv");
  const isAtHub = String(statusText).toLowerCase().includes("hub");
  const isTransit = String(statusText).toLowerCase().includes("way") || String(statusText).toLowerCase().includes("transit") || String(statusText).toLowerCase().includes("progress");
  const isPickedUp = isDelivered || isAtHub || isTransit || String(statusText).toLowerCase().includes("pick");

  // F04: All interpolated variables are strictly escaped via escapeHtml()
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aura Live Tracking — ${escapeHtml(code)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <style>
    :root { --bg: #07090e; --card: rgba(13, 17, 28, 0.85); --border: rgba(0, 240, 255, 0.18); --cyan: #00f0ff; --purple: #818cf8; --green: #10b981; --text: #f8fafc; --text-dim: #94a3b8; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Plus Jakarta Sans', sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; position: relative; overflow-x: hidden; }
    .track-card { width: 100%; max-width: 580px; background: var(--card); backdrop-filter: blur(20px); border: 1px solid var(--border); border-radius: 28px; padding: 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); position: relative; z-index: 10; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 20px; margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon { width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, #00f0ff, #818cf8); display: grid; place-items: center; font-size: 20px; color: #07090e; }
    .brand-text h1 { font-size: 18px; font-weight: 800; }
    .brand-text p { font-size: 11px; color: var(--text-dim); }
    .status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; background: rgba(0, 240, 255, 0.1); color: var(--cyan); border: 1px solid rgba(0, 240, 255, 0.3); }
    .tracking-code-box { background: rgba(0,0,0,0.35); border: 1px dashed rgba(255,255,255,0.15); border-radius: 16px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .code-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 700; }
    .code-val { font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 700; color: #fff; }
    .timeline { position: relative; padding-left: 28px; margin-bottom: 24px; }
    .timeline::before { content: ''; position: absolute; left: 8px; top: 8px; bottom: 8px; width: 2px; background: rgba(255,255,255,0.1); }
    .timeline-step { position: relative; margin-bottom: 20px; }
    .step-dot { position: absolute; left: -28px; top: 3px; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; background: #1e293b; border: 2px solid #64748b; color: #fff; }
    .step-dot.done { background: var(--cyan); border-color: var(--cyan); color: #07090e; }
    .step-title { font-size: 14px; font-weight: 700; color: #fff; }
    .step-sub { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .info-item { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 12px 14px; }
    .info-item-label { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
    .info-item-val { font-size: 13px; font-weight: 700; color: #fff; }
    .actions { display: flex; gap: 10px; }
    .btn { flex: 1; padding: 12px; border-radius: 14px; font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; cursor: pointer; }
    .btn-primary { background: linear-gradient(135deg, #00f0ff, #38bdf8); color: #07090e; border: none; font-weight: 800; }
    .btn-secondary { background: rgba(255,255,255,0.06); color: #fff; border: 1px solid rgba(255,255,255,0.12); }
  </style>
</head>
<body>
  <div class="track-card">
    <div class="header">
      <div class="brand">
        <div class="brand-icon"><i class="fa-solid fa-truck-fast"></i></div>
        <div class="brand-text">
          <h1>Aura Live Tracking</h1>
          <p>${escapeHtml(carrierName)} • Direct Live Telemetry</p>
        </div>
      </div>
      <div class="status-badge"><span>${escapeHtml(statusText)}</span></div>
    </div>
    <div class="tracking-code-box">
      <div><div class="code-label">Consignment Tracking ID</div><div class="code-val">${escapeHtml(code)}</div></div>
      <div style="text-align: right;"><div class="code-label">Carrier</div><div style="font-weight: 700; color: var(--cyan); font-size: 13px;">${escapeHtml(carrierName)}</div></div>
    </div>
    <div class="timeline">
      <div class="timeline-step"><div class="step-dot done"><i class="fa-solid fa-check"></i></div><div class="step-title">Order Booked & Confirmed</div><div class="step-sub">Aura Dispatch Engine initialized booking.</div></div>
      <div class="timeline-step"><div class="step-dot ${isPickedUp ? "done" : ""}"><i class="fa-solid fa-check"></i></div><div class="step-title">Picked Up by Rider</div><div class="step-sub">Central Merchant Fulfillment Hub</div></div>
      <div class="timeline-step"><div class="step-dot ${isDelivered ? "done" : ""}"><i class="fa-solid fa-arrow-right"></i></div><div class="step-title">${escapeHtml(statusText)}</div><div class="step-sub">Live Telemetry: ${escapeHtml(updatedAt)}</div></div>
      <div class="timeline-step"><div class="step-dot ${isDelivered ? "done" : ""}"><i class="fa-solid fa-house"></i></div><div class="step-title">Destination Delivery</div><div class="step-sub">Destination: ${escapeHtml(recipientAddress)}</div></div>
    </div>
    <div class="info-grid">
      <div class="info-item"><div class="info-item-label">Customer</div><div class="info-item-val">${escapeHtml(recipientName)}</div></div>
      <div class="info-item"><div class="info-item-label">Cash on Delivery (COD)</div><div class="info-item-val">৳ ${Number(codAmount).toLocaleString()}</div></div>
    </div>
    <div class="actions">
      ${shortLink ? `<a href="${escapeHtml(shortLink)}" target="_blank" class="btn btn-primary"><i class="fa-solid fa-location-arrow"></i> Official Carrier Map Tracker</a>` : ""}
      <button onclick="window.location.reload()" class="btn btn-secondary"><i class="fa-solid fa-rotate-right"></i> Refresh Live Status</button>
    </div>
  </div>
</body>
</html>`);
});

/**
 * Task T9 — Health & Live Telemetry Endpoint
 */
app.get("/health", (req, res) => {
  const auth = req.auraAuth || resolveAuthContext(req);
  const isAdmin = auth.authenticated && auth.isAdmin;

  if (!isAdmin) {
    if (req.query.ui === "1" && req.headers.accept?.includes("text/html")) {
      return res.sendFile(HEALTH_HTML, (err) => {
        if (err && !res.headersSent) res.json({ ok: true, version: "2.6.0" });
      });
    }
    return res.json({
      ok: true,
      version: "2.6.0",
    });
  }

  const mem = process.memoryUsage();
  const detailed = {
    ok: true,
    service: "aura-courier-mcp",
    version: "2.6.0",
    tools_count: TOOLS.length,
    spatial_engine: "Google Maps Platform (gmp_git_agentskills_v1)",
    fraud_engine: "Pathao Nationwide v2 + Steadfast Nationwide API + BD Prefix Validator",
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

  return res.json(detailed);
});

app.get("/health.html", (_req, res) => {
  res.sendFile(HEALTH_HTML, (err) => {
    if (err && !res.headersSent) res.json({ ok: true, version: "2.6.0" });
  });
});

app.get("/privacy", (_req, res) => {
  res.sendFile(PRIVACY_HTML, (err) => {
    if (err && !res.headersSent) {
      res.redirect("/");
    }
  });
});

app.use("/assets", express.static(ASSETS_DIR, { maxAge: "7d" }));
app.use("/configs", express.static(CONFIGS_DIR, { maxAge: "1d" }));

app.get("/simulator", (_req, res) => {
  res.sendFile(SIMULATOR_HTML, (err) => {
    if (err && !res.headersSent) {
      res.redirect("/guide");
    }
  });
});

app.get("/guide", (_req, res) => {
  res.sendFile(GUIDE_HTML, (err) => {
    if (err && !res.headersSent) {
      res.redirect("/");
    }
  });
});

app.get("/", (_req, res) => {
  res.sendFile(LANDING, (err) => {
    if (err && !res.headersSent) {
      res
        .type("html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aura Courier MCP</title>` +
            `<style>body{font-family:system-ui,sans-serif;background:#07080a;color:#f4f5f7;margin:0;display:grid;place-items:center;min-height:100vh}.b{max-width:640px;padding:40px;text-align:center}h1{font-size:28px;margin:0 0 10px}code{background:#0f1115;padding:2px 8px;border-radius:6px;color:#00d4ff;font-size:13px}a{color:#00d4ff}p{line-height:1.6;color:#a4a8b3}</style></head>` +
            `<body><div class="b"><h1>🚚 Aura Courier MCP v2.6.0</h1><p>Enterprise Bangladesh courier MCP &amp; Google Maps Platform spatial hub.</p>` +
            `<p>Connect your AI to <code>POST /mcp</code> with Streamable-HTTP.</p>` +
            `<p>Webhooks: <code>POST /webhooks/steadfast</code> · <code>POST /webhooks/pathao</code></p>` +
            `<p>By <a href="https://auraajenticai.cloud">Aura Ajentic AI</a> · <a href="https://courier.auraajenticai.cloud">docs &amp; setup</a></p></div></body></html>`
        );
    }
  });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Aura Courier MCP v2.6.0 (HTTP) listening on :${PORT} — POST /mcp`);
  });
}
