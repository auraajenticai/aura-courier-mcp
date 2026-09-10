import axios, { AxiosInstance } from "axios";
import { CourierAdapter } from "./base.js";
import {
  BalanceResponse,
  ParcelCreateRequest,
  ParcelResponse,
  SupportedCourier,
  TrackingResponse,
} from "../types.js";

export class RedxAdapter implements CourierAdapter {
  courierName: SupportedCourier = "redx";
  private client: AxiosInstance;
  private enabled: boolean;
  private pickupStoreId: string;

  constructor(apiToken: string, baseUrl: string, pickupStoreId = "") {
    this.enabled = Boolean(apiToken);
    this.pickupStoreId = pickupStoreId;
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        "API-ACCESS-TOKEN": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }

  isConfigured(): boolean {
    return this.enabled;
  }

  // RedX's create endpoint needs a numeric delivery_area_id. If the caller did
  // not pass one, best-effort resolve it from the address via GET /areas.
  private async resolveDeliveryArea(req: ParcelCreateRequest): Promise<{ id: number; name: string }> {
    if (req.delivery_area_id) {
      return { id: Number(req.delivery_area_id), name: req.delivery_area || "" };
    }
    const res = await this.client.get("/areas");
    const areas: Array<{ id: number; name: string }> = res.data?.areas || [];
    const addr = (req.recipient_address || "").toLowerCase();
    let best: { id: number; name: string } | null = null;
    for (const a of areas) {
      const base = String(a.name).split("(")[0].trim().toLowerCase();
      if (base && addr.includes(base)) {
        const bestLen = best ? String(best.name).split("(")[0].trim().length : 0;
        if (base.length > bestLen) best = a;
      }
    }
    if (!best) {
      throw new Error(
        "RedX: could not match a delivery area from the address. Pass 'delivery_area_id' explicitly (look it up via RedX /areas)."
      );
    }
    return { id: best.id, name: best.name };
  }

  async createParcel(req: ParcelCreateRequest): Promise<ParcelResponse> {
    if (!this.enabled) {
      throw new Error("RedX credentials (API access token) are not configured.");
    }

    const area = await this.resolveDeliveryArea(req);
    const weightGrams = Math.max(1, Math.round((req.item_weight ?? 0.5) * 1000));
    const declaredValue = String(req.value ?? req.cod_amount ?? 0);

    const payload: Record<string, any> = {
      customer_name: req.recipient_name,
      customer_phone: req.recipient_phone,
      delivery_area: area.name || req.delivery_area || "",
      delivery_area_id: area.id,
      customer_address: req.recipient_address,
      merchant_invoice_id: req.invoice,
      cash_collection_amount: String(req.cod_amount ?? 0),
      parcel_weight: weightGrams,
      instruction: req.note || "Aura AI automated dispatch",
      value: declaredValue,
    };
    const storeId = req.pickup_store_id || this.pickupStoreId;
    if (storeId) payload.pickup_store_id = Number(storeId);
    if (req.item_type) {
      payload.parcel_details_json = [
        { name: req.item_type, category: req.item_category || "general", value: Number(req.value ?? req.cod_amount ?? 0) },
      ];
    }

    const response = await this.client.post("/parcel", payload);
    const data = response.data;
    const trackingId = data?.tracking_id;
    if (!trackingId) {
      throw new Error(`RedX API error: ${JSON.stringify(data?.message || data)}`);
    }

    return {
      success: true,
      courier: "redx",
      tracking_code: trackingId,
      consignment_id: trackingId,
      invoice: req.invoice,
      status: "pickup-pending",
      cod_amount: req.cod_amount,
      created_at: new Date().toISOString(),
      raw_response: data,
    };
  }

  async trackParcel(trackingCode: string): Promise<TrackingResponse> {
    if (!this.enabled) {
      throw new Error("RedX credentials are not configured.");
    }
    const response = await this.client.get(`/parcel/track/${encodeURIComponent(trackingCode)}`);
    const data = response.data;
    const events: Array<{ message_en?: string; message_bn?: string; time?: string }> = data?.tracking || [];
    const latest = events[events.length - 1];
    return {
      success: true,
      courier: "redx",
      tracking_code: trackingCode,
      status: latest?.message_en || "unknown",
      updated_at: latest?.time || new Date().toISOString(),
      timeline: events.map((e) => ({ status: e.message_en || "", time: e.time || "", note: e.message_bn })),
      raw_response: data,
    };
  }

  async getBalance(): Promise<BalanceResponse> {
    throw new Error(
      "RedX does not expose a merchant balance endpoint via its public API — check your balance in the RedX merchant panel."
    );
  }
}
