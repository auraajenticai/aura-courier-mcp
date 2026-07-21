#!/usr/bin/env node
/**
 * Aura Courier MCP — hosted HTTP transport (Streamable HTTP, stateless).
 *
 * Lets any MCP client (Claude connectors) connect over a URL instead of a local
 * process: POST /mcp with the standard MCP JSON-RPC. Runs the SAME server + tools
 * as the stdio build.
 *
 * Env: PORT (default 8080). Courier credentials via the usual env (see config.ts).
 */
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCourierServer } from "./server.js";
import { loadConfig, type AppConfig } from "./config.js";

/**
 * Per-client credentials. Each merchant connects with THEIR own courier keys,
 * passed in the connector URL query (Claude's connector UI is URL-only) or as
 * headers. Falls back to server env if none supplied. Nothing is stored — the
 * keys live only in the client's own connector config and travel over HTTPS.
 */
function configFromRequest(req: express.Request): AppConfig {
  const q = req.query as Record<string, string | undefined>;
  const h = req.headers as Record<string, string | string[] | undefined>;
  const pick = (...names: string[]): string | undefined => {
    for (const n of names) {
      const fromQ = q[n];
      if (fromQ) return String(fromQ);
      const fromH = h[n.toLowerCase()];
      if (fromH) return Array.isArray(fromH) ? fromH[0] : String(fromH);
    }
    return undefined;
  };
  const env = loadConfig();
  const storeId = pick("pathao_store_id", "x-pathao-store-id");
  return {
    steadfast: {
      apiKey: pick("steadfast_key", "x-steadfast-key") ?? env.steadfast.apiKey,
      secretKey: pick("steadfast_secret", "x-steadfast-secret") ?? env.steadfast.secretKey,
    },
    pathao: {
      clientId: pick("pathao_client_id", "x-pathao-client-id") ?? env.pathao.clientId,
      clientSecret: pick("pathao_client_secret", "x-pathao-client-secret") ?? env.pathao.clientSecret,
      username: pick("pathao_username", "x-pathao-username") ?? env.pathao.username,
      password: pick("pathao_password", "x-pathao-password") ?? env.pathao.password,
      sandbox: (pick("pathao_sandbox") ?? String(env.pathao.sandbox)) === "true",
      defaultStoreId: storeId ? Number(storeId) : env.pathao.defaultStoreId,
    },
  };
}

const PORT = Number(process.env.PORT || 8080);
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aura-courier-mcp", transport: "streamable-http" });
});

// Stateless: a fresh server + transport per request (no session state kept server-side).
app.post("/mcp", async (req, res) => {
  try {
    const server = createCourierServer(configFromRequest(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[aura-courier-mcp:http] error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode has no server-initiated stream / session teardown.
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless server)." },
    id: null,
  });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.error(`[aura-courier-mcp] HTTP MCP listening on :${PORT}/mcp`);
});
