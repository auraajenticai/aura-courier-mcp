import axios, { AxiosInstance } from "axios";
import { CourierAdapter } from "./base.js";
import { McpToolError } from "../envelope.js";
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
    this.enabled = Boolean(apiKey && username && password);
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
      throw new Error("Paperfly credentials (paperflykey + merchant username & password) are not configured.");
    }
    if (!this.storeName) {
      throw new Error("Paperfly store name is required to create a parcel.");
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
      auth: { username: this.username, password: this.password },
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
      throw new McpToolError({
        code: "COURIER_NOT_CONFIGURED",
        message: "Paperfly credentials are not configured.",
        courier: "paperfly",
      });
    }
    if (!this.username || !this.password) {
      throw new McpToolError({
        code: "COURIER_NOT_CONFIGURED",
        message: "Paperfly tracking requires merchant-panel username and password.",
        courier: "paperfly",
      });
    }
    try {
      const response = await this.client.post(
        "/API-Order-Tracking",
        { ReferenceNumber: trackingCode },
        { headers: { paperflykey: this.apiKey }, auth: { username: this.username, password: this.password } }
      );
      const data = response.data;
      if (data?.error) {
        throw new McpToolError({
          code: "CONSIGNMENT_NOT_FOUND",
          message: `Consignment '${trackingCode}' was not found in Paperfly.`,
          retryable: false,
          courier: "paperfly",
        });
      }
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
    } catch (err: any) {
      if (err instanceof McpToolError) throw err;
      if (err?.response?.status === 400 || err?.response?.status === 404) {
        throw new McpToolError({
          code: "CONSIGNMENT_NOT_FOUND",
          message: `Consignment '${trackingCode}' was not found in Paperfly.`,
          retryable: false,
          courier: "paperfly",
        });
      }
      throw err;
    }
  }

  /**
   * Paperfly does not expose a live wallet balance API endpoint (T3).
   */
  async getBalance(): Promise<BalanceResponse> {
    return {
      success: true,
      courier: "paperfly",
      amount_bdt: null,
      pending_bdt: null,
      current_balance: null,
      status: "UNSUPPORTED_BY_PROVIDER",
      hint: "Use Paperfly merchant portal",
    };
  }
}
