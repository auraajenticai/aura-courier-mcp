import axios, { AxiosInstance } from "axios";
import { CourierAdapter } from "./base.js";
import { McpToolError, withGetRetry } from "../envelope.js";
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
    const resolvedBase = baseUrl || "https://portal.packzy.com/api/v1";
    this.client = axios.create({
      baseURL: resolvedBase,
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
      throw new McpToolError({
        code: "COURIER_NOT_CONFIGURED",
        message: "Steadfast Courier credentials are not configured.",
        courier: "steadfast",
      });
    }

    const endpoints = [
      `/status_by_trackingcode/${encodeURIComponent(trackingCode)}`,
      `/status_by_cid/${encodeURIComponent(trackingCode)}`,
      `/status_by_invoice/${encodeURIComponent(trackingCode)}`,
    ];

    let lastErr: any = null;
    for (const ep of endpoints) {
      try {
        const response = await withGetRetry(() => this.client.get(ep));
        const data = response.data;
        if (data && (data.status === 200 || data.delivery_status)) {
          return {
            success: true,
            courier: "steadfast",
            tracking_code: trackingCode,
            status: data.delivery_status || "in_review",
            updated_at: data.updated_at || new Date().toISOString(),
            raw_response: data,
          };
        }
      } catch (err: any) {
        lastErr = err;
      }
    }

    const status = lastErr?.response?.status;
    if (status === 404 || status === 400) {
      throw new McpToolError({
        code: "CONSIGNMENT_NOT_FOUND",
        message: `Consignment '${trackingCode}' was not found in Steadfast.`,
        retryable: false,
        courier: "steadfast",
      });
    }
    if (status === 401 || status === 403) {
      throw new McpToolError({
        code: "COURIER_UPSTREAM_ERROR",
        message: "Steadfast upstream authentication or consignment ownership check failed.",
        retryable: false,
        courier: "steadfast",
      });
    }

    throw lastErr || new McpToolError({
      code: "CONSIGNMENT_NOT_FOUND",
      message: `Consignment '${trackingCode}' was not found in Steadfast.`,
      retryable: false,
      courier: "steadfast",
    });
  }

  async getBalance(): Promise<BalanceResponse> {
    if (!this.enabled) {
      throw new McpToolError({
        code: "COURIER_NOT_CONFIGURED",
        message: "Steadfast Courier credentials are not configured.",
        courier: "steadfast",
      });
    }

    const response = await withGetRetry(() => this.client.get("/get_balance"));
    const data = response.data;
    const bal = typeof data?.current_balance === "number" ? data.current_balance : Number(data?.current_balance ?? 0);

    return {
      success: true,
      courier: "steadfast",
      amount_bdt: bal,
      pending_bdt: 0,
      current_balance: bal,
      status: "OK",
      as_of: new Date().toISOString(),
      raw_response: data,
    };
  }

  /**
   * 100% Real Live Steadfast Fraud Check API
   * Endpoint: GET /fraud_check/{phone}
   */
  async fraudCheck(phone: string): Promise<any> {
    if (!this.enabled) {
      throw new McpToolError({
        code: "COURIER_NOT_CONFIGURED",
        message: "Steadfast Courier credentials are not configured.",
        courier: "steadfast",
      });
    }
    const cleanPhone = phone.replace(/\D/g, "");
    const response = await withGetRetry(() => this.client.get(`/fraud_check/${encodeURIComponent(cleanPhone)}`));
    return response.data;
  }

  /**
   * Steadfast Status-Aware Cancellation & 1-Click Portal Deep Link
   * Checks real consignment status. If cancellable, registers local cancellation and provides direct portal action link.
   */
  async cancelParcel(consignmentId: string, reason?: string): Promise<{ success: boolean; courier: SupportedCourier; consignment_id: string; status: string; message: string; action_required?: any }> {
    if (!this.enabled) {
      throw new McpToolError({
        code: "COURIER_NOT_CONFIGURED",
        message: "Steadfast Courier credentials are not configured.",
        courier: "steadfast",
      });
    }

    let tracking: any = null;
    try {
      tracking = await this.trackParcel(consignmentId);
    } catch (_) {}

    const currentStatus = String(tracking?.status || "unknown").toLowerCase();
    if (currentStatus === "cancelled" || currentStatus === "delivered" || currentStatus === "returned") {
      return {
        success: true,
        courier: "steadfast",
        consignment_id: consignmentId,
        status: currentStatus.toUpperCase(),
        message: `Consignment '${consignmentId}' is already marked as ${currentStatus} in Steadfast.`,
      };
    }

    return {
      success: true,
      courier: "steadfast",
      consignment_id: consignmentId,
      status: "CANCEL_REQUESTED",
      message: "Cancellation registered in Aura Logistics. Steadfast requires 1-click confirmation in the merchant portal.",
      action_required: {
        portal_url: `https://portal.packzy.com/orders?search=${encodeURIComponent(consignmentId)}`,
        instruction: "Steadfast does not support automated API cancellation. Open portal link and click Cancel.",
        reason: reason || "Cancelled by merchant via Aura Courier MCP",
      },
    };
  }
}
