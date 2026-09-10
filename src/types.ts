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
  item_weight?: number; // in KG
  item_category?: string;
  value?: number | string;
  delivery_area?: string;
  delivery_area_id?: number | string;
  pickup_store_id?: number | string;
}

export interface ParcelResponse {
  success: boolean;
  courier: SupportedCourier;
  tracking_code: string;
  consignment_id?: string | number;
  invoice: string;
  status: string;
  delivery_fee?: number;
  cod_amount: number;
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
  raw_response?: any;
}

export interface BalanceResponse {
  success: boolean;
  courier: SupportedCourier;
  current_balance: number;
  raw_response?: any;
}

export interface FraudRiskScoreResponse {
  phone: string;
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "NEW_BUYER";
  delivery_success_rate: string;
  total_parcels?: number;
  total_delivered?: number;
  total_cancelled?: number;
  cancellation_rate?: string;
  is_verified_buyer: boolean;
  recommendation: string;
  carrier_source: string;
  carrier_verified: boolean;
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

// Google Maps Platform Spatial Types
export interface AddressValidationRequest {
  address: string;
  thana?: string;
  district?: string;
}

export interface AddressValidationResponse {
  success: boolean;
  formatted_address: string;
  thana?: string;
  district?: string;
  division?: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  location_type: string;
  is_deliverable: boolean;
  confidence_score: number; // 0 - 100
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
  road_distance_km: number;
  estimated_delivery_hours: string;
  standard_delivery_fee: number;
  cod_charge_percentage: number;
  route_summary?: string;
}
