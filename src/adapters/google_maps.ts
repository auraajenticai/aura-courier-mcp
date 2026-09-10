import axios from "axios";
import {
  AddressValidationRequest,
  AddressValidationResponse,
  CourierRateComparisonRequest,
  CourierRateComparisonResponse,
  CarrierQuote,
  SupportedCourier,
  ZoneRateRequest,
  ZoneRateResponse,
} from "../types.js";

// Google Maps Platform Skill Attribution & Governance
// Attribution ID: gmp_git_agentskills_v1
const GMP_ATTRIBUTION_ID = "gmp_git_agentskills_v1";

export class GoogleMapsAdapter {
  private apiKey: string;
  private defaultHub = {
    // Dhaka Central Logistics Hub (Tejgaon / Mirpur axis)
    lat: 23.7925,
    lng: 90.4078,
    name: "Aura Central Sorting Hub, Dhaka",
  };

  constructor(apiKey: string = "") {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || "";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Validate and Geocode Bangladesh Address using Google Maps Geocoding API
   */
  async validateAndGeocode(req: AddressValidationRequest): Promise<AddressValidationResponse> {
    const fullQuery = [req.address, req.thana, req.district, "Bangladesh"]
      .filter(Boolean)
      .join(", ");

    if (!this.apiKey) {
      return this.fallbackAddressParse(req);
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json`;
      const res = await axios.get(url, {
        params: {
          address: fullQuery,
          components: "country:BD",
          language: "bn,en",
          key: this.apiKey,
        },
        timeout: 8000,
      });

      const data = res.data;
      if (data.status !== "OK" || !data.results || !data.results.length) {
        return this.fallbackAddressParse(req);
      }

      const result = data.results[0];
      const components = result.address_components || [];
      const location = result.geometry?.location || { lat: 23.8103, lng: 90.4125 };
      const locType = result.geometry?.location_type || "APPROXIMATE";

      let thana = "";
      let district = "";
      let division = "";

      for (const c of components) {
        const types = c.types || [];
        if (types.includes("sublocality") || types.includes("sublocality_level_1") || types.includes("neighborhood")) {
          thana = c.long_name;
        } else if (types.includes("administrative_area_level_2")) {
          district = c.long_name;
        } else if (types.includes("administrative_area_level_1")) {
          division = c.long_name;
        }
      }

      let confidence = 50;
      if (locType === "ROOFTOP") confidence = 98;
      else if (locType === "RANGE_INTERPOLATED") confidence = 85;
      else if (locType === "GEOMETRIC_CENTER") confidence = 70;

      return {
        success: true,
        formatted_address: result.formatted_address,
        thana: thana || req.thana || "",
        district: district || req.district || "Dhaka",
        division: division || "Dhaka Division",
        coordinates: {
          lat: location.lat,
          lng: location.lng,
        },
        location_type: locType,
        is_deliverable: confidence >= 60,
        confidence_score: confidence,
        place_id: result.place_id,
      };
    } catch (err: any) {
      return this.fallbackAddressParse(req);
    }
  }

  /**
   * Compute Road Distance & Classify Delivery Zone via Google Routes API
   */
  async calculateDeliveryZoneAndFee(req: ZoneRateRequest): Promise<ZoneRateResponse> {
    let destLat = req.destination_coords?.lat;
    let destLng = req.destination_coords?.lng;

    if (!destLat || !destLng) {
      const geo = await this.validateAndGeocode({ address: req.recipient_address });
      destLat = geo.coordinates.lat;
      destLng = geo.coordinates.lng;
    }

    let roadDistanceKm = 0;
    let routeSummary = "";

    if (this.apiKey && destLat && destLng) {
      try {
        const routesUrl = "https://routes.googleapis.com/directions/v2:computeRoutes";
        const routesRes = await axios.post(
          routesUrl,
          {
            origin: { location: { latLng: { latitude: this.defaultHub.lat, longitude: this.defaultHub.lng } } },
            destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
            travelMode: "DRIVE",
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": this.apiKey,
              "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.description",
            },
            timeout: 8000,
          }
        );

        const route = routesRes.data?.routes?.[0];
        if (route && route.distanceMeters) {
          roadDistanceKm = Math.round((route.distanceMeters / 1000) * 10) / 10;
          routeSummary = route.description || "";
        }
      } catch (routesErr) {
        roadDistanceKm = this.haversineDistance(this.defaultHub.lat, this.defaultHub.lng, destLat, destLng);
      }
    } else if (destLat && destLng) {
      roadDistanceKm = this.haversineDistance(this.defaultHub.lat, this.defaultHub.lng, destLat, destLng);
    }

    const addr = req.recipient_address.toLowerCase();
    const isSubDhakaArea = /savar|gazipur|keraniganj|narayanganj|সাভার|গাজীপুর|কেরানীগঞ্জ|নারায়ণগঞ্জ/i.test(addr);

    let zone: "inside_dhaka" | "sub_dhaka" | "outside_dhaka" = "outside_dhaka";
    let zoneTitle = "ঢাকার বাইরে (সারা বাংলাদেশ)";
    let fee = 150;
    let hours = "৭২–৯৬ ঘণ্টা";

    if (roadDistanceKm > 0 && roadDistanceKm <= 22 && !isSubDhakaArea) {
      zone = "inside_dhaka";
      zoneTitle = "ঢাকার ভেতরে (মেট্রোপলিটন)";
      fee = 80;
      hours = "২৪–৪৮ ঘণ্টা (সরাসরি হোম ডেলিভারি)";
    } else if ((roadDistanceKm > 22 && roadDistanceKm <= 45) || isSubDhakaArea) {
      zone = "sub_dhaka";
      zoneTitle = "সাব-ঢাকা (আশপাশের অঞ্চল)";
      fee = 100;
      hours = "৪৮–৭২ ঘণ্টা";
    }

    return {
      success: true,
      zone,
      zone_title: zoneTitle,
      road_distance_km: roadDistanceKm,
      estimated_delivery_hours: hours,
      standard_delivery_fee: fee,
      cod_charge_percentage: 1.0,
      route_summary: routeSummary || `Hub to Destination (~${roadDistanceKm} km)`,
    };
  }

  /**
   * Enterprise Multi-Carrier Rate Comparison (Steadfast vs Pathao vs RedX vs Paperfly)
   */
  async compareRates(req: CourierRateComparisonRequest): Promise<CourierRateComparisonResponse> {
    const zoneInfo = await this.calculateDeliveryZoneAndFee({
      recipient_address: req.recipient_address,
      weight_kg: req.weight_kg || 0.5,
    });

    const weight = req.weight_kg || 0.5;
    const cod = req.cod_amount || 0;
    const extraKg = Math.max(0, Math.ceil(weight - 1.0));

    // Base rates per carrier based on real BD logistics market tariffs
    let sfBase = 70, ptBase = 60, rxBase = 80, pfBase = 80;
    let sfExtra = 20, ptExtra = 25, rxExtra = 20, pfExtra = 25;
    let sfHours = "২৪–৪৮ ঘণ্টা", ptHours = "১২–২৪ ঘণ্টা (Same-Day)", rxHours = "২৪–৪৮ ঘণ্টা", pfHours = "২৪–৪৮ ঘণ্টা";

    if (zoneInfo.zone === "sub_dhaka") {
      sfBase = 100; ptBase = 110; rxBase = 110; pfBase = 110;
      sfHours = "৪৮–৭২ ঘণ্টা"; ptHours = "২৪–৪৮ ঘণ্টা"; rxHours = "৪৮–৭২ ঘণ্টা"; pfHours = "৪৮–৭২ ঘণ্টা";
    } else if (zoneInfo.zone === "outside_dhaka") {
      sfBase = 140; ptBase = 150; rxBase = 160; pfBase = 170;
      sfHours = "৭২–৯৬ ঘণ্টা"; ptHours = "৪৮–৭২ ঘণ্টা"; rxHours = "৭২–৯৬ ঘণ্টা"; pfHours = "৭২–৯৬ ঘণ্টা";
    }

    const sfCod = Math.round(cod * 0.01);
    const ptCod = Math.round(cod * 0.01);
    const rxCod = Math.round(cod * 0.01);
    const pfCod = Math.round(cod * 0.015);

    const sfTotal = sfBase + (extraKg * sfExtra) + sfCod;
    const ptTotal = ptBase + (extraKg * ptExtra) + ptCod;
    const rxTotal = rxBase + (extraKg * rxExtra) + rxCod;
    const pfTotal = pfBase + (extraKg * pfExtra) + pfCod;

    const carrierQuotes: Array<{
      courier: SupportedCourier;
      name: string;
      base: number;
      extra: number;
      cod: number;
      total: number;
      hours: string;
      notes: string;
    }> = [
      {
        courier: "steadfast",
        name: "Steadfast Courier",
        base: sfBase,
        extra: extraKg * sfExtra,
        cod: sfCod,
        total: sfTotal,
        hours: sfHours,
        notes: "৬৪ জেলা ও সকল থানায় সরাসরি ক্যাশ অন ডেলিভারি হাব নেটওয়ার্ক।",
      },
      {
        courier: "pathao",
        name: "Pathao Express",
        base: ptBase,
        extra: extraKg * ptExtra,
        cod: ptCod,
        total: ptTotal,
        hours: ptHours,
        notes: "ঢাকা ও প্রধান মেট্রোপলিটন সিটিতে দ্রুততম অন-ডিমান্ড রাইডার পিকআপ।",
      },
      {
        courier: "redx",
        name: "RedX Delivery",
        base: rxBase,
        extra: extraKg * rxExtra,
        cod: rxCod,
        total: rxTotal,
        hours: rxHours,
        notes: "শক্তিশালী সাব-ডিস্ট্রিক্ট হাব ও বৃহৎ পার্সেল হ্যান্ডলিং নেটওয়ার্ক।",
      },
      {
        courier: "paperfly",
        name: "Paperfly Go",
        base: pfBase,
        extra: extraKg * pfExtra,
        cod: pfCod,
        total: pfTotal,
        hours: pfHours,
        notes: "প্রত্যন্ত ইউনিয়ন ও ডোরস্টেপ ডেলিভারি কভারেজ।",
      },
    ];

    let recommended: SupportedCourier = "steadfast";
    let reason = "সর্বনিম্ন খরচ ও ৬৪ জেলায় ৯৯.৮% সফল ডেলিভারি নেটওয়ার্ক";

    if (zoneInfo.zone === "inside_dhaka" && req.priority === "fastest") {
      recommended = "pathao";
      reason = "ঢাকা মেট্রোপলিটনে দ্রুততম সেম-ডে এক্সপ্রেস ডেলিভারি";
    } else if (req.priority === "cheapest") {
      const sorted = [...carrierQuotes].sort((a, b) => a.total - b.total);
      recommended = sorted[0].courier;
      reason = `${sorted[0].name} এই রুটে সর্বনিম্ন খরচে ডেলিভারি প্রদান করে (৳${sorted[0].total})।`;
    } else if (zoneInfo.zone === "inside_dhaka") {
      recommended = ptTotal <= sfTotal ? "pathao" : "steadfast";
      reason = "ঢাকা মেট্রোপলিটনে সাশ্রয়ী ডেলিভারি ও দ্রুত পিকআপ";
    } else {
      recommended = "steadfast";
      reason = "ঢাকার বাইরে সারা বাংলাদেশের ৬৪ জেলায় সর্বোচ্চ কভারেজ ও সর্বনিম্ন রিটার্ন রেট";
    }

    const quotes: CarrierQuote[] = carrierQuotes.map((cq) => ({
      courier: cq.courier,
      courier_name: cq.name,
      base_delivery_fee: cq.base,
      weight_surcharge: cq.extra,
      cod_charge: cq.cod,
      total_cost: cq.total,
      estimated_hours: cq.hours,
      coverage_notes: cq.notes,
      is_recommended: (cq.courier as string) === (recommended as string),
    }));

    return {
      success: true,
      zone: zoneInfo.zone,
      zone_title: zoneInfo.zone_title,
      road_distance_km: zoneInfo.road_distance_km,
      weight_kg: weight,
      cod_amount: cod,
      recommended_courier: recommended,
      recommendation_reason: reason,
      quotes,
    };
  }

  private fallbackAddressParse(req: AddressValidationRequest): AddressValidationResponse {
    const raw = (req.address + " " + (req.district || "")).toLowerCase();
    const isDhaka = /dhaka|ঢাকা/i.test(raw);

    return {
      success: true,
      formatted_address: req.address,
      thana: req.thana || "",
      district: req.district || (isDhaka ? "Dhaka" : "Outside Dhaka"),
      division: isDhaka ? "Dhaka" : "",
      coordinates: isDhaka ? { lat: 23.8103, lng: 90.4125 } : { lat: 22.3569, lng: 91.7832 },
      location_type: "APPROXIMATE",
      is_deliverable: true,
      confidence_score: 65,
    };
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 1.2 * 10) / 10;
  }
}
