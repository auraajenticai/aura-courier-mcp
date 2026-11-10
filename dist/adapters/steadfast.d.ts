import { CourierAdapter } from "./base.js";
import { BalanceResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse } from "../types.js";
export declare class SteadfastAdapter implements CourierAdapter {
    courierName: SupportedCourier;
    private client;
    private enabled;
    constructor(apiKey: string, secretKey: string, baseUrl: string);
    isConfigured(): boolean;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string): Promise<TrackingResponse>;
    getBalance(): Promise<BalanceResponse>;
    /**
     * 100% Real Live Steadfast Fraud Check API
     * Endpoint: GET /fraud_check/{phone}
     */
    fraudCheck(phone: string): Promise<any>;
    /**
     * Steadfast Status-Aware Cancellation & 1-Click Portal Deep Link
     * Checks real consignment status. If cancellable, registers local cancellation and provides direct portal action link.
     */
    cancelParcel(consignmentId: string, reason?: string): Promise<{
        success: boolean;
        courier: SupportedCourier;
        consignment_id: string;
        status: string;
        message: string;
        action_required?: any;
    }>;
}
