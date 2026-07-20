#!/usr/bin/env node
/**
 * Aura Courier MCP — server entry point (stdio transport).
 *
 * One Model Context Protocol connector for every Bangladesh courier.
 * Steadfast ships first; Pathao / RedX / Paperfly slot in as adapters.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { CourierRegistry } from "./adapters/registry.js";
import { registerTools } from "./tools/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const registry = new CourierRegistry(config);

  const server = new McpServer({
    name: "aura-courier-mcp",
    version: "0.1.0",
  });

  registerTools(server, registry);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is reserved for the MCP protocol.
  console.error("[aura-courier-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[aura-courier-mcp] fatal:", err);
  process.exit(1);
});
