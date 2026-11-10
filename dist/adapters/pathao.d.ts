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
    private cityCache;
    private zoneCache;
    private areaCache;
    constructor(clientId: string, clientSecret: string, username: string, password: string, storeId?: string, baseUrl?: string);
    isConfigured(): boolean;
    private getAuthToken;
    private getClient;
    /**
     * Dynamically resolve merchant store_id from Pathao portal if missing or default
     */
    private resolveStoreId;
    /**
     * DeepMind Intelligent Spatial Hierarchy Resolver for Pathao
     * Eliminates 422 Unprocessable Entity by matching address tokens against live Pathao geo catalog
     */
    resolveLocation(address: string, req?: ParcelCreateRequest): Promise<{
        cityId: number;
        zoneId: number;
        areaId?: number;
    }>;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string): Promise<TrackingResponse>;
    /**
     * Pathao does not expose a live wallet balance API endpoint (T3).
     * Returns amount_bdt: null, current_balance: null, status: UNSUPPORTED_BY_PROVIDER.
     */
    getBalance(): Promise<BalanceResponse>;
    /**
     * 100% Real Live Pathao Nationwide Customer Delivery Success API
     * Endpoint: POST /aladdin/api/v1/user/success
     */
    fraudCheck(phone: string): Promise<any>;
    getLocations(cityName?: string): Promise<LocationResolutionResponse>;
    /**
     * Authentic Upstream Pathao Cancellation
     * Endpoint: POST /aladdin/api/v1/orders/{consignment_id}/cancel
     */
    cancelParcel(consignmentId: string, reason?: string): Promise<{
        success: boolean;
        courier: SupportedCourier;
        consignment_id: string;
        message: string;
        raw_response?: any;
    }>;
}
