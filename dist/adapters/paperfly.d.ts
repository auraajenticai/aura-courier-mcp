import { CourierAdapter } from "./base.js";
import { BalanceResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse } from "../types.js";
export declare class PaperflyAdapter implements CourierAdapter {
    courierName: SupportedCourier;
    private client;
    private user;
    private pass;
    private key;
    private enabled;
    constructor(user: string, pass: string, key: string, baseUrl?: string);
    isConfigured(): boolean;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string): Promise<TrackingResponse>;
    getBalance(): Promise<BalanceResponse>;
}
