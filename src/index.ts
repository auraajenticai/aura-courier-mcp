#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CourierRegistry } from "./registry.js";
import { buildMcpServer } from "./server.js";

// STDIO / npx entrypoint (Claude Desktop, Cursor, Antigravity).
// Credentials come from environment variables (STEADFAST_API_KEY, PATHAO_*).
async function run() {
  const server = buildMcpServer(new CourierRegistry());
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Aura Courier MCP v2.1 running on STDIO");
}

run().catch((error) => {
  console.error("Fatal error running Aura Courier MCP:", error);
  process.exit(1);
});
