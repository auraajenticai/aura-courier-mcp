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
export const ZONE_DEFINITIONS: Record<DeliveryZone, ZoneDefinition> = {
  inside_dhaka: {
    zone: "inside_dhaka",
    zone_title: "Inside Dhaka Metropolitan (ঢাকার ভেতরে)",
    max_distance_km: 22,
    standard_fee_bdt: 80,
    cod_percent: 1.0,
    sla_hours: { min: 12, max: 48 },
    sla_label: "12–48h",
  },
  sub_dhaka: {
    zone: "sub_dhaka",
    zone_title: "Sub-Dhaka Periphery (সাব-ঢাকা: সাভার, গাজীপুর, কেরানীগঞ্জ, নারায়ণগঞ্জ)",
    max_distance_km: 45,
    standard_fee_bdt: 100,
    cod_percent: 1.0,
    sla_hours: { min: 24, max: 72 },
    sla_label: "24–72h",
  },
  outside_dhaka: {
    zone: "outside_dhaka",
    zone_title: "Outside Dhaka Nationwide (ঢাকার বাইরে ৬৪ জেলা)",
    max_distance_km: null,
    standard_fee_bdt: 150,
    cod_percent: 1.0,
    sla_hours: { min: 48, max: 96 },
    sla_label: "48–96h",
  },
};

/**
 * Single Source of Truth for Per-Courier Tariff Slabs & Route-Specific Coverage Notes (T4)
 * Cites standard published Bangladesh merchant courier commercial rate cards.
 */
export const CARRIER_TARIFF_TABLE: Record<SupportedCourier, CarrierTariffRule> = {
  steadfast: {
    courier: "steadfast",
    courier_name: "Steadfast Courier",
    base_fee_bdt: { inside_dhaka: 70, sub_dhaka: 100, outside_dhaka: 140 },
    extra_kg_fee_bdt: { inside_dhaka: 20, sub_dhaka: 20, outside_dhaka: 20 },
    cod_percent: { inside_dhaka: 1.0, sub_dhaka: 1.0, outside_dhaka: 1.0 },
    sla_hours: {
      inside_dhaka: { min: 12, max: 48 },
      sub_dhaka: { min: 24, max: 72 },
      outside_dhaka: { min: 48, max: 96 },
    },
    coverage_notes: {
      inside_dhaka: "Direct metropolitan hub network across all Dhaka City wards.",
      sub_dhaka: "Dedicated Sub-Dhaka hub coverage in Savar, Keraniganj, Gazipur, and Narayanganj.",
      outside_dhaka: "Direct doorstep COD coverage across all 64 districts and 495+ upazilas nationwide.",
    },
  },
  pathao: {
    courier: "pathao",
    courier_name: "Pathao Express",
    base_fee_bdt: { inside_dhaka: 60, sub_dhaka: 110, outside_dhaka: 150 },
    extra_kg_fee_bdt: { inside_dhaka: 25, sub_dhaka: 25, outside_dhaka: 25 },
    cod_percent: { inside_dhaka: 1.0, sub_dhaka: 1.0, outside_dhaka: 1.0 },
    sla_hours: {
      inside_dhaka: { min: 12, max: 48 },
      sub_dhaka: { min: 24, max: 72 },
      outside_dhaka: { min: 48, max: 96 },
    },
    coverage_notes: {
      inside_dhaka: "High-density on-demand rider fleet within Dhaka Metropolitan City.",
      sub_dhaka: "Regional hub transit across Greater Dhaka industrial and suburban zones.",
      outside_dhaka: "Inter-district linehaul and local hub delivery across major district towns nationwide.",
    },
  },
  redx: {
    courier: "redx",
    courier_name: "RedX Delivery",
    base_fee_bdt: { inside_dhaka: 80, sub_dhaka: 110, outside_dhaka: 160 },
    extra_kg_fee_bdt: { inside_dhaka: 20, sub_dhaka: 20, outside_dhaka: 20 },
    cod_percent: { inside_dhaka: 1.0, sub_dhaka: 1.0, outside_dhaka: 1.0 },
    sla_hours: {
      inside_dhaka: { min: 12, max: 48 },
      sub_dhaka: { min: 24, max: 72 },
      outside_dhaka: { min: 48, max: 96 },
    },
    coverage_notes: {
      inside_dhaka: "Automated sorting and fleet dispatch across Dhaka Metropolitan zones.",
      sub_dhaka: "Sub-district hub coverage for heavy and standard parcels around Dhaka periphery.",
      outside_dhaka: "Nationwide linehaul network across 64 districts with heavy parcel handling support.",
    },
  },
  paperfly: {
    courier: "paperfly",
    courier_name: "Paperfly Go",
    base_fee_bdt: { inside_dhaka: 80, sub_dhaka: 110, outside_dhaka: 170 },
    extra_kg_fee_bdt: { inside_dhaka: 25, sub_dhaka: 25, outside_dhaka: 25 },
    cod_percent: { inside_dhaka: 1.5, sub_dhaka: 1.5, outside_dhaka: 1.5 },
    sla_hours: {
      inside_dhaka: { min: 12, max: 48 },
      sub_dhaka: { min: 24, max: 72 },
      outside_dhaka: { min: 48, max: 96 },
    },
    coverage_notes: {
      inside_dhaka: "Doorstep pickup and metropolitan delivery across Dhaka City.",
      sub_dhaka: "Suburban doorstep delivery across Savar, Ashulia, Gazipur, and Keraniganj.",
      outside_dhaka: "Deep union-level and rural village doorstep delivery across all 64 districts.",
    },
  },
};

