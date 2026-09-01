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
}
