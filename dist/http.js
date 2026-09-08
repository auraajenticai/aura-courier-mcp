import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry } from "./registry.js";
import { loadConfig } from "./config.js";
import { buildMcpServer } from "./server.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
const PORT = Number(process.env.PORT || 8080);
// Marketing landing (index.html) sits at the repo root, one level above dist/.
const LANDING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");
// Pull this client's courier keys from request headers or query params.
// Captured once per session (on the initialize request) and bound to that session's server.
function keysFromRequest(req) {
    const h = req.headers;
    const q = req.query;
    const pick = (header, query) => {
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
        PAPERFLY_API_KEY: pick("x-paperfly-api-key", "paperfly_key"),
        PAPERFLY_USERNAME: pick("x-paperfly-username", "paperfly_username"),
        PAPERFLY_PASSWORD: pick("x-paperfly-password", "paperfly_password"),
        PAPERFLY_STORE_NAME: pick("x-paperfly-store-name", "paperfly_store"),
    };
}
const app = express();
app.use(express.json({ limit: "1mb" }));
// Allow browser-based and cross-origin MCP clients.
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, x-steadfast-api-key, x-steadfast-secret-key, x-steadfast-base-url, x-pathao-client-id, x-pathao-client-secret, x-pathao-username, x-pathao-password, x-pathao-store-id, x-pathao-base-url, x-redx-api-token, x-redx-base-url, x-redx-pickup-store-id, x-paperfly-api-key, x-paperfly-username, x-paperfly-password, x-paperfly-store-name");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Expose-Headers", "mcp-session-id");
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});
// Active sessions: sessionId -> transport (each bound to one client's keys).
const transports = {};
app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport;
    if (sessionId && transports[sessionId]) {
        // Existing session — reuse its server (already holds this client's keys).
        transport = transports[sessionId];
    }
    else if (!sessionId && isInitializeRequest(req.body)) {
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
            if (transport.sessionId)
                delete transports[transport.sessionId];
        };
        await server.connect(transport);
    }
    else {
        res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: missing or invalid session. Send an initialize request first." },
            id: null,
        });
        return;
    }
    try {
        await transport.handleRequest(req, res, req.body);
    }
    catch (err) {
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
async function handleSessionRequest(req, res) {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
    }
    await transports[sessionId].handleRequest(req, res);
}
app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);
app.get("/health", (_req, res) => res.json({ ok: true, service: "aura-courier-mcp", version: "2.3.2", sessions: Object.keys(transports).length }));
const PRIVACY_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aura Courier MCP — Privacy Policy</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:820px;margin:0 auto;padding:40px 20px;line-height:1.7;color:#1a2233;background:#fff}h1{font-size:26px}h2{font-size:18px;margin-top:28px}code{background:#f0f3f9;padding:1px 6px;border-radius:5px}a{color:#2563eb}.muted{color:#667}</style></head><body>
<h1>Aura Courier MCP — Privacy Policy</h1>
<p class="muted">Last updated: 8 September 2026 · Operated by Aura Ajentic AI (auraajenticai.cloud)</p>
<p>Aura Courier MCP is a Model Context Protocol server that lets an AI agent book and track parcels with Bangladeshi couriers (Steadfast, Pathao, RedX, Paperfly) and screen cash-on-delivery fraud risk. This policy explains what data it handles and how.</p>
<h2>1. What we process</h2>
<ul>
<li><b>Your courier credentials</b> (API keys/secrets, merchant username/password) — supplied by you per request as HTTP headers or environment variables.</li>
<li><b>Order details</b> you pass to book or track a parcel — recipient name, phone, address, COD amount, item info.</li>
<li><b>Phone numbers</b> submitted to <code>check_fraud_risk</code> to compute a delivery/return-risk score.</li>
</ul>
<h2>2. How we use it</h2>
<p>Solely to carry out the operation you request — forwarding the booking/tracking/balance call to the specific courier you select, or computing a risk score. We do not use your data for advertising or profiling.</p>
<h2>3. Storage &amp; retention</h2>
<p>Your courier credentials are used only for the duration of the request and are <b>never persisted</b> by Aura. Requests are processed transiently; Aura does not build a long-term store of your merchant keys. Data you send is retained only as long as needed to complete the request.</p>
<h2>4. Third-party sharing</h2>
<p>To fulfil your request, order data is transmitted to the courier provider you choose (Steadfast, Pathao, RedX or Paperfly), each governed by its own privacy terms. We do not sell your data or share it with anyone else.</p>
<h2>5. Security</h2>
<p>All traffic is over HTTPS. Credentials travel as request headers and are held only in memory for the active session.</p>
<h2>6. Your choices</h2>
<p>You control which couriers you connect and which credentials you provide. Disconnecting the connector stops all processing.</p>
<h2>7. Contact</h2>
<p>Questions or requests: <a href="mailto:ceo@auraajenticai.cloud">ceo@auraajenticai.cloud</a> · <a href="https://auraajenticai.cloud">auraajenticai.cloud</a></p>
</body></html>`;
app.get("/privacy", (_req, res) => res.type("html").send(PRIVACY_HTML));
app.get("/", (_req, res) => {
    // Serve the marketing landing page; fall back to a minimal page if it's missing.
    res.sendFile(LANDING, (err) => {
        if (err && !res.headersSent) {
            res
                .type("html")
                .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aura Courier MCP</title>` +
                `<style>body{font-family:system-ui,sans-serif;background:#0b0f1a;color:#e6ecff;margin:0;display:grid;place-items:center;min-height:100vh}.b{max-width:640px;padding:40px;text-align:center}h1{font-size:28px;margin:0 0 10px}code{background:#141c30;padding:2px 8px;border-radius:6px;color:#7dd3fc;font-size:13px}a{color:#7dd3fc}p{line-height:1.6;color:#9fb0d0}</style></head>` +
                `<body><div class="b"><h1>🚚 Aura Courier MCP</h1><p>Live remote MCP endpoint for Bangladesh couriers — Steadfast &amp; Pathao.</p>` +
                `<p>Connect your AI to <code>POST /mcp</code> and pass your courier keys as headers (<code>x-steadfast-api-key</code>, <code>x-steadfast-secret-key</code>) or query params (<code>?steadfast_key=…&amp;steadfast_secret=…</code>).</p>` +
                `<p>By <a href="https://auraajenticai.cloud">Aura Ajentic AI</a> · <a href="https://courier.auraajenticai.cloud">docs &amp; setup</a></p></div></body></html>`);
        }
    });
});
app.listen(PORT, () => {
    console.log(`Aura Courier MCP (HTTP) listening on :${PORT} — POST /mcp`);
});
