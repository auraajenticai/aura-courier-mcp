/**
 * Pathao Courier adapter.
 *
 * Docs: base https://api-hermes.pathao.com (prod) / https://courier-api-sandbox.pathao.com (sandbox)
 * Auth: OAuth2 password grant — POST /aladdin/api/v1/issue-token → bearer access_token (cached).
 * Endpoints: POST /aladdin/api/v1/orders, GET /aladdin/api/v1/orders/{cid}/info,
 *            GET /aladdin/api/v1/city-list | /cities/{id}/zone-list | /zones/{id}/area-list
 *
 * Pathao differs from Steadfast: it needs a store_id + structured city/zone/area IDs
 * (not a free-text address). Those come through `CreateParcelInput.meta`; resolve the
 * IDs with the `get_courier_locations` tool. Built to the documented Pathao Merchant API.
 */
import { CourierError, type CourierAdapter } from "./base.js";
import type {
  CourierLocation,
  CreateParcelInput,
  LocationLevel,
  Parcel,
  ParcelStatus,
  TrackRef,
  TrackingResult,
} from "../types.js";

const PROD_URL = "https://api-hermes.pathao.com";
const SANDBOX_URL = "https://courier-api-sandbox.pathao.com";

/** Best-effort map of Pathao order_status strings to our normalized status. */
export function mapPathaoStatus(raw: string | undefined): ParcelStatus {
  const s = (raw ?? "").toLowerCase().replace(/\s+/g, "_");
  if (!s) return "unknown";
  if (s.includes("partial")) return "partial_delivered";
  if (s === "delivered") return "delivered";
  if (s.includes("return")) return "returned";
  if (s.includes("fail")) return "unknown";
  if (s.includes("hold")) return "on_hold";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("transit") || s.includes("hub") || s.includes("assigned_for_delivery")) {
    return "in_transit";
  }
  if (s.includes("pick")) return "picked";
  if (s.includes("pending") || s.includes("requested") || s.includes("invoice")) return "pending";
  return "unknown";
}

interface PathaoConfig {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  sandbox?: boolean;
  defaultStoreId?: number;
}

export class PathaoAdapter implements CourierAdapter {
  readonly id = "pathao" as const;
  readonly label = "Pathao Courier";

  private token?: { value: string; expiresAt: number };

  constructor(private readonly cfg: PathaoConfig) {}

  isConfigured(): boolean {
    return Boolean(this.cfg.clientId && this.cfg.clientSecret && this.cfg.username && this.cfg.password);
  }

