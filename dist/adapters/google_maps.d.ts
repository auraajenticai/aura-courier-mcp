import { AddressValidationRequest, AddressValidationResponse, CourierRateComparisonRequest, CourierRateComparisonResponse, ZoneRateRequest, ZoneRateResponse } from "../types.js";
export declare class GoogleMapsAdapter {
    private apiKey;
    private defaultHub;
    constructor(apiKey?: string);
    isConfigured(): boolean;
    /**
     * Validate and Geocode Bangladesh Address using Google Maps Geocoding API
     */
    validateAndGeocode(req: AddressValidationRequest): Promise<AddressValidationResponse>;
    /**
     * Compute Road Distance & Classify Delivery Zone via Google Routes API
     */
    calculateDeliveryZoneAndFee(req: ZoneRateRequest): Promise<ZoneRateResponse>;
    /**
     * Enterprise Multi-Carrier Rate Comparison (Steadfast vs Pathao vs RedX vs Paperfly)
     */
    compareRates(req: CourierRateComparisonRequest): Promise<CourierRateComparisonResponse>;
    private fallbackAddressParse;
    private haversineDistance;
}
