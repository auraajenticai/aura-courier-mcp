import { CourierAdapter } from "./base.js";
import { BalanceResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse } from "../types.js";
export declare class RedxAdapter implements CourierAdapter {
    courierName: SupportedCourier;
    private client;
    private enabled;
    private pickupStoreId;
    constructor(apiToken: string, baseUrl: string, pickupStoreId?: string);
    isConfigured(): boolean;
    private resolveDeliveryArea;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string): Promise<TrackingResponse>;
    /**
     * 100% Live RedX Merchant Account & Pickup Store Verification + Settlement Status
     * Queries GET /pickup/stores on RedX OpenAPI v1.0.0-beta
     */
    getBalance(): Promise<BalanceResponse>;
}