  private baseUrl(): string {
    return this.cfg.sandbox ? SANDBOX_URL : PROD_URL;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    if (!this.isConfigured()) {
      throw new CourierError(
        "not_configured",
        "Pathao is not configured — set PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD.",
      );
    }
    const body = await this.raw("/aladdin/api/v1/issue-token", {
      method: "POST",
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        username: this.cfg.username,
        password: this.cfg.password,
        grant_type: "password",
      }),
    });
    const access = body?.access_token;
    if (!access) {
      throw new CourierError("auth_failed", "Pathao did not return an access_token.", body);
    }
    const ttl = Number(body?.expires_in ?? 3600) * 1000;
    this.token = { value: access, expiresAt: Date.now() + ttl };
    return access;
  }

  /** Low-level request WITHOUT auth (used by getToken). */
  private async raw(path: string, init: RequestInit): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });
    } catch (err) {
      throw new CourierError("network_error", `Could not reach Pathao: ${String(err)}`);
    }
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new CourierError("bad_response", `Pathao returned non-JSON (HTTP ${res.status}).`, text);
    }
    if (!res.ok) {
      throw new CourierError(
        "api_error",
        `Pathao API error (HTTP ${res.status}): ${json?.message ?? "unknown"}`,
        json,
      );
    }
    return json;
  }

  /** Authenticated request (adds the bearer token). */
  private async api(path: string, init: RequestInit): Promise<any> {
    const token = await this.getToken();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
    } catch (err) {
      throw new CourierError("network_error", `Could not reach Pathao: ${String(err)}`);
    }
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new CourierError("bad_response", `Pathao returned non-JSON (HTTP ${res.status}).`, text);
    }
    if (!res.ok) {
      throw new CourierError(
        "api_error",
        `Pathao API error (HTTP ${res.status}): ${json?.message ?? "unknown"}`,
        json,
      );
    }
    return json;
  }

  async createParcel(input: CreateParcelInput): Promise<Parcel> {
    const m = input.meta ?? {};
    const storeId = num(m.storeId) ?? this.cfg.defaultStoreId;
    const cityId = num(m.cityId);
    const zoneId = num(m.zoneId);
    const areaId = num(m.areaId);

    const missing: string[] = [];
    if (!storeId) missing.push("storeId (or set PATHAO_STORE_ID)");
    if (!cityId) missing.push("cityId");
    if (!zoneId) missing.push("zoneId");
    if (!areaId) missing.push("areaId");
    if (missing.length) {
      throw new CourierError(
        "bad_input",
        `Pathao needs ${missing.join(", ")} in meta. Use get_courier_locations to resolve city/zone/area IDs.`,
      );
    }

    const body = await this.api("/aladdin/api/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        store_id: storeId,
        merchant_order_id: input.invoice,
        recipient_name: input.recipientName,
        recipient_phone: input.recipientPhone,
        recipient_address: input.recipientAddress,
        recipient_city: cityId,
        recipient_zone: zoneId,
        recipient_area: areaId,
        delivery_type: num(m.deliveryType) ?? 48, // 48 = normal, 12 = on-demand
        item_type: num(m.itemType) ?? 2, // 2 = parcel, 1 = document
        item_quantity: num(m.itemQuantity) ?? 1,
        item_weight: num(m.itemWeight) ?? 0.5,
        amount_to_collect: input.codAmount,
        item_description: input.itemDescription ?? input.note ?? "",
        special_instruction: input.note ?? "",
      }),
    });

    const d = body?.data ?? body;
    const cid = String(d?.consignment_id ?? "");
    return {
      courier: this.id,
      consignmentId: cid,
      trackingCode: cid, // Pathao tracks by consignment_id
      invoice: String(d?.merchant_order_id ?? input.invoice),
      status: mapPathaoStatus(d?.order_status ?? "Pending"),
      codAmount: Number(d?.amount_to_collect ?? input.codAmount),
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      raw: d,
    };
  }

  async track(ref: TrackRef): Promise<TrackingResult> {
    const cid = ref.consignmentId ?? ref.trackingCode;
    if (!cid) {
      throw new CourierError("bad_input", "Pathao tracks by consignmentId (or trackingCode).");
    }
    const body = await this.api(`/aladdin/api/v1/orders/${encodeURIComponent(cid)}/info`, {
      method: "GET",
    });
    const d = body?.data ?? body;
    return {
      courier: this.id,
      reference: cid,
      status: mapPathaoStatus(d?.order_status),
      raw: body,
    };
  }

  async getLocations(level: LocationLevel, parentId?: number): Promise<CourierLocation[]> {
    let path: string;
    if (level === "city") {
      path = "/aladdin/api/v1/city-list";
    } else if (level === "zone") {
      if (!parentId) throw new CourierError("bad_input", "zone lookup needs parentId (a city id).");
      path = `/aladdin/api/v1/cities/${parentId}/zone-list`;
    } else {
      if (!parentId) throw new CourierError("bad_input", "area lookup needs parentId (a zone id).");
      path = `/aladdin/api/v1/zones/${parentId}/area-list`;
    }
    const body = await this.api(path, { method: "GET" });
    const arr: any[] = body?.data?.data ?? body?.data ?? [];
    return arr.map((x) => ({
      id: Number(x.city_id ?? x.zone_id ?? x.area_id ?? x.id),
      name: String(x.city_name ?? x.zone_name ?? x.area_name ?? x.name ?? ""),
    }));
  }
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
