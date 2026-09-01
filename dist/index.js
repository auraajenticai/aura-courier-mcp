#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry } from "./registry.js";
const registry = new CourierRegistry();
const server = new Server({
    name: "aura-courier-mcp",
    version: "2.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Define Tools supporting all 4 major Bangladeshi Couriers
const TOOLS = [
    {
        name: "list_couriers",
        description: "Show supported Bangladeshi couriers (Steadfast, Pathao, RedX, Paperfly) and check active credentials.",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "create_parcel",
        description: "Book a new parcel delivery across Bangladesh (Steadfast, Pathao, RedX, or Paperfly) with normalized response.",
        inputSchema: {
            type: "object",
            properties: {
                courier: {
                    type: "string",
                    enum: ["steadfast", "pathao", "redx", "paperfly", "auto"],
                    description: "Target courier or 'auto' for AI smart routing (default: auto)",
                },
                invoice: { type: "string", description: "Unique order invoice number (e.g. INV-1002)" },
                recipient_name: { type: "string", description: "Customer full name" },
                recipient_phone: { type: "string", description: "11-digit Bangladeshi mobile number (e.g. 017XXXXXXXX)" },
                recipient_address: { type: "string", description: "Delivery address (Thana, District, Street)" },
                cod_amount: { type: "number", description: "Cash on delivery amount in BDT (0 if prepaid)" },
                note: { type: "string", description: "Special instructions for delivery rider" },
                item_weight: { type: "number", description: "Parcel weight in KG (default: 0.5)" },
            },
            required: ["invoice", "recipient_name", "recipient_phone", "recipient_address", "cod_amount"],
        },
    },
    {
        name: "track_parcel",
        description: "Track shipment delivery status across Steadfast, Pathao, RedX, or Paperfly using Tracking Code / Consignment ID.",
        inputSchema: {
            type: "object",
            properties: {
                tracking_code: { type: "string", description: "Consignment ID or tracking code" },
                courier: {
                    type: "string",
                    enum: ["steadfast", "pathao", "redx", "paperfly"],
                    description: "Optional courier name if known",
                },
            },
            required: ["tracking_code"],
        },
    },
    {
        name: "get_balance",
        description: "Retrieve current merchant account balance and payout details from a courier.",
        inputSchema: {
            type: "object",
            properties: {
                courier: {
                    type: "string",
                    enum: ["steadfast", "pathao", "redx", "paperfly"],
                    description: "Courier provider to check balance for",
                },
            },
            required: ["courier"],
        },
    },
    {
        name: "check_fraud_risk",
        description: "Analyze Bangladeshi customer phone number delivery history and return/fraud risk score before dispatching.",
        inputSchema: {
            type: "object",
            properties: {
                phone: { type: "string", description: "11-digit Bangladeshi phone number to evaluate" },
            },
            required: ["phone"],
        },
    },
];
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "list_couriers": {
                const couriers = registry.listCouriers();
                return {
                    content: [{ type: "text", text: JSON.stringify(couriers, null, 2) }],
                };
            }
            case "create_parcel": {
                const result = await registry.createParcel({
                    courier: args?.courier,
                    invoice: String(args?.invoice),
                    recipient_name: String(args?.recipient_name),
                    recipient_phone: String(args?.recipient_phone),
                    recipient_address: String(args?.recipient_address),
                    cod_amount: Number(args?.cod_amount || 0),
                    note: args?.note ? String(args?.note) : undefined,
                    item_weight: args?.item_weight ? Number(args?.item_weight) : 0.5,
                });
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            case "track_parcel": {
                const result = await registry.trackParcel(String(args?.tracking_code), args?.courier);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            case "get_balance": {
                const result = await registry.getBalance(String(args?.courier));
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            case "check_fraud_risk": {
                const result = registry.checkFraudRisk(String(args?.phone));
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: `Aura Courier MCP Error: ${error.message || String(error)}`,
                },
            ],
        };
    }
});
async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Aura Courier MCP v2.1 (Steadfast, Pathao, RedX, Paperfly) running on STDIO");
}
run().catch((error) => {
    console.error("Fatal error running Aura Courier MCP:", error);
    process.exit(1);
});
