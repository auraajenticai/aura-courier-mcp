import { BalanceResponse, LocationResolutionResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse } from "../types.js";
export interface CourierAdapter {
    courierName: SupportedCourier;
    isConfigured(): boolean;
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string): Promise<TrackingResponse>;
    getBalance(): Promise<BalanceResponse>;
    getLocations?(cityName?: string, zoneName?: string): Promise<LocationResolutionResponse>;
}
