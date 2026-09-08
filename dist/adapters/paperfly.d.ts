import { CourierAdapter } from "./base.js";
import { BalanceResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse } from "../types.js";
export declare class PaperflyAdapter implements CourierAdapter {
    courierName: SupportedCourier;
    private apiKey;
    private username;
    private password;
    private storeName;
    private client;
    private enabled;
    constructor(apiKey: string, username: string, password: string, storeName: string, baseUrl: string);
    isConfigured(): boolean;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string): Promise<TrackingResponse>;
    getBalance(): Promise<BalanceResponse>;
}
