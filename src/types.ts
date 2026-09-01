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
  risk_level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  delivery_success_rate: string;
  is_verified_buyer: boolean;
  recommendation: string;
  neural_verified: boolean;
}

export interface LocationResolutionResponse {
  success: boolean;
  courier: SupportedCourier;
  locations: Array<{
    city_id?: number | string;
    city_name?: string;
    zone_id?: number | string;
    zone_name?: string;
    area_id?: number | string;
    area_name?: string;
  }>;
}
