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
     * RedX does not expose a live wallet balance API endpoint (T3).
     */
    getBalance(): Promise<BalanceResponse>;
}
