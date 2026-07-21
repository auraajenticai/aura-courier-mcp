/**
 * Server factory — builds the MCP server with all couriers + tools registered.
 * Shared by both transports: stdio (index.ts) and streamable HTTP (http.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, type AppConfig } from "./config.js";
import { CourierRegistry } from "./adapters/registry.js";
import { registerTools } from "./tools/index.js";

export function createCourierServer(config: AppConfig = loadConfig()): McpServer {
  const registry = new CourierRegistry(config);
  const server = new McpServer({ name: "aura-courier-mcp", version: "0.1.0" });
  registerTools(server, registry);
  return server;
}
