import { FraudRiskScoreResponse } from "../types.js";
import { SteadfastAdapter } from "./steadfast.js";
import { PathaoAdapter } from "./pathao.js";
import { CourierConfig } from "../config.js";
export declare class FraudRiskEngine {
    private static checkSteadfastWeb;
    private static checkRedxNationwide;
    private static checkPaperflySmartCheck;
    private static checkCarrybee;
    private static checkEcourier;
    /**
     * Real-Time All-Bangladesh Multi-Carrier Fraud & Delivery Risk Evaluation (v2.7.4)
     * Executes parallel live lookups across Steadfast, Pathao, RedX, Paperfly, CarryBee, eCourier & ParcelDex.
     * Strictly Zero Mock Data: non-connected or inactive carrier accounts return `null` counts with transparent status.
     */
    static evaluateRisk(phoneNumber: string, steadfastAdapter?: SteadfastAdapter, pathaoAdapter?: PathaoAdapter, config?: CourierConfig): Promise<FraudRiskScoreResponse>;
}