export function classifyZoneFromAddressAndDistance(
  address: string,
  roadDistanceKm: number = 0
): ZoneDefinition {
  const addr = String(address || "").toLowerCase();
  const isSubDhakaArea =
    /savar|ashulia|gazipur|gajipur|tongi|keraniganj|narayanganj|siddhirganj|fatullah|সাভার|আশুলিয়া|গাজীপুর|টঙ্গী|কেরানীগঞ্জ|নারায়ণগঞ্জ/i.test(
      addr
    );
  const isOutsideCityMentioned =
    /chattogram|chittagong|sylhet|rajshahi|khulna|barishal|barisal|rangpur|mymensingh|cumilla|comilla|cox|bogura|bogra|jessore|jashore|dinajpur|thakurgaon|চট্টগ্রাম|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর|ময়মনসিংহ|কুমিল্লা|কক্সবাজার/i.test(
      addr
    );
  const isDhakaMetroMentioned =
    !isSubDhakaArea &&
    !isOutsideCityMentioned &&
    /dhaka|ঢাকা|gulshan|banani|dhanmondi|uttara|mirpur|mohammadpur|motijheel|badda|rampura|bashundhara|tejgaon|khilgaon|malibagh|mogbazar|farmgate|shahbag|hatirpool|lalmatia|wari|jatrabari|গুলশান|বনানী|ধানমন্ডি|উত্তরা|মিরপুর|মোহাম্মদপুর|মতিঝিল|বাড্ডা|রামপুরা|বসুন্ধরা|তেজগাঁও|খিলগাঁও|মালিবাগ|মগবাজার|ফার্মগেট|শাহবাগ|হাতিরপুল|ওয়ারী|যাত্রাবাড়ী/i.test(
      addr
    );

  if (isOutsideCityMentioned) {
    return ZONE_DEFINITIONS.outside_dhaka;
  }
  if (isSubDhakaArea) {
    return ZONE_DEFINITIONS.sub_dhaka;
  }
  if (isDhakaMetroMentioned && (roadDistanceKm <= 0 || roadDistanceKm <= 22)) {
    return ZONE_DEFINITIONS.inside_dhaka;
  }
  if (roadDistanceKm > 0 && roadDistanceKm <= 22) {
    return ZONE_DEFINITIONS.inside_dhaka;
  }
  if (roadDistanceKm > 22 && roadDistanceKm <= 45) {
    return ZONE_DEFINITIONS.sub_dhaka;
  }
  return ZONE_DEFINITIONS.outside_dhaka;
}

export function computeCourierQuote(
  courier: SupportedCourier,
  zone: DeliveryZone,
  weightKg: number,
  codAmount: number
) {
  const rule = CARRIER_TARIFF_TABLE[courier];
  const effectiveWeight = Math.max(0.1, Number(weightKg || 0.5));
  const extraKg = Math.max(0, Math.ceil(effectiveWeight - 1.0));
  const baseFee = rule.base_fee_bdt[zone];
  const weightSurcharge = extraKg * rule.extra_kg_fee_bdt[zone];
  const codPercent = rule.cod_percent[zone];
  const codCharge = Math.round(Math.max(0, Number(codAmount || 0)) * (codPercent / 100));
  const totalCost = baseFee + weightSurcharge + codCharge;
  const slaHours = rule.sla_hours[zone];

  return {
    courier,
    courier_name: rule.courier_name,
    base_delivery_fee: baseFee,
    weight_surcharge: weightSurcharge,
    cod_percent: codPercent,
    cod_charge: codCharge,
    total_cost: totalCost,
    sla_hours: slaHours,
    estimated_hours: `${slaHours.min}–${slaHours.max}h`,
    coverage_notes: rule.coverage_notes[zone],
  };
}
