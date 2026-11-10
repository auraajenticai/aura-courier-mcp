import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
// Tool definitions — shared by the STDIO (npx) and HTTP (web-URL) entrypoints.
export const TOOLS = [
    {
        name: "list_couriers",
        description: "Inspect operational health, configuration status, and active API credentials for supported Bangladeshi courier networks (Steadfast, Pathao, RedX, Paperfly) and spatial routing services (Google Maps Platform). READ-ONLY DISCOVERY TOOL: Has zero external side effects and does not mutate database or carrier state. Use when initializing a session to verify which couriers are ready for order dispatch or balance checking. Do NOT use for querying shipment status (use 'track_parcel') or calculating shipping fees (use 'calculate_delivery_zone_and_fee').",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "create_parcel",
        description: "Book and dispatch a physical parcel consignment across Bangladesh through Steadfast, Pathao, RedX, Paperfly, or AI smart cascading routing. STATE-MUTATING ACTION: This call creates a real, billable shipment record in the carrier's production database, assigns an official tracking code, and deducts courier fees upon pickup. Once booked, cancellations require direct courier portal operations. Use only after customer address and phone number are verified. Do NOT use for preliminary fee estimation (use 'calculate_delivery_zone_and_fee' or 'compare_courier_rates') or address validation (use 'validate_and_geocode_address'). Throws an error if required courier credentials are not configured or recipient phone is invalid.",
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
        description: "Query live, real-time tracking milestones and delivery telemetry across Steadfast, Pathao, RedX, and Paperfly networks using consignment ID or tracking code. READ-ONLY OPERATION: Does not alter shipment state or carrier data. Returns normalized status (Booked, In Review, Picked Up, In Transit, Delivered, Partial Delivered, Cancelled, Returned), current location, carrier status notes, and timestamp history. Use when an end-customer or merchant inquires about existing shipment progress. Do NOT use for creating consignments (use 'create_parcel') or resolving failed deliveries (use 'resolve_ndr_issue'). Carrier provider is auto-detected from consignment prefix if omitted.",
        inputSchema: {
            type: "object",
            properties: {
                tracking_code: { type: "string", description: "Consignment ID or tracking code (e.g. 'DS190926QZNGJT' for Pathao, 'SF12345678' for Steadfast, 'REDX123' for RedX)" },
                courier: { type: "string", enum: ["steadfast", "pathao", "redx", "paperfly"], description: "Optional courier provider name. If omitted, provider is auto-detected from tracking code prefix." },
            },
            required: ["tracking_code"],
        },
    },
    {
        name: "get_balance",
        description: "Retrieve live merchant cash-on-delivery (COD) vault balance, pending disbursement amounts, and payout ledger from Steadfast or Pathao merchant portals. READ-ONLY FINANCIAL INQUIRY: Does not initiate payouts or mutate accounting ledgers. Use when accounting or merchant finance operators want to verify accrued COD collections or payout readiness. Do NOT use for customer balance or shipping quote estimation (use 'calculate_delivery_zone_and_fee'). Requires active merchant API keys for the requested courier; throws an error if unconfigured.",
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
        description: "Screen a customer phone number against live nationwide Bangladesh logistics databases (millions of historical consignments) for delivery success rate, cancellation counts, and return fraud risk score. READ-ONLY DIAGNOSTIC QUERY: Zero mock data, authentic carrier telemetry only. Use before confirming high-value COD orders to screen for chronic returners or fake orders. Do NOT use for address geocoding (use 'validate_and_geocode_address') or parcel booking (use 'create_parcel'). Expects an 11-digit Bangladeshi mobile number ('01XXXXXXXXX').",
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
        description: "Validate, clean, and geocode an unformatted Bangladesh delivery address into structured administrative boundaries (Thana, District, Division), rooftop latitude/longitude coordinates, and a deliverability confidence score (0-100) via Google Maps Platform Geocoding API with OpenStreetMap gazetteer fallback. READ-ONLY SPATIAL LOOKUP: Has zero side effects and does not mutate booking data. Use before booking parcels to detect spelling errors, verify Thana/District matching, and obtain precise coordinates. Do NOT use for calculating delivery fees or road routing distance (use 'calculate_delivery_zone_and_fee' instead).",
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
        description: "Calculate standard delivery zone (inside_dhaka ≤22km ৳80, sub_dhaka 22-45km ৳100, outside_dhaka >45km ৳150), actual road distance via Google Maps Platform Routes API (v2:computeRoutes), SLA turnaround time (24-72h), and applicable COD percentage for a SINGLE delivery destination. READ-ONLY ESTIMATION TOOL: Has zero external side effects and does NOT book shipments. Use when quoting shipping charges to a customer or determining flat delivery tiers for an order. Do NOT use if you need side-by-side multi-carrier tariff quotes with weight breaks and priority sorting across all 4 couriers (use 'compare_courier_rates' instead).",
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
        description: "Execute side-by-side tariff, SLA, and COD collection fee comparisons across all four major Bangladeshi couriers (Steadfast, Pathao, RedX, Paperfly) for any destination nationwide. Evaluates exact parcel weight, declared COD amount, and optimization priority ('cheapest', 'fastest', 'balanced') to select the recommended courier. READ-ONLY CALCULATION ENGINE: Has zero external side effects and does not create orders. Use when deciding which carrier offers the best commercial rate or fastest SLA for a specific shipment before booking. Do NOT use for single flat-rate zone lookup (use 'calculate_delivery_zone_and_fee') or for actually booking the shipment (use 'create_parcel').",
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
        description: "Automate Non-Delivery Report (NDR) triage and dispute resolution when a courier delivery attempt fails. GENERATION-ONLY TOOL (NO DIRECT DISPATCH): Generates empathetic, conversion-tested Bengali WhatsApp re-engagement copy for the customer and formal operational escalation tickets with hold instructions for the carrier. Does NOT send network messages or modify courier bookings automatically; output must be reviewed or dispatched through messaging channels. Use when a parcel status changes to failed attempt, customer phone off, or reschedule requested. Do NOT use for general order tracking (use 'track_parcel') or creating orders (use 'create_parcel').",
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
export function buildMcpServer(registry, authChecker) {
    const server = new Server({ name: "aura-courier-mcp", version: "2.5.4" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        if (authChecker) {
            const auth = authChecker(name);
            if (!auth.permitted) {
                return {
                    isError: true,
                    content: [{ type: "text", text: JSON.stringify({ error: "Unauthorized", message: auth.reason }, null, 2) }],
                };
            }
        }
        try {
            switch (name) {
                case "list_couriers":
                    return { content: [{ type: "text", text: JSON.stringify(registry.listCouriers(), null, 2) }] };
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
                    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                }
                case "track_parcel": {
                    const result = await registry.trackParcel(String(args?.tracking_code), args?.courier);
                    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                }
                case "get_balance": {
                    const result = await registry.getBalance(String(args?.courier));
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
                        priority: args?.priority,
                    });
                    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                }
                case "resolve_ndr_issue": {
                    const result = await registry.resolveNdr({
                        consignment_id: String(args?.consignment_id),
                        courier: args?.courier,
                        issue_type: args?.issue_type,
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
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Aura Courier MCP Error: ${error?.message || String(error)}` }],
            };
        }
    });
    return server;
}
