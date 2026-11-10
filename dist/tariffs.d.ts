import { SupportedCourier } from "./types.js";
export type DeliveryZone = "inside_dhaka" | "sub_dhaka" | "outside_dhaka";
export interface SlaHoursRange {
    min: number;
    max: number;
}
export interface ZoneDefinition {
    zone: DeliveryZone;
    zone_title: string;
    max_distance_km: number | null;
    standard_fee_bdt: number;
    cod_percent: number;
    sla_hours: SlaHoursRange;
    sla_label: string;
}
export interface CarrierTariffRule {
    courier: SupportedCourier;
    courier_name: string;
    base_fee_bdt: Record<DeliveryZone, number>;
    extra_kg_fee_bdt: Record<DeliveryZone, number>;
    cod_percent: Record<DeliveryZone, number>;
    sla_hours: Record<DeliveryZone, SlaHoursRange>;
    coverage_notes: Record<DeliveryZone, string>;
}
/**
 * Single Source of Truth for Zone Definitions, Flat Fees & SLAs (T4)
 */
export declare const ZONE_DEFINITIONS: Record<DeliveryZone, ZoneDefinition>;
/**
 * Single Source of Truth for Per-Courier Tariff Slabs & Route-Specific Coverage Notes (T4)
 * Cites standard published Bangladesh merchant courier commercial rate cards.
 */
export declare const CARRIER_TARIFF_TABLE: Record<SupportedCourier, CarrierTariffRule>;
export declare function classifyZoneFromAddressAndDistance(address: string, roadDistanceKm?: number): ZoneDefinition;
export declare function computeCourierQuote(courier: SupportedCourier, zone: DeliveryZone, weightKg: number, codAmount: number): {
    courier: SupportedCourier;
    courier_name: string;
    base_delivery_fee: number;
    weight_surcharge: number;
    cod_percent: number;
    cod_charge: number;
    total_cost: number;
    sla_hours: SlaHoursRange;
    estimated_hours: string;
    coverage_notes: string;
};
