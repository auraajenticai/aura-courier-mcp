import { AddressValidationRequest, AddressValidationResponse, CourierRateComparisonRequest, CourierRateComparisonResponse, ZoneRateRequest, ZoneRateResponse } from "../types.js";
export declare class GoogleMapsAdapter {
    private apiKey;
    private defaultHub;
    constructor(apiKey?: string);
    isConfigured(): boolean;
    /**
     * Evaluate road/house/area token match quality and review warnings (T5)
     */
    private buildQualityAssessment;
    /**
     * Validate and Geocode Bangladesh Address using Google Maps Geocoding API (T5)
     */
    validateAndGeocode(req: AddressValidationRequest): Promise<AddressValidationResponse>;
    /**
     * Compute Road Distance & Classify Delivery Zone from Single Tariff Source of Truth (T4)
     */
    calculateDeliveryZoneAndFee(req: ZoneRateRequest): Promise<ZoneRateResponse>;
    /**
     * Multi-Carrier Rate Comparison backed by Single Tariff Source of Truth (T4)
     */
    compareRates(req: CourierRateComparisonRequest): Promise<CourierRateComparisonResponse>;
    private fallbackAddressParse;
    private haversineDistance;
}
