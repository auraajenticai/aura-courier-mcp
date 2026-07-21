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

const PORT = Number(process.env.PORT || 8080);
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aura-courier-mcp", transport: "streamable-http" });
});

// Stateless: a fresh server + transport per request (no session state kept server-side).
app.post("/mcp", async (req, res) => {
  try {
    const server = createCourierServer();
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
