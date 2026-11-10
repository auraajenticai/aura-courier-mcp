import { FraudRiskScoreResponse } from "../types.js";
import { SteadfastAdapter } from "./steadfast.js";
import { PathaoAdapter } from "./pathao.js";
export declare class FraudRiskEngine {
    /**
     * 100% Real Live Multi-Carrier Fraud & Delivery Risk Evaluation
     * Queries Pathao Nationwide Customer Delivery Database (/aladdin/api/v1/user/success)
     * and Steadfast Nationwide Logistics Database (/fraud_check/{phone})
     */
    static evaluateRisk(phoneNumber: string, steadfastAdapter?: SteadfastAdapter, pathaoAdapter?: PathaoAdapter): Promise<FraudRiskScoreResponse>;
}
