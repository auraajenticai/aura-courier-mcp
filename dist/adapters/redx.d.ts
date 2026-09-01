import { CourierAdapter } from "./base.js";
import { BalanceResponse, LocationResolutionResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse } from "../types.js";
export declare class RedXAdapter implements CourierAdapter {
    courierName: SupportedCourier;
    private client;
    private apiToken;
    private enabled;
    constructor(apiToken: string, baseUrl?: string);
    isConfigured(): boolean;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string): Promise<TrackingResponse>;
    getBalance(): Promise<BalanceResponse>;
    getLocations(cityName?: string): Promise<LocationResolutionResponse>;
}
