import { CourierAdapter } from "./base.js";
import { BalanceResponse, LocationResolutionResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse } from "../types.js";
export declare class PathaoAdapter implements CourierAdapter {
    courierName: SupportedCourier;
    private clientId;
    private clientSecret;
    private username;
    private password;
    private storeId;
    private baseUrl;
    private accessToken;
    private tokenExpiresAt;
    constructor(clientId: string, clientSecret: string, username: string, password: string, storeId: string, baseUrl: string);
    isConfigured(): boolean;
    private getAuthToken;
    private getClient;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string): Promise<TrackingResponse>;
    getBalance(): Promise<BalanceResponse>;
    getLocations(cityName?: string): Promise<LocationResolutionResponse>;
}
