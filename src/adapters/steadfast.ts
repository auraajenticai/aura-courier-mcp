/**
 * Steadfast (Packzy) adapter.
 *
 * Docs: base https://portal.packzy.com/api/v1
 * Auth: headers `Api-Key` + `Secret-Key`.
 * Endpoints used: POST /create_order, GET /status_by_cid|invoice|trackingcode, GET /get_balance
 *
 * Built to the documented Steadfast Courier Limited API v1.
 */
import { CourierError, type CourierAdapter } from "./base.js";
import type {
  BalanceResult,
  CreateParcelInput,
  Parcel,
  ParcelStatus,
  TrackRef,
  TrackingResult,
} from "../types.js";

const BASE_URL = "https://portal.packzy.com/api/v1";

/** Map Steadfast's `delivery_status` / consignment `status` strings to our normalized status. */
export function mapSteadfastStatus(raw: string | undefined): ParcelStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "pending":
      return "pending";
    case "in_review":
      return "in_review";
    case "hold":
      return "on_hold";
    case "delivered":
    case "delivered_approval_pending":
      return "delivered";
    case "partial_delivered":
    case "partial_delivered_approval_pending":
      return "partial_delivered";
    case "cancelled":
    case "cancelled_approval_pending":
      return "cancelled";
    case "returned":
      return "returned";
    case "unknown":
    case "unknown_approval_pending":
      return "unknown";
    default:
      return "unknown";
  }
}

interface SteadfastConfig {
  apiKey: string;
  secretKey: string;
}

export class SteadfastAdapter implements CourierAdapter {
  readonly id = "steadfast" as const;
  readonly label = "Steadfast Courier";

  constructor(private readonly cfg: Partial<SteadfastConfig>) {}

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey && this.cfg.secretKey);
  }

  private headers(): Record<string, string> {
    if (!this.isConfigured()) {
      throw new CourierError(
        "not_configured",
        "Steadfast is not configured — set STEADFAST_API_KEY and STEADFAST_SECRET_KEY.",
      );
    }
    return {
      "Api-Key": this.cfg.apiKey!,
      "Secret-Key": this.cfg.secretKey!,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    // Resolve headers BEFORE the try so a not_configured error propagates
    // cleanly instead of being masked as a network_error.
    const headers = this.headers();
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
    } catch (err) {
      throw new CourierError("network_error", `Could not reach Steadfast: ${String(err)}`);
    }
    const text = await res.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new CourierError("bad_response", `Steadfast returned non-JSON (HTTP ${res.status}).`, text);
    }
    if (!res.ok) {
      throw new CourierError(
        "api_error",
        `Steadfast API error (HTTP ${res.status}): ${body?.message ?? "unknown"}`,
        body,
      );
    }
    return body;
  }

  async createParcel(input: CreateParcelInput): Promise<Parcel> {
    const body = await this.request("/create_order", {
      method: "POST",
      body: JSON.stringify({
        invoice: input.invoice,
        recipient_name: input.recipientName,
        recipient_phone: input.recipientPhone,
        recipient_address: input.recipientAddress,
        cod_amount: input.codAmount,
        note: input.note ?? input.itemDescription ?? "",
      }),
    });

    const c = body?.consignment;
    if (!c) {
      throw new CourierError("bad_response", "Steadfast did not return a consignment.", body);
    }
    return {
      courier: this.id,
      consignmentId: String(c.consignment_id ?? ""),
      trackingCode: String(c.tracking_code ?? ""),
      invoice: String(c.invoice ?? input.invoice),
      status: mapSteadfastStatus(c.status),
      codAmount: Number(c.cod_amount ?? input.codAmount),
      recipientName: String(c.recipient_name ?? input.recipientName),
      recipientPhone: String(c.recipient_phone ?? input.recipientPhone),
      raw: c,
    };
  }

  async track(ref: TrackRef): Promise<TrackingResult> {
    let path: string;
    let reference: string;
    if (ref.consignmentId) {
      path = `/status_by_cid/${encodeURIComponent(ref.consignmentId)}`;
      reference = ref.consignmentId;
    } else if (ref.invoice) {
      path = `/status_by_invoice/${encodeURIComponent(ref.invoice)}`;
      reference = ref.invoice;
    } else if (ref.trackingCode) {
      path = `/status_by_trackingcode/${encodeURIComponent(ref.trackingCode)}`;
      reference = ref.trackingCode;
    } else {
      throw new CourierError(
        "bad_input",
        "Provide one of: consignmentId, invoice, or trackingCode.",
      );
    }

    const body = await this.request(path, { method: "GET" });
    return {
      courier: this.id,
      reference,
      status: mapSteadfastStatus(body?.delivery_status),
      raw: body,
    };
  }

  async getBalance(): Promise<BalanceResult> {
    const body = await this.request("/get_balance", { method: "GET" });
    return {
      courier: this.id,
      currentBalance: Number(body?.current_balance ?? 0),
      currency: "BDT",
    };
  }
}
