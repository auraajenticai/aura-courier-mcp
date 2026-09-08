import { SteadfastAdapter } from "./adapters/steadfast.js";
import { PathaoAdapter } from "./adapters/pathao.js";
import { FraudRiskEngine } from "./adapters/fraud_engine.js";
import { RedxAdapter } from "./adapters/redx.js";
import { PaperflyAdapter } from "./adapters/paperfly.js";
import { loadConfig } from "./config.js";
export class CourierRegistry {
    adapters = new Map();
    constructor(config = loadConfig()) {
        const steadfast = new SteadfastAdapter(config.steadfast.apiKey, config.steadfast.secretKey, config.steadfast.baseUrl);
        this.adapters.set("steadfast", steadfast);
        const pathao = new PathaoAdapter(config.pathao.clientId, config.pathao.clientSecret, config.pathao.username, config.pathao.password, config.pathao.storeId, config.pathao.baseUrl);
        this.adapters.set("pathao", pathao);
        const redx = new RedxAdapter(config.redx.apiToken, config.redx.baseUrl, config.redx.pickupStoreId);
        this.adapters.set("redx", redx);
        const paperfly = new PaperflyAdapter(config.paperfly.apiKey, config.paperfly.username, config.paperfly.password, config.paperfly.storeName, config.paperfly.baseUrl);
        this.adapters.set("paperfly", paperfly);
    }
    listCouriers() {
        return Array.from(this.adapters.entries()).map(([name, adapter]) => ({
            courier: name,
            is_configured: adapter.isConfigured(),
        }));
    }
    getAdapter(name) {
        const adapter = this.adapters.get(name);
        if (!adapter) {
            throw new Error(`Courier '${name}' is not supported yet.`);
        }
        return adapter;
    }
    async createParcel(req) {
        let courierName = "steadfast";
        if (req.courier && req.courier !== "auto") {
            courierName = req.courier;
        }
        else {
            // Smart routing heuristic
            const addr = req.recipient_address.toLowerCase();
            if (addr.includes("dhaka") &&
                (addr.includes("gulshan") ||
                    addr.includes("banani") ||
                    addr.includes("dhanmondi") ||
                    addr.includes("uttara") ||
                    addr.includes("mirpur"))) {
                courierName = this.adapters.get("pathao")?.isConfigured() ? "pathao" : "steadfast";
            }
            else {
                courierName = "steadfast";
            }
        }
        const adapter = this.getAdapter(courierName);
        return await adapter.createParcel(req);
    }
    async trackParcel(trackingCode, courierName) {
        if (courierName) {
            return await this.getAdapter(courierName).trackParcel(trackingCode);
        }
        // Default try Steadfast first
        try {
            return await this.getAdapter("steadfast").trackParcel(trackingCode);
        }
        catch {
            return await this.getAdapter("pathao").trackParcel(trackingCode);
        }
    }
    async getBalance(courierName) {
        return await this.getAdapter(courierName).getBalance();
    }
    checkFraudRisk(phone) {
        return FraudRiskEngine.evaluateRisk(phone);
    }
}
