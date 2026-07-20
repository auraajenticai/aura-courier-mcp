/**
 * MCP tool definitions. Each tool validates input with zod, routes through the
 * registry to a courier adapter, and returns a normalized, human-readable result.
 * Adapter errors become clean tool errors — never raw crashes.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CourierError } from "../adapters/base.js";
import type { CourierRegistry } from "../adapters/registry.js";

const courierEnum = z.enum(["steadfast", "pathao", "redx", "paperfly"]);

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const e =
    err instanceof CourierError
      ? { error: err.code, message: err.message, details: err.details }
      : { error: "unexpected", message: String(err) };
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(e, null, 2) }] };
}

export function registerTools(server: McpServer, registry: CourierRegistry): void {
  server.registerTool(
    "list_couriers",
    {
      title: "List supported couriers",
      description:
        "List every courier this connector supports and whether each is configured with credentials.",
      inputSchema: {},
    },
    async () => ok({ couriers: registry.list() }),
  );

  server.registerTool(
    "create_parcel",
    {
      title: "Create a courier parcel (book a delivery)",
      description:
        "Book a delivery with a Bangladesh courier. Returns the consignment id and tracking code. " +
        "COD amount is in BDT (use 0 for prepaid). The invoice must be unique per order. " +
        "Pathao also needs meta:{ storeId, cityId, zoneId, areaId } — resolve the IDs with get_courier_locations.",
      inputSchema: {
        courier: courierEnum.default("steadfast").describe("Which courier to book with."),
        invoice: z.string().min(1).describe("Your unique order/invoice id (idempotency key)."),
        recipientName: z.string().min(1),
        recipientPhone: z
          .string()
          .regex(/^01\d{9}$/, "Must be an 11-digit BD mobile number, e.g. 01700000000."),
        recipientAddress: z.string().min(1),
        codAmount: z.number().min(0).describe("Cash-on-delivery amount in BDT (0 = prepaid)."),
        itemDescription: z.string().optional(),
        note: z.string().optional(),
        meta: z
          .record(z.any())
          .optional()
          .describe("Courier-specific extras. Pathao: { storeId, cityId, zoneId, areaId }."),
      },
    },
    async (args) => {
      try {
        const parcel = await registry.get(args.courier).createParcel(args);
        return ok(parcel);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "track_parcel",
    {
      title: "Track a parcel's delivery status",
      description:
        "Look up the current delivery status of a parcel. Provide any ONE of: consignmentId, " +
        "invoice, or trackingCode.",
      inputSchema: {
        courier: courierEnum.default("steadfast"),
        consignmentId: z.string().optional(),
        invoice: z.string().optional(),
        trackingCode: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const result = await registry.get(args.courier).track({
          consignmentId: args.consignmentId,
          invoice: args.invoice,
          trackingCode: args.trackingCode,
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Get courier account balance",
      description: "Get the merchant's current account balance with a courier (BDT).",
      inputSchema: {
        courier: courierEnum.default("steadfast"),
      },
    },
    async (args) => {
      try {
        const adapter = registry.get(args.courier);
        if (!adapter.getBalance) {
          throw new CourierError("unsupported", `${adapter.label} has no balance endpoint.`);
        }
        return ok(await adapter.getBalance());
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_courier_locations",
    {
      title: "Resolve courier location IDs (city / zone / area)",
      description:
        "For couriers that address by structured location IDs (e.g. Pathao). Get the list of " +
        "cities, or the zones of a city (parentId = city id), or the areas of a zone (parentId = " +
        "zone id). Use the returned ids in create_parcel's meta for Pathao.",
      inputSchema: {
        courier: courierEnum.default("pathao"),
        level: z.enum(["city", "zone", "area"]),
        parentId: z
          .number()
          .optional()
          .describe("Required for zone (city id) and area (zone id)."),
      },
    },
    async (args) => {
      try {
        const adapter = registry.get(args.courier);
        if (!adapter.getLocations) {
          throw new CourierError(
            "unsupported",
            `${adapter.label} addresses by free text — no location IDs needed.`,
          );
        }
        return ok({ locations: await adapter.getLocations(args.level, args.parentId) });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
