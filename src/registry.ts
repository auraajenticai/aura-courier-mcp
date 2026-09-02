import { CourierAdapter } from "./adapters/base.js";
import { SteadfastAdapter } from "./adapters/steadfast.js";
import { PathaoAdapter } from "./adapters/pathao.js";
import { FraudRiskEngine } from "./adapters/fraud_engine.js";
import { RedxAdapter } from "./adapters/redx.js";
import { loadConfig, CourierConfig } from "./config.js";
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

  constructor(config: CourierConfig = loadConfig()) {
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

    const redx = new RedxAdapter(config.redx.apiToken, config.redx.baseUrl, config.redx.pickupStoreId);
    this.adapters.set("redx", redx);
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
      // Smart routing heuristic
      const addr = req.recipient_address.toLowerCase();
      if (
        addr.includes("dhaka") &&
        (addr.includes("gulshan") ||
          addr.includes("banani") ||
          addr.includes("dhanmondi") ||
          addr.includes("uttara") ||
          addr.includes("mirpur"))
      ) {
        courierName = this.adapters.get("pathao")?.isConfigured() ? "pathao" : "steadfast";
      } else {
        courierName = "steadfast";
      }
    }

    const adapter = this.getAdapter(courierName);
    return await adapter.createParcel(req);
  }

  async trackParcel(trackingCode: string, courierName?: SupportedCourier): Promise<TrackingResponse> {
    if (courierName) {
      return await this.getAdapter(courierName).trackParcel(trackingCode);
    }

    // Default try Steadfast first
    try {
      return await this.getAdapter("steadfast").trackParcel(trackingCode);
    } catch {
      return await this.getAdapter("pathao").trackParcel(trackingCode);
    }
  }

  async getBalance(courierName: SupportedCourier): Promise<BalanceResponse> {
    return await this.getAdapter(courierName).getBalance();
  }

  checkFraudRisk(phone: string): FraudRiskScoreResponse {
    return FraudRiskEngine.evaluateRisk(phone);
  }
}
