import { FraudRiskScoreResponse } from "../types.js";
import { SteadfastAdapter } from "./steadfast.js";
import { PathaoAdapter } from "./pathao.js";
export declare class FraudRiskEngine {
    /**
     * Real-Time Multi-Carrier Fraud & Delivery Risk Evaluation (T6)
     * Queries Pathao Nationwide Customer Delivery Database (/aladdin/api/v1/user/success),
     * Steadfast Nationwide Logistics Database (/fraud_check/{phone}), and BD Operator Prefix Validator.
     */
    static evaluateRisk(phoneNumber: string, steadfastAdapter?: SteadfastAdapter, pathaoAdapter?: PathaoAdapter): Promise<FraudRiskScoreResponse>;
}
