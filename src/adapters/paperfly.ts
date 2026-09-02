import axios, { AxiosInstance } from "axios";
import { CourierAdapter } from "./base.js";
import {
  BalanceResponse,
  ParcelCreateRequest,
  ParcelResponse,
  SupportedCourier,
  TrackingResponse,
} from "../types.js";

export class PaperflyAdapter implements CourierAdapter {
  courierName: SupportedCourier = "paperfly";
  private apiKey: string;
  private username: string;
  private password: string;
  private storeName: string;
  private client: AxiosInstance;
  private enabled: boolean;

  constructor(apiKey: string, username: string, password: string, storeName: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.username = username;
    this.password = password;
    this.storeName = storeName;
    this.enabled = Boolean(apiKey && storeName);
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      headers: { "Content-Type": "application/json" },
    });
  }

  isConfigured(): boolean {
    return this.enabled;
  }

  async createParcel(req: ParcelCreateRequest): Promise<ParcelResponse> {
    if (!this.enabled) {
      throw new Error("Paperfly credentials (paperflykey + store name) are not configured.");
    }
    const payload = {
      merchantOrderReference: req.invoice,
      storeName: this.storeName,
      productBrief: req.item_type || "Product",
      packagePrice: String(req.value ?? req.cod_amount ?? 0),
      max_weight: String(req.item_weight ?? 0.5),
      customerName: req.recipient_name,
      customerAddress: req.recipient_address,
      customerPhone: req.recipient_phone,
    };
    const response = await this.client.post("/merchant/api/service/new_order_v2.php", payload, {
      headers: { paperflykey: this.apiKey },
    });
    const data = response.data;
    const ok = data?.success;
    if (!ok?.tracking_number) {
      throw new Error(`Paperfly API error: ${JSON.stringify(data?.error || data?.message || data)}`);
    }
    return {
      success: true,
      courier: "paperfly",
      tracking_code: ok.tracking_number,
      consignment_id: ok.tracking_barcode || ok.tracking_number,
      invoice: req.invoice,
      status: ok.message || "created",
      cod_amount: req.cod_amount,
      created_at: new Date().toISOString(),
      raw_response: data,
    };
  }

  async trackParcel(trackingCode: string): Promise<TrackingResponse> {
    if (!this.enabled) {
      throw new Error("Paperfly credentials are not configured.");
    }
    if (!this.username || !this.password) {
      throw new Error(
        "Paperfly tracking needs your merchant-panel username & password (Basic Auth). Add them to use track_parcel."
      );
    }
    // Paperfly tracks by your merchant order reference (merchantOrderReference), not its tracking number.
    const response = await this.client.post(
      "/API-Order-Tracking",
      { ReferenceNumber: trackingCode },
      { auth: { username: this.username, password: this.password } }
    );
    const data = response.data;
    const st = data?.success?.trackingStatus?.[0] || {};
    const stages: Array<[any, string]> = [
      [st.Delivered, "delivered"],
      [st.Partial, "partial-delivery"],
      [st.Returned, "returned"],
      [st.PickedForDelivery, "out-for-delivery"],
      [st.inTransit, "in-transit"],
      [st.ReceivedAtPoint, "received-at-point"],
      [st.Pick, "picked-up"],
    ];
    const status = stages.find(([v]) => v && String(v).trim())?.[1] || data?.success?.message || "pending";
    return {
      success: true,
      courier: "paperfly",
      tracking_code: trackingCode,
      status,
      updated_at: new Date().toISOString(),
      raw_response: data,
    };
  }

  async getBalance(): Promise<BalanceResponse> {
    throw new Error(
      "Paperfly does not expose a merchant balance endpoint via its public API — check the Paperfly merchant panel."
    );
  }
}
