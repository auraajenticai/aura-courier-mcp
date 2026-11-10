import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { CourierRegistry } from "./registry.js";
import { SupportedCourier } from "./types.js";
import { EnvelopeSource, McpToolError, wrapError, wrapSuccess } from "./envelope.js";

// Tool definitions — shared by the STDIO (npx) and HTTP (web-URL) entrypoints.
export const TOOLS: Tool[] = [
  {
    name: "list_couriers",
    description:
      "Inspect operational health, configuration status, and active API credentials for supported Bangladeshi courier networks (Steadfast, Pathao, RedX, Paperfly) and spatial routing services (Google Maps Platform). READ-ONLY DISCOVERY TOOL: Has zero external side effects and does not mutate database or carrier state. Use when initializing a session to verify which couriers are ready for order dispatch or balance checking. Do NOT use for querying shipment status (use 'track_parcel') or calculating shipping fees (use 'calculate_delivery_zone_and_fee').",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_parcel",
    description:
      "Book and dispatch a physical parcel consignment across Bangladesh through Steadfast, Pathao, RedX, Paperfly, or AI smart cascading routing, with built-in per-tenant invoice idempotency and optional dry-run validation. STATE-MUTATING ACTION (unless dry_run=true): Creates a real, billable shipment record in the carrier's production database, assigns an official tracking code, and deducts courier fees upon pickup. Set dry_run=true to validate recipient phone/address and preview the target courier and estimated BDT cost without booking upstream. Once booked, cancellations require direct courier portal operations ('cancellable_via_api: false').",
    inputSchema: {
      type: "object",
      properties: {
        courier: {
          type: "string",
          enum: ["steadfast", "pathao", "redx", "paperfly", "auto", "auto_fastest", "auto_cheapest"],
          description: "Target courier or 'auto' for AI smart routing (default: auto)",
        },
        invoice: { type: "string", description: "Unique order invoice number (e.g. INV-1002) used as idempotency key" },
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
        dry_run: {
          type: "boolean",
          description: "If true, validates phone/address and returns would_book_with and estimated_cost_bdt without creating a real upstream shipment.",
        },
      },
      required: ["invoice", "recipient_name", "recipient_phone", "recipient_address", "cod_amount"],
    },
  },
  {
    name: "track_parcel",
    description:
      "Query live, real-time tracking milestones and delivery telemetry across Steadfast, Pathao, RedX, and Paperfly networks using consignment ID or tracking code. READ-ONLY OPERATION: Does not alter shipment state or carrier data. Returns normalized status, current location, carrier status notes, and timestamp history. Returns structured error code 'CONSIGNMENT_NOT_FOUND' with 'couriers_checked' if the consignment does not exist. Carrier provider is auto-detected from consignment prefix if omitted.",
    inputSchema: {
      type: "object",
      properties: {
        tracking_code: {
          type: "string",
          description: "Consignment ID or tracking code (e.g. 'DS190926QZNGJT' for Pathao, 'SF12345678' for Steadfast, 'REDX123' for RedX)",
        },
        courier: {
          type: "string",
          enum: ["steadfast", "pathao", "redx", "paperfly"],
          description: "Optional courier provider name. If omitted, provider is auto-detected from tracking code prefix.",
        },
      },
      required: ["tracking_code"],
    },
  },
  {
    name: "get_balance",
    description:
      "Retrieve live merchant cash-on-delivery (COD) vault balance from Steadfast, or check provider balance support across Pathao, RedX, Paperfly, or all 4 couriers simultaneously. READ-ONLY FINANCIAL INQUIRY: Steadfast returns live 'amount_bdt' and 'status: OK'; Pathao, RedX, and Paperfly return 'amount_bdt: null' and 'status: UNSUPPORTED_BY_PROVIDER' with merchant portal hints because their public APIs do not expose a balance endpoint.",
    inputSchema: {
      type: "object",
      properties: {
        courier: {
          type: "string",
          enum: ["steadfast", "pathao", "redx", "paperfly", "all"],
          description: "Courier provider to check balance telemetry for ('steadfast', 'pathao', 'redx', 'paperfly', or 'all'; default: 'all')",
        },
      },
      required: [],
    },
  },
  {
    name: "check_fraud_risk",
    description:
      "Screen a customer phone number against live nationwide Bangladesh logistics databases (Steadfast & Pathao) and the BTRC 11-digit prefix validator for delivery success rate, cancellation counts, and return fraud risk level ('INVALID_NUMBER', 'NO_HISTORY', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'). READ-ONLY DIAGNOSTIC QUERY: Returns null rates when a number is invalid or has 0 parcel history. Expects an 11-digit Bangladeshi mobile number ('01[3-9]XXXXXXXX').",
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
    description:
      "Validate, clean, and geocode an unformatted Bangladesh delivery address into structured administrative boundaries (thana_input, thana_resolved, district, division), latitude/longitude coordinates, match_quality (road, house, area), needs_review flag, and a deliverability confidence score (0-100, capped at 60 when location_type != ROOFTOP) via Google Maps Platform Geocoding API with OpenStreetMap gazetteer fallback. READ-ONLY SPATIAL LOOKUP.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Full street or local address (e.g. 'Road 11, House 24, Dhanmondi, Dhaka')" },
        thana: { type: "string", description: "Optional expected Thana/Upazila name to verify against geocoded components" },
        district: { type: "string", description: "Optional District name" },
      },
      required: ["address"],
    },
  },
  {
    name: "calculate_delivery_zone_and_fee",
    description:
      "Calculate standard delivery zone (inside_dhaka <=22km ৳80, sub_dhaka 22-45km ৳100, outside_dhaka >45km ৳150), road distance via Google Maps Platform Routes API, structured SLA hours ({min, max}), and applicable COD percentage for a single delivery destination using the unified tariff table (meta.source='static_tariff'). READ-ONLY ESTIMATION TOOL.",
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
    description:
      "Execute side-by-side tariff, structured SLA ({min, max}), and COD collection fee comparisons across all four major Bangladeshi couriers (Steadfast, Pathao, RedX, Paperfly) for any destination nationwide using the unified tariff table (meta.source='static_tariff'). Evaluates exact parcel weight, declared COD amount, and optimization priority ('cheapest', 'fastest', 'balanced') to select the recommended courier. READ-ONLY CALCULATION ENGINE.",
    inputSchema: {
      type: "object",
      properties: {
        recipient_address: { type: "string", description: "Destination delivery address anywhere in Bangladesh" },
        weight_kg: { type: "number", description: "Parcel weight in KG (default: 0.5)" },
        cod_amount: { type: "number", description: "Cash On Delivery amount in BDT (default: 0)" },
        priority: {
          type: "string",
          enum: ["cheapest", "fastest", "balanced"],
          description: "Optimization priority (default: balanced)",
        },
      },
      required: ["recipient_address"],
    },
  },
  {
    name: "resolve_ndr_issue",
    description:
      "Verify that a consignment exists on the specified courier via 'track_parcel' and generate honest, draft-only Non-Delivery Report (NDR) re-engagement copy ('status: DRAFT_GENERATED', 'actions_executed: []'). GENERATION-ONLY TOOL: Verifies consignment_id first (returns CONSIGNMENT_NOT_FOUND if unknown), then generates proposed Bengali WhatsApp copy ('whatsapp_draft') and a carrier escalation ticket draft ('courier_ticket_draft') for manual merchant execution.",
    inputSchema: {
      type: "object",
      properties: {
        consignment_id: { type: "string", description: "Existing tracking code or consignment ID to verify and generate NDR drafts for" },
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
  {
    name: "cancel_parcel",
    description:
      "Request cancellation for an existing parcel consignment on Steadfast, Pathao, RedX, or Paperfly. Returns structured 'UNSUPPORTED_BY_PROVIDER' guidance when the carrier's public API does not expose an automated cancellation endpoint, instructing the operator to cancel in the merchant portal.",
    inputSchema: {
      type: "object",
      properties: {
        courier: { type: "string", enum: ["steadfast", "pathao", "redx", "paperfly"], description: "Courier provider name" },
        consignment_id: { type: "string", description: "Consignment ID or tracking code to cancel" },
      },
      required: ["courier", "consignment_id"],
    },
  },
  {
    name: "bulk_create_parcels",
    description:
      "Validate or book up to 100 parcels in a single batch with per-item error isolation, invoice idempotency, and optional dry_run preview mode. STATE-MUTATING ACTION (unless dry_run=true): Returns total, succeeded, failed, and per-item results.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Array of parcel creation objects (1 to 100 items)",
          items: {
            type: "object",
            properties: {
              courier: { type: "string", enum: ["steadfast", "pathao", "redx", "paperfly", "auto"] },
              invoice: { type: "string" },
              recipient_name: { type: "string" },
              recipient_phone: { type: "string" },
              recipient_address: { type: "string" },
              cod_amount: { type: "number" },
              note: { type: "string" },
              item_weight: { type: "number" },
              dry_run: { type: "boolean" },
            },
            required: ["invoice", "recipient_name", "recipient_phone", "recipient_address", "cod_amount"],
          },
        },
        dry_run: {
          type: "boolean",
          description: "If true, runs the entire batch in dry-run validation mode without creating real upstream shipments.",
        },
      },
      required: ["items"],
    },
  },
  {
    name: "get_webhook_events",
    description:
      "Query verified courier webhook status events received by the server's /webhooks/{steadfast,pathao,redx,paperfly} endpoints. READ-ONLY DIAGNOSTIC TOOL: Filterable by consignment_id and ISO-8601 'since' timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        consignment_id: { type: "string", description: "Optional consignment ID or tracking code to filter events for" },
        since: { type: "string", description: "Optional ISO-8601 timestamp to return events received at or after" },
      },
      required: [],
    },
  },
];

