import { FraudRiskScoreResponse } from "../types.js";
import { SteadfastAdapter } from "./steadfast.js";
export declare class FraudRiskEngine {
    /**
     * 100% Real Live Courier Fraud & Delivery Risk Evaluation
     * Connects to Steadfast Nationwide Logistics Database (covers millions of BD consignments)
     */
    static evaluateRisk(phoneNumber: string, steadfastAdapter?: SteadfastAdapter): Promise<FraudRiskScoreResponse>;
}
