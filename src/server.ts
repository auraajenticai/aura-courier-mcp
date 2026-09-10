import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry } from "./registry.js";
import { SupportedCourier } from "./types.js";

// Tool definitions — shared by the STDIO (npx) and HTTP (web-URL) entrypoints.
export const TOOLS: Tool[] = [
  {
    name: "list_couriers",
    description: "Show supported Bangladeshi couriers and spatial services, and check which credentials are active.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_parcel",
    description: "Book a new parcel delivery across Bangladesh (Steadfast, Pathao, RedX or Paperfly) with normalized response.",
    inputSchema: {
      type: "object",
      properties: {
        courier: { type: "string", enum: ["steadfast", "pathao", "redx", "paperfly", "auto"], description: "Target courier or 'auto' for AI smart routing (default: auto)" },
        invoice: { type: "string", description: "Unique order invoice number (e.g. INV-1002)" },
        recipient_name: { type: "string", description: "Customer full name" },
        recipient_phone: { type: "string", description: "11-digit Bangladeshi mobile number (e.g. 017XXXXXXXX)" },
        recipient_address: { type: "string", description: "Delivery address (Thana, District, Street)" },
        cod_amount: { type: "number", description: "Cash on delivery amount in BDT (0 if prepaid)" },
        note: { type: "string", description: "Special instructions for delivery rider" },
        item_weight: { type: "number", description: "Parcel weight in KG (default: 0.5)" },
        item_type: { type: "string", description: "What's inside the parcel (used by RedX)" },
        value: { type: "number", description: "Declared parcel value in BDT (used by RedX; defaults to the COD amount)" },
        delivery_area_id: { type: "number", description: "RedX only: numeric delivery-area id (auto-resolved from the address if omitted)" },
        pickup_store_id: { type: "number", description: "RedX only: your pickup store id (optional)" },
      },
      required: ["invoice", "recipient_name", "recipient_phone", "recipient_address", "cod_amount"],
    },
  },
  {
    name: "track_parcel",
    description: "Track shipment delivery status across Steadfast or Pathao using Tracking Code / Consignment ID.",
    inputSchema: {
      type: "object",
      properties: {
        tracking_code: { type: "string", description: "Consignment ID or tracking code" },
        courier: { type: "string", enum: ["steadfast", "pathao", "redx", "paperfly"], description: "Optional courier name if known" },
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
        courier: { type: "string", enum: ["steadfast", "pathao"], description: "Courier provider to check balance for" },
      },
      required: ["courier"],
    },
  },
  {
    name: "check_fraud_risk",
    description: "100% Real Live nationwide courier fraud check across Bangladesh logistics networks (Steadfast nationwide API). Returns actual order delivery/cancellation counts, success rate, and risk evaluation. Zero mock data.",
    inputSchema: {
      type: "object",
      properties: {
        phone: { type: "string", description: "11-digit Bangladeshi mobile number to evaluate" },
      },
      required: ["phone"],
    },
  },
  {
    name: "validate_and_geocode_address",
    description: "Validate and geocode a Bangladesh delivery address using Google Maps Platform Geocoding API with administrative sublocality (Thana, District, Division), exact lat/lng coordinates, and delivery confidence score.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Full street or local address (e.g. 'Road 11, House 24, Dhanmondi, Dhaka')" },
        thana: { type: "string", description: "Optional Thana/Upazila name" },
        district: { type: "string", description: "Optional District name" },
      },
      required: ["address"],
    },
  },
  {
    name: "calculate_delivery_zone_and_fee",
    description: "Compute road distance in km, classify Bangladesh delivery zone (inside_dhaka ৳80, sub_dhaka ৳100, outside_dhaka ৳150), and return estimated delivery hours and COD fee using Google Maps Platform Routes API.",
    inputSchema: {
      type: "object",
      properties: {
        recipient_address: { type: "string", description: "Delivery destination address" },
        origin_address: { type: "string", description: "Optional merchant warehouse address (defaults to Dhaka Central Hub)" },
        weight_kg: { type: "number", description: "Parcel weight in KG (default: 0.5)" },
      },
      required: ["recipient_address"],
    },
  },
  {
    name: "compare_courier_rates",
    description: "Real-time tariff & SLA comparison across Steadfast, Pathao, RedX, and Paperfly for a given destination address, parcel weight, and COD value. Recommends the optimal carrier for cost vs speed.",
    inputSchema: {
      type: "object",
      properties: {
        recipient_address: { type: "string", description: "Destination delivery address anywhere in Bangladesh" },
        weight_kg: { type: "number", description: "Parcel weight in KG (default: 0.5)" },
        cod_amount: { type: "number", description: "Cash On Delivery amount in BDT (default: 0)" },
        priority: { type: "string", enum: ["cheapest", "fastest", "balanced"], description: "Optimization priority (default: balanced)" },
      },
      required: ["recipient_address"],
    },
  },
  {
    name: "resolve_ndr_issue",
    description: "Automate Non-Delivery Report (NDR) triage and resolution for failed courier delivery attempts. Generates WhatsApp re-engagement message to customer and official operational escalation/hold instructions for the carrier.",
    inputSchema: {
      type: "object",
      properties: {
        consignment_id: { type: "string", description: "Tracking code or consignment ID" },
        courier: { type: "string", enum: ["steadfast", "pathao", "redx", "paperfly"], description: "Courier provider" },
        issue_type: {
          type: "string",
          enum: ["customer_phone_off", "reschedule_requested", "wrong_address", "customer_refused", "fake_attempt"],
          description: "Reason for failed delivery",
        },
        customer_phone: { type: "string", description: "Customer mobile number" },
        customer_name: { type: "string", description: "Customer full name" },
        reschedule_date: { type: "string", description: "Preferred delivery date (if rescheduled)" },
        corrected_address: { type: "string", description: "Corrected delivery address (if wrong address)" },
      },
      required: ["consignment_id", "courier", "issue_type"],
    },
  },
];

