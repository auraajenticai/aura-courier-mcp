import { CourierAdapter } from "./adapters/base.js";
import { GoogleMapsAdapter } from "./adapters/google_maps.js";
import { CourierConfig } from "./config.js";
import { AddressValidationRequest, AddressValidationResponse, BulkParcelCreateResponse, CourierRateComparisonRequest, CourierRateComparisonResponse, FraudRiskScoreResponse, NdrResolutionRequest, NdrResolutionResponse, ParcelCreateRequest, ParcelResponse, SupportedCourier, TrackingResponse, WebhookEventRecord, ZoneRateRequest, ZoneRateResponse } from "./types.js";
export declare function clearIdempotencyStore(): void;
export declare function recordWebhookEvent(event: WebhookEventRecord, tenantId?: string): void;
export declare function clearWebhookEvents(tenantId?: string): void;
export declare class CourierRegistry {
    private adapters;
    private googleMaps;
    constructor(config?: CourierConfig);
    listCouriers(): {
        couriers: {
            courier: SupportedCourier;
            is_configured: boolean;
        }[];
        configured_count: number;
    };
    getAdapter(name: SupportedCourier): CourierAdapter;
    getGoogleMaps(): GoogleMapsAdapter;
    resolveSmartAutoCourierOrder(address: string, priority?: string): SupportedCourier[];
    createParcel(req: ParcelCreateRequest): Promise<ParcelResponse>;
    trackParcel(trackingCode: string, courierName?: SupportedCourier): Promise<TrackingResponse>;
    getBalance(courierName?: SupportedCourier | "all"): Promise<any>;
    checkFraudRisk(phone: string): Promise<FraudRiskScoreResponse>;
    validateAddress(req: AddressValidationRequest): Promise<AddressValidationResponse>;
    calculateZoneAndRate(req: ZoneRateRequest): Promise<ZoneRateResponse>;
    compareRates(req: CourierRateComparisonRequest): Promise<CourierRateComparisonResponse>;
    /**
     * Task T2 — Honest Draft-Only NDR Resolution
     * 1. Verifies consignment_id exists via trackParcel (throws CONSIGNMENT_NOT_FOUND if bogus).
     * 2. Generates Bengali WhatsApp copy + carrier ticket drafts with status: "DRAFT_GENERATED" and actions_executed: [].
     */
    resolveNdr(req: NdrResolutionRequest): Promise<NdrResolutionResponse>;
    /**
     * Task T8 — cancel_parcel(courier, consignment_id)
     */
    cancelParcel(courier: SupportedCourier, consignmentId: string): Promise<any>;
    /**
     * Task T8 — bulk_create_parcels(items[], dry_run?)
     */
    bulkCreateParcels(items: ParcelCreateRequest[], dryRun?: boolean, tenantId?: string): Promise<BulkParcelCreateResponse>;
    /**
     * Task T8 — get_webhook_events(consignment_id?, since?)
     */
    getWebhookEvents(consignmentId?: string, since?: string, tenantId?: string): {
        success: boolean;
        count: number;
        events: WebhookEventRecord[];
    };
}
