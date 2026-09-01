import { FraudRiskScoreResponse } from "../types.js";
export declare class FraudRiskEngine {
    static evaluateRisk(phoneNumber: string): FraudRiskScoreResponse;
}
