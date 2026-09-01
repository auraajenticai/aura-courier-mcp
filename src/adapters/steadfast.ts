import axios, { AxiosInstance } from "axios";
import { CourierAdapter } from "./base.js";
import {
  BalanceResponse,
  ParcelCreateRequest,
  ParcelResponse,
  SupportedCourier,
  TrackingResponse,
} from "../types.js";

export class SteadfastAdapter implements CourierAdapter {
  courierName: SupportedCourier = "steadfast";
  private client: AxiosInstance;
  private enabled: boolean;

  constructor(apiKey: string, secretKey: string, baseUrl: string) {
    this.enabled = Boolean(apiKey && secretKey);
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        "Api-Key": apiKey,
        "Secret-Key": secretKey,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
  }

  isConfigured(): boolean {
    return this.enabled;
  }

  async createParcel(req: ParcelCreateRequest): Promise<ParcelResponse> {
    if (!this.enabled) {
      throw new Error("Steadfast Courier credentials (API-Key / Secret-Key) are not configured.");
    }

    const payload = {
      invoice: req.invoice,
      recipient_name: req.recipient_name,
      recipient_phone: req.recipient_phone,
      recipient_address: req.recipient_address,
      cod_amount: req.cod_amount,
      note: req.note || "Aura AI automated dispatch",
    };

    const response = await this.client.post("/create_order", payload);
    const data = response.data;

    if (data.status !== 200 && data.status !== "success") {
      throw new Error(`Steadfast API error: ${JSON.stringify(data.errors || data.message || data)}`);
    }

    const consignment = data.consignment || {};

    return {
      success: true,
      courier: "steadfast",
      tracking_code: consignment.tracking_code || String(consignment.consignment_id),
      consignment_id: consignment.consignment_id,
      invoice: consignment.invoice || req.invoice,
      status: consignment.status || "in_review",
      cod_amount: req.cod_amount,
      delivery_fee: consignment.delivery_fee,
      created_at: consignment.created_at || new Date().toISOString(),
      raw_response: data,
    };
  }

  async trackParcel(trackingCode: string): Promise<TrackingResponse> {
    if (!this.enabled) {
      throw new Error("Steadfast Courier credentials are not configured.");
    }

    const response = await this.client.get(`/status_by_trackingcode/${encodeURIComponent(trackingCode)}`);
    const data = response.data;

    return {
      success: true,
      courier: "steadfast",
      tracking_code: trackingCode,
      status: data.delivery_status || "unknown",
      updated_at: data.updated_at || new Date().toISOString(),
      raw_response: data,
    };
  }

  async getBalance(): Promise<BalanceResponse> {
    if (!this.enabled) {
      throw new Error("Steadfast Courier credentials are not configured.");
    }

    const response = await this.client.get("/get_balance");
    const data = response.data;

    return {
      success: true,
      courier: "steadfast",
      current_balance: Number(data.current_balance || 0),
      raw_response: data,
    };
  }
}
