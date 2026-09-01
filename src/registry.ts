import { CourierAdapter } from "./adapters/base.js";
import { SteadfastAdapter } from "./adapters/steadfast.js";
import { PathaoAdapter } from "./adapters/pathao.js";
import { RedXAdapter } from "./adapters/redx.js";
import { PaperflyAdapter } from "./adapters/paperfly.js";
import { FraudRiskEngine } from "./adapters/fraud_engine.js";
import { loadConfig } from "./config.js";
import {
  BalanceResponse,
  FraudRiskScoreResponse,
  ParcelCreateRequest,
  ParcelResponse,
  SupportedCourier,
  TrackingResponse,
} from "./types.js";

export class CourierRegistry {
  private adapters: Map<SupportedCourier, CourierAdapter> = new Map();

  constructor() {
    const config = loadConfig();

    const steadfast = new SteadfastAdapter(
      config.steadfast.apiKey,
      config.steadfast.secretKey,
      config.steadfast.baseUrl
    );
    this.adapters.set("steadfast", steadfast);

    const pathao = new PathaoAdapter(
      config.pathao.clientId,
      config.pathao.clientSecret,
      config.pathao.username,
      config.pathao.password,
      config.pathao.storeId,
      config.pathao.baseUrl
    );
    this.adapters.set("pathao", pathao);

    const redx = new RedXAdapter(config.redx.apiToken, config.redx.baseUrl);
    this.adapters.set("redx", redx);

    const paperfly = new PaperflyAdapter(
      config.paperfly.user,
      config.paperfly.pass,
      config.paperfly.key,
      config.paperfly.baseUrl
    );
    this.adapters.set("paperfly", paperfly);
  }

  listCouriers() {
    return Array.from(this.adapters.entries()).map(([name, adapter]) => ({
      courier: name,
      is_configured: adapter.isConfigured(),
    }));
  }

  getAdapter(name: SupportedCourier): CourierAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`Courier '${name}' is not supported yet.`);
    }
    return adapter;
  }

  async createParcel(req: ParcelCreateRequest): Promise<ParcelResponse> {
    let courierName: SupportedCourier = "steadfast";

    if (req.courier && req.courier !== "auto") {
      courierName = req.courier;
    } else {
      // Smart routing heuristic across all 4 couriers
      const addr = req.recipient_address.toLowerCase();
      if (
        addr.includes("dhaka") &&
        (addr.includes("gulshan") ||
          addr.includes("banani") ||
          addr.includes("dhanmondi") ||
          addr.includes("uttara") ||
          addr.includes("mirpur"))
      ) {
        if (this.adapters.get("pathao")?.isConfigured()) {
          courierName = "pathao";
        } else if (this.adapters.get("redx")?.isConfigured()) {
          courierName = "redx";
        } else {
          courierName = "steadfast";
        }
      } else {
        if (this.adapters.get("steadfast")?.isConfigured()) {
          courierName = "steadfast";
        } else if (this.adapters.get("paperfly")?.isConfigured()) {
          courierName = "paperfly";
        } else {
          courierName = "steadfast";
        }
      }
    }

    const adapter = this.getAdapter(courierName);
    return await adapter.createParcel(req);
  }

  async trackParcel(trackingCode: string, courierName?: SupportedCourier): Promise<TrackingResponse> {
    if (courierName) {
      return await this.getAdapter(courierName).trackParcel(trackingCode);
    }

    // Smart fallback across available configured adapters
    const order: SupportedCourier[] = ["steadfast", "pathao", "redx", "paperfly"];
    let lastError: any = null;

    for (const c of order) {
      const adapter = this.adapters.get(c);
      if (adapter && adapter.isConfigured()) {
        try {
          return await adapter.trackParcel(trackingCode);
        } catch (e) {
          lastError = e;
        }
      }
    }

    // Default fallback to Steadfast
    try {
      return await this.getAdapter("steadfast").trackParcel(trackingCode);
    } catch {
      throw lastError || new Error(`Could not find tracking info for ${trackingCode}`);
    }
  }

  async getBalance(courierName: SupportedCourier): Promise<BalanceResponse> {
    return await this.getAdapter(courierName).getBalance();
  }

  checkFraudRisk(phone: string): FraudRiskScoreResponse {
    return FraudRiskEngine.evaluateRisk(phone);
  }
}
