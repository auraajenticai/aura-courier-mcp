import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry } from "./registry.js";
export declare const TOOLS: Tool[];
/**
 * Build a fully-wired MCP Server bound to a given CourierRegistry.
 * The registry carries the credentials — for STDIO it comes from env,
 * for HTTP it is built per-request from that client's keys.
 */
export declare function buildMcpServer(registry: CourierRegistry): Server;
