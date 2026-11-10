export type SupportedCourier = "steadfast" | "pathao" | "redx" | "paperfly";
export interface ParcelCreateRequest {
    courier?: SupportedCourier | "auto";
    invoice: string;
    recipient_name: string;
    recipient_phone: string;
    recipient_address: string;
    cod_amount: number;
    note?: string;
    item_type?: string;
    item_weight?: number;
    item_category?: string;
    value?: number | string;
    delivery_area?: string;
    delivery_area_id?: number | string;
    pickup_store_id?: number | string;
    dry_run?: boolean;
    tenant_id?: string;
}
export interface ParcelResponse {
    success: boolean;
    courier: SupportedCourier;
    tracking_code: string;
    consignment_id?: string | number;
    invoice: string;
    status: string;
    delivery_fee?: number;
    cost_estimate_bdt?: number;
    cod_amount: number;
    routing_reason?: string;
    cancellable_via_api?: boolean;
    idempotent_replay?: boolean;
    would_book_with?: SupportedCourier;
    estimated_cost_bdt?: number;
    validation?: {
        phone_ok: boolean;
        address_ok: boolean;
        needs_review: boolean;
    };
    raw_response?: any;
    created_at?: string;
}
export interface TrackingResponse {
    success: boolean;
    courier: SupportedCourier;
    tracking_code: string;
    status: string;
    current_location?: string;
    updated_at?: string;
    timeline?: Array<{
        status: string;
        time: string;
        note?: string;
    }>;
    couriers_checked?: SupportedCourier[];
    raw_response?: any;
}
export interface BalanceResponse {
    success: boolean;
    courier: SupportedCourier;
    amount_bdt: number | null;
    pending_bdt: number | null;
    current_balance: number | null;
    status: "OK" | "UNSUPPORTED_BY_PROVIDER";
    hint?: string;
    as_of?: string;
    raw_response?: any;
}
export interface FraudRiskScoreResponse {
    phone: string;
    risk_level: "INVALID_NUMBER" | "NO_HISTORY" | "LOW" | "MEDIUM" | "MODERATE" | "HIGH" | "CRITICAL" | "NEW_BUYER";
    delivery_success_rate: string | null;
    total_parcels?: number;
    total_delivered?: number;
    total_cancelled?: number;
    cancellation_rate: string | null;
    is_verified_buyer: boolean;
    recommendation: string;
    carrier_source: string;
    carrier_verified: boolean;
    data_sources: string[];
    sample_size: number;
    coverage_note: string;
    multi_signal_factors?: {
        carrier_score: string;
        address_confidence?: string;
        cod_value_risk?: string;
    };
}
export interface LocationResolutionRequest {
    courier: SupportedCourier;
    city_name?: string;
    zone_name?: string;
    area_name?: string;
}
export interface LocationResolutionResponse {
    success: boolean;
    courier: SupportedCourier;
    locations: Array<{
        city_id: number;
        city_name: string;
        zone_id?: number;
        zone_name?: string;
        area_id?: number;
        area_name?: string;
    }>;
}
export interface AddressValidationRequest {
    address: string;
    thana?: string;
    district?: string;
}
export interface AddressValidationResponse {
    success: boolean;
    formatted_address: string;
    thana_input: string | null;
    thana_resolved: string | null;
    thana?: string;
    district: string;
    division: string;
    coordinates: {
        lat: number;
        lng: number;
    };
    location_type: "ROOFTOP" | "RANGE_INTERPOLATED" | "GEOMETRIC_CENTER" | "APPROXIMATE" | string;
    is_deliverable: boolean;
    confidence_score: number;
    match_quality: {
        road: boolean;
        house: boolean;
        area: boolean;
    };
    needs_review: boolean;
    warnings: string[];
    place_id?: string;
}
export interface ZoneRateRequest {
    recipient_address: string;
    origin_address?: string;
    destination_coords?: {
        lat: number;
        lng: number;
    };
    weight_kg?: number;
}
export interface ZoneRateResponse {
    success: boolean;
    zone: "inside_dhaka" | "sub_dhaka" | "outside_dhaka";
    zone_title: string;
    distance_km: number;
    road_distance_km: number;
    sla_hours: {
        min: number;
        max: number;
    };
    estimated_delivery_hours: string;
    standard_fee_bdt: number;
    standard_delivery_fee: number;
    cod_percent: number;
    cod_charge_percentage: number;
    route_summary: string;
}
export interface CourierRateComparisonRequest {
    recipient_address: string;
    weight_kg?: number;
    cod_amount?: number;
    priority?: "cheapest" | "fastest" | "balanced";
}
export interface CarrierQuote {
    courier: SupportedCourier;
    courier_name: string;
    base_delivery_fee: number;
    weight_surcharge: number;
    cod_percent?: number;
    cod_charge: number;
    total_cost: number;
    sla_hours: {
        min: number;
        max: number;
    };
    estimated_hours: string;
    coverage_notes: string;
    is_recommended: boolean;
}
export interface CourierRateComparisonResponse {
    success: boolean;
    zone: "inside_dhaka" | "sub_dhaka" | "outside_dhaka";
    zone_title: string;
    distance_km: number;
    road_distance_km: number;
    sla_hours: {
        min: number;
        max: number;
    };
    weight_kg: number;
    cod_amount: number;
    recommended_courier: SupportedCourier;
    recommendation_reason: string;
    quotes: CarrierQuote[];
}
export interface NdrResolutionRequest {
    consignment_id: string;
    courier: SupportedCourier;
    issue_type: "customer_phone_off" | "reschedule_requested" | "wrong_address" | "customer_refused" | "fake_attempt";
    customer_phone?: string;
    customer_name?: string;
    reschedule_date?: string;
    corrected_address?: string;
}
export interface NdrResolutionResponse {
    success: boolean;
    consignment_id: string;
    courier: SupportedCourier;
    status: "DRAFT_GENERATED";
    consignment_verified: boolean;
    actions_executed: string[];
    whatsapp_draft: {
        language: "bn";
        text: string;
    };
    courier_ticket_draft: {
        subject: string;
        body: string;
    };
    recommended_carrier_action: "HOLD" | "RESCHEDULE" | "CORRECT_ADDRESS" | "RETURN";
    requires_manual_execution: boolean;
    resolution_status?: "DRAFT_GENERATED";
    action_taken?: string;
    customer_whatsapp_message?: string;
    carrier_instruction?: string;
    timestamp: string;
}
export interface WebhookEventRecord {
    id: string;
    courier: SupportedCourier;
    consignment_id: string;
    invoice?: string;
    status: string;
    event_type?: string;
    payload: Record<string, any>;
    received_at: string;
}
export interface BulkParcelCreateResponse {
    success: boolean;
    total: number;
    succeeded: number;
    failed: number;
    dry_run: boolean;
    results: Array<{
        index: number;
        invoice: string;
        ok: boolean;
        data?: ParcelResponse;
        error?: {
            code: string;
            message: string;
        };
    }>;
}
