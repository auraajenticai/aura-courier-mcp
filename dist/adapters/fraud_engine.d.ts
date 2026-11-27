import { FraudRiskScoreResponse } from "../types.js";
import { SteadfastAdapter } from "./steadfast.js";
import { PathaoAdapter } from "./pathao.js";
import { CourierConfig } from "../config.js";
export declare class FraudRiskEngine {
    private static checkSteadfastWeb;
    private static checkRedxNationwide;
    private static checkPaperflySmartCheck;
    /**
     * Real-Time Official 4-Courier Fraud & Delivery Risk Evaluation (v2.7.5)
     * Executes parallel live lookups across Aura Courier MCP's 4 official carriers:
     * Steadfast, Pathao, RedX, and Paperfly (plus verified PostgreSQL consignment history).
     * Strictly Zero Mock Data: non-queried or zero-record carrier APIs return `null` counts with clean SaaS status.
     */
    static evaluateRisk(phoneNumber: string, steadfastAdapter?: SteadfastAdapter, pathaoAdapter?: PathaoAdapter, config?: CourierConfig, dbPool?: any): Promise<FraudRiskScoreResponse>;
}
