#!/usr/bin/env node
/**
 * Aura Courier MCP — stdio entry point (local install / Claude Desktop / Claude Code).
 * For the hosted HTTP transport, see http.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCourierServer } from "./server.js";

async function main(): Promise<void> {
  const server = createCourierServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[aura-courier-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[aura-courier-mcp] fatal:", err);
  process.exit(1);
});
