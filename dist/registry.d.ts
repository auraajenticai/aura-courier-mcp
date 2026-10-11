import { CourierAdapter } from "./adapters/base.js";
import { GoogleMapsAdapter } from "./adapters/google_maps.js";
import { CourierConfig } from "./config.js";
import { AddressValidationRequest, AddressValidationResponse, BalanceResponse, CourierRateComparisonRequest, CourierRateComparisonResponse, FraudRiskScoreResponse, NdrResolutionRequest, NdrResolutionResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse, ZoneRateRequest, ZoneRateResponse } from "./types.js";
export declare class CourierRegistry {
    private adapters;
    private googleMaps;
    constructor(config?: CourierConfig);
    listCouriers(): {
        courier: SupportedCourier;
        is_configured: boolean;
    }[];
    getAdapter(name: SupportedCourier): CourierAdapter;
    getGoogleMaps(): GoogleMapsAdapter;
    resolveSmartAutoCourierOrder(address: string, priority?: string): SupportedCourier[];
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string, courierName?: SupportedCourier): Promise<TrackingResponse>;
    getBalance(courierName: SupportedCourier): Promise<BalanceResponse>;
    checkFraudRisk(phone: string): Promise<FraudRiskScoreResponse>;
    validateAddress(req: AddressValidationRequest): Promise<AddressValidationResponse>;
    calculateZoneAndRate(req: ZoneRateRequest): Promise<ZoneRateResponse>;
    compareRates(req: CourierRateComparisonRequest): Promise<CourierRateComparisonResponse>;
    resolveNdr(req: NdrResolutionRequest): Promise<NdrResolutionResponse>;
}
