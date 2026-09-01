import { CourierAdapter } from "./adapters/base.js";
import { BalanceResponse, FraudRiskScoreResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse } from "./types.js";
export declare class CourierRegistry {
    private adapters;
    constructor();
    listCouriers(): {
        courier: SupportedCourier;
        is_configured: boolean;
    }[];
    getAdapter(name: SupportedCourier): CourierAdapter;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string, courierName?: SupportedCourier): Promise<TrackingResponse>;
    getBalance(courierName: SupportedCourier): Promise<BalanceResponse>;
    checkFraudRisk(phone: string): FraudRiskScoreResponse;
}
