import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry } from "./registry.js";
export declare const TOOLS: Tool[];
/**
 * Execute a single MCP tool call and return the Global Response Envelope (`v2.6.0`).
 */
export declare function executeToolCall(registry: CourierRegistry, name: string, args?: Record<string, any>, tenantId?: string): Promise<{
    isError: boolean;
    envelope: any;
}>;
/**
 * Build a fully-wired MCP Server bound to a given CourierRegistry.
 * The registry carries the credentials — for STDIO it comes from env,
 * for HTTP it is built per-request from that client's keys.
 */
export declare function buildMcpServer(registry: CourierRegistry, authChecker?: (toolName: string, args?: Record<string, any>) => {
    permitted: boolean;
    reason?: string;
}, tenantId?: string): Server;