/**
 * Execute a single MCP tool call and return the Global Response Envelope (`v2.6.0`).
 */
export async function executeToolCall(
  registry: CourierRegistry,
  name: string,
  args: Record<string, any> = {},
  tenantId: string = "default"
): Promise<{ isError: boolean; envelope: any }> {
  let defaultSource: EnvelopeSource = "live_api";
  if (name === "calculate_delivery_zone_and_fee" || name === "compare_courier_rates") {
    defaultSource = "static_tariff";
  } else if (name === "get_webhook_events") {
    defaultSource = "cache";
  }

  try {
    switch (name) {
      case "list_couriers": {
        const result = registry.listCouriers();
        return { isError: false, envelope: wrapSuccess(result, "validator") };
      }

      case "create_parcel": {
        const isDryRun = Boolean(args?.dry_run);
        const result = await registry.createParcel({
          courier: args?.courier as any,
          invoice: String(args?.invoice ?? ""),
          recipient_name: String(args?.recipient_name ?? ""),
          recipient_phone: String(args?.recipient_phone ?? ""),
          recipient_address: String(args?.recipient_address ?? ""),
          cod_amount: Number(args?.cod_amount || 0),
          note: args?.note ? String(args?.note) : undefined,
          item_weight: args?.item_weight ? Number(args?.item_weight) : 0.5,
          item_type: args?.item_type ? String(args?.item_type) : undefined,
          value: args?.value !== undefined ? Number(args?.value) : undefined,
          delivery_area_id: args?.delivery_area_id !== undefined ? Number(args?.delivery_area_id) : undefined,
          pickup_store_id: args?.pickup_store_id !== undefined ? Number(args?.pickup_store_id) : undefined,
          dry_run: isDryRun,
          tenant_id: tenantId,
        });
        const source: EnvelopeSource = isDryRun ? "validator" : result.idempotent_replay ? "cache" : "live_api";
        return { isError: false, envelope: wrapSuccess(result, source) };
      }

      case "track_parcel": {
        const result = await registry.trackParcel(
          String(args?.tracking_code ?? ""),
          args?.courier as SupportedCourier | undefined
        );
        return { isError: false, envelope: wrapSuccess(result, "live_api") };
      }

      case "get_balance": {
        const result = await registry.getBalance((args?.courier as SupportedCourier | "all") || "all");
        return { isError: false, envelope: wrapSuccess(result, "live_api") };
      }

      case "check_fraud_risk": {
        const result = await registry.checkFraudRisk(String(args?.phone ?? ""));
        const source: EnvelopeSource = result.risk_level === "INVALID_NUMBER" ? "validator" : "live_api";
        return { isError: false, envelope: wrapSuccess(result, source) };
      }

      case "validate_and_geocode_address": {
        const result = await registry.validateAddress({
          address: String(args?.address ?? ""),
          thana: args?.thana ? String(args?.thana) : undefined,
          district: args?.district ? String(args?.district) : undefined,
        });
        return { isError: false, envelope: wrapSuccess(result, "live_api") };
      }

      case "calculate_delivery_zone_and_fee": {
        const result = await registry.calculateZoneAndRate({
          recipient_address: String(args?.recipient_address ?? ""),
          origin_address: args?.origin_address ? String(args?.origin_address) : undefined,
          weight_kg: args?.weight_kg ? Number(args?.weight_kg) : 0.5,
        });
        return { isError: false, envelope: wrapSuccess(result, "static_tariff") };
      }

      case "compare_courier_rates": {
        const result = await registry.compareRates({
          recipient_address: String(args?.recipient_address ?? ""),
          weight_kg: args?.weight_kg ? Number(args?.weight_kg) : 0.5,
          cod_amount: args?.cod_amount ? Number(args?.cod_amount) : 0,
          priority: args?.priority as any,
        });
        return { isError: false, envelope: wrapSuccess(result, "static_tariff") };
      }

      case "resolve_ndr_issue": {
        const result = await registry.resolveNdr({
          consignment_id: String(args?.consignment_id ?? ""),
          courier: args?.courier as any,
          issue_type: args?.issue_type as any,
          customer_phone: args?.customer_phone ? String(args?.customer_phone) : undefined,
          customer_name: args?.customer_name ? String(args?.customer_name) : undefined,
          reschedule_date: args?.reschedule_date ? String(args?.reschedule_date) : undefined,
          corrected_address: args?.corrected_address ? String(args?.corrected_address) : undefined,
        });
        return { isError: false, envelope: wrapSuccess(result, "live_api") };
      }

      case "cancel_parcel": {
        const result = await registry.cancelParcel(
          args?.courier as SupportedCourier,
          String(args?.consignment_id ?? "")
        );
        return { isError: false, envelope: wrapSuccess(result, "live_api") };
      }

      case "bulk_create_parcels": {
        const isDryRun = args?.dry_run !== undefined ? Boolean(args?.dry_run) : undefined;
        const result = await registry.bulkCreateParcels(
          Array.isArray(args?.items) ? args.items : [],
          isDryRun,
          tenantId
        );
        return { isError: false, envelope: wrapSuccess(result, isDryRun ? "validator" : "live_api") };
      }

      case "get_webhook_events": {
        const result = registry.getWebhookEvents(
          args?.consignment_id ? String(args?.consignment_id) : undefined,
          args?.since ? String(args?.since) : undefined
        );
        return { isError: false, envelope: wrapSuccess(result, "cache") };
      }

      default:
        throw new McpToolError({
          code: "INVALID_INPUT",
          message: `Unknown tool: ${name}`,
          retryable: false,
        });
    }
  } catch (error: any) {
    return {
      isError: true,
      envelope: wrapError(error, defaultSource),
    };
  }
}

/**
 * Build a fully-wired MCP Server bound to a given CourierRegistry.
 * The registry carries the credentials — for STDIO it comes from env,
 * for HTTP it is built per-request from that client's keys.
 */
export function buildMcpServer(
  registry: CourierRegistry,
  authChecker?: (toolName: string, args?: Record<string, any>) => { permitted: boolean; reason?: string },
  tenantId: string = "default"
): Server {
  const server = new Server(
    { name: "aura-courier-mcp", version: "2.6.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (authChecker) {
      const auth = authChecker(name, (args as Record<string, any>) || {});
      if (!auth.permitted) {
        const errEnvelope = wrapError(
          new McpToolError({
            code: "UNAUTHORIZED",
            message: auth.reason || "Unauthorized tool invocation.",
            retryable: false,
          }),
          "validator"
        );
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(errEnvelope, null, 2) }],
        };
      }
    }

    const { isError, envelope } = await executeToolCall(registry, name, (args as Record<string, any>) || {}, tenantId);
    return {
      isError,
      content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    };
  });

  return server;
}