/**
 * Build a fully-wired MCP Server bound to a given CourierRegistry.
 * The registry carries the credentials — for STDIO it comes from env,
 * for HTTP it is built per-request from that client's keys.
 */
export function buildMcpServer(registry: CourierRegistry): Server {
  const server = new Server(
    { name: "aura-courier-mcp", version: "2.4.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case "list_couriers":
          return { content: [{ type: "text", text: JSON.stringify(registry.listCouriers(), null, 2) }] };

        case "create_parcel": {
          const result = await registry.createParcel({
            courier: args?.courier as any,
            invoice: String(args?.invoice),
            recipient_name: String(args?.recipient_name),
            recipient_phone: String(args?.recipient_phone),
            recipient_address: String(args?.recipient_address),
            cod_amount: Number(args?.cod_amount || 0),
            note: args?.note ? String(args?.note) : undefined,
            item_weight: args?.item_weight ? Number(args?.item_weight) : 0.5,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "track_parcel": {
          const result = await registry.trackParcel(
            String(args?.tracking_code),
            args?.courier as SupportedCourier | undefined
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_balance": {
          const result = await registry.getBalance(String(args?.courier) as SupportedCourier);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "check_fraud_risk": {
          const result = await registry.checkFraudRisk(String(args?.phone));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "validate_and_geocode_address": {
          const result = await registry.validateAddress({
            address: String(args?.address),
            thana: args?.thana ? String(args?.thana) : undefined,
            district: args?.district ? String(args?.district) : undefined,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "calculate_delivery_zone_and_fee": {
          const result = await registry.calculateZoneAndRate({
            recipient_address: String(args?.recipient_address),
            origin_address: args?.origin_address ? String(args?.origin_address) : undefined,
            weight_kg: args?.weight_kg ? Number(args?.weight_kg) : 0.5,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "compare_courier_rates": {
          const result = await registry.compareRates({
            recipient_address: String(args?.recipient_address),
            weight_kg: args?.weight_kg ? Number(args?.weight_kg) : 0.5,
            cod_amount: args?.cod_amount ? Number(args?.cod_amount) : 0,
            priority: args?.priority as any,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "resolve_ndr_issue": {
          const result = await registry.resolveNdr({
            consignment_id: String(args?.consignment_id),
            courier: args?.courier as any,
            issue_type: args?.issue_type as any,
            customer_phone: args?.customer_phone ? String(args?.customer_phone) : undefined,
            customer_name: args?.customer_name ? String(args?.customer_name) : undefined,
            reschedule_date: args?.reschedule_date ? String(args?.reschedule_date) : undefined,
            corrected_address: args?.corrected_address ? String(args?.corrected_address) : undefined,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Aura Courier MCP Error: ${error?.message || String(error)}` }],
      };
    }
  });

  return server;
}
