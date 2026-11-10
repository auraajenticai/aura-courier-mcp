import axios from "axios";
import { withGetRetry } from "../envelope.js";
import {
  CARRIER_TARIFF_TABLE,
  classifyZoneFromAddressAndDistance,
  computeCourierQuote,
} from "../tariffs.js";
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

export class GoogleMapsAdapter {
  private apiKey: string;
  private defaultHub = {
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
   * Evaluate road/house/area token match quality and review warnings (T5)
   */
  private buildQualityAssessment(
    req: AddressValidationRequest,
    formattedAddress: string,
    locType: string,
    rawConfidence: number,
    thanaResolved: string | null
  ) {
    const addrIn = String(req.address || "");
    const fmtLower = String(formattedAddress || "").toLowerCase();

    // Check road token
    const roadMatch = addrIn.match(/road\s*#?\s*(\d+[a-z]?)/i);
    let roadOk = true;
    if (roadMatch) {
      const roadNum = roadMatch[1].toLowerCase();
      roadOk =
        fmtLower.includes(`road ${roadNum}`) ||
        fmtLower.includes(`rd ${roadNum}`) ||
        fmtLower.includes(`road-${roadNum}`) ||
        fmtLower.includes(`road #${roadNum}`);
    }

    // Check house token
    const houseMatch = addrIn.match(/house\s*#?\s*(\d+[a-z]?)/i);
    let houseOk = true;
    if (houseMatch) {
      const houseNum = houseMatch[1].toLowerCase();
      houseOk =
        fmtLower.includes(`house ${houseNum}`) ||
        fmtLower.includes(`house-${houseNum}`) ||
        fmtLower.includes(`house #${houseNum}`) ||
        (locType === "ROOFTOP" && fmtLower.includes(houseNum));
    }

    // Check area token
    const areaTokens = addrIn
      .toLowerCase()
      .replace(/road\s*#?\s*\d+[a-z]?/gi, "")
      .replace(/house\s*#?\s*\d+[a-z]?/gi, "")
      .split(/[,.-]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4 && s !== "dhaka" && s !== "bangladesh");
    const areaOk = areaTokens.length === 0 || areaTokens.some((tok) => fmtLower.includes(tok));

    // Cap confidence at 60 whenever location_type !== "ROOFTOP" (T5)
    let confidence = locType === "ROOFTOP" ? rawConfidence : Math.min(60, rawConfidence);
    if (!roadOk || !houseOk) {
      confidence = Math.min(confidence, 55);
    }

    const warnings: string[] = [];
    if (locType !== "ROOFTOP") {
      warnings.push(`Geocode precision is ${locType} (not ROOFTOP); confidence capped at 60.`);
    }
    if (thanaResolved === null) {
      warnings.push("Thana/sublocality could not be resolved from geocoder components.");
    }
    if (req.thana && thanaResolved === null) {
      warnings.push(`Input thana '${req.thana}' was not independently verified by geocoder.`);
    }
    if (!roadOk) {
      warnings.push("Input road number was not cleanly matched in formatted address.");
    }
    if (!houseOk) {
      warnings.push("Input house number was not cleanly matched as a rooftop premise in formatted address.");
    }

    const needsReview = confidence < 70 || thanaResolved === null || !roadOk || !houseOk;

    return {
      confidence,
      matchQuality: { road: roadOk, house: houseOk, area: areaOk },
      needsReview,
      warnings,
    };
  }

  /**
   * Validate and Geocode Bangladesh Address using Google Maps Geocoding API (T5)
   */
  async validateAndGeocode(req: AddressValidationRequest): Promise<AddressValidationResponse> {
    const thanaInput = req.thana ? String(req.thana) : null;
    const fullQuery = [req.address, req.thana, req.district, "Bangladesh"]
      .filter(Boolean)
      .join(", ");

    if (!this.apiKey) {
      return this.fallbackAddressParse(req);
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json`;
      const res = await withGetRetry(() =>
        axios.get(url, {
          params: {
            address: fullQuery,
            components: "country:BD",
            language: "en",
            key: this.apiKey,
          },
          timeout: 8000,
        })
      );

      const data = res.data;
      if (data.status !== "OK" || !data.results || !data.results.length) {
        return this.fallbackAddressParse(req);
      }

      const result = data.results[0];
      const components = result.address_components || [];
      const location = result.geometry?.location || { lat: 23.8103, lng: 90.4125 };
      const locType = String(result.geometry?.location_type || "APPROXIMATE");

      // Derive thana_resolved strictly from Google address_components; NEVER echo thana_input!
      let thanaResolved: string | null = null;
      let district = "";
      let division = "";

      for (const c of components) {
        const types: string[] = c.types || [];
        if (
          types.includes("sublocality") ||
          types.includes("sublocality_level_1") ||
          types.includes("administrative_area_level_3") ||
          types.includes("neighborhood")
        ) {
          if (!thanaResolved && c.long_name) {
            thanaResolved = String(c.long_name);
          }
        } else if (types.includes("administrative_area_level_2")) {
          district = c.long_name;
        } else if (types.includes("administrative_area_level_1")) {
          division = c.long_name;
        }
      }

      let rawConf = 50;
      if (locType === "ROOFTOP") rawConf = 95;
      else if (locType === "RANGE_INTERPOLATED") rawConf = 60;
      else if (locType === "GEOMETRIC_CENTER") rawConf = 55;

      const qa = this.buildQualityAssessment(
        req,
        result.formatted_address,
        locType,
        rawConf,
        thanaResolved
      );

      return {
        success: true,
        formatted_address: result.formatted_address,
        thana_input: thanaInput,
        thana_resolved: thanaResolved,
        thana: thanaResolved || "",
        district: district || req.district || "Dhaka",
        division: division || "Dhaka Division",
        coordinates: {
          lat: location.lat,
          lng: location.lng,
        },
        location_type: locType,
        is_deliverable: qa.confidence >= 50,
        confidence_score: qa.confidence,
        match_quality: qa.matchQuality,
        needs_review: qa.needsReview,
        warnings: qa.warnings,
        place_id: result.place_id,
      };
    } catch (_) {
      return this.fallbackAddressParse(req);
    }
  }

  /**
   * Compute Road Distance & Classify Delivery Zone from Single Tariff Source of Truth (T4)
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
        } else {
          roadDistanceKm = this.haversineDistance(this.defaultHub.lat, this.defaultHub.lng, destLat, destLng);
        }
      } catch (_) {
        roadDistanceKm = this.haversineDistance(this.defaultHub.lat, this.defaultHub.lng, destLat, destLng);
      }
    } else if (destLat && destLng) {
      roadDistanceKm = this.haversineDistance(this.defaultHub.lat, this.defaultHub.lng, destLat, destLng);
    }

    const zoneDef = classifyZoneFromAddressAndDistance(req.recipient_address, roadDistanceKm);

    return {
      success: true,
      zone: zoneDef.zone,
      zone_title: zoneDef.zone_title,
      distance_km: roadDistanceKm,
      road_distance_km: roadDistanceKm,
      sla_hours: zoneDef.sla_hours,
      estimated_delivery_hours: zoneDef.sla_label,
      standard_fee_bdt: zoneDef.standard_fee_bdt,
      standard_delivery_fee: zoneDef.standard_fee_bdt,
      cod_percent: zoneDef.cod_percent,
      cod_charge_percentage: zoneDef.cod_percent,
      route_summary: routeSummary || `Hub to Destination (~${roadDistanceKm} km)`,
    };
  }

  /**
   * Multi-Carrier Rate Comparison backed by Single Tariff Source of Truth (T4)
   */
  async compareRates(req: CourierRateComparisonRequest): Promise<CourierRateComparisonResponse> {
    const zoneInfo = await this.calculateDeliveryZoneAndFee({
      recipient_address: req.recipient_address,
      weight_kg: req.weight_kg || 0.5,
    });

    const weight = req.weight_kg || 0.5;
    const cod = req.cod_amount || 0;
    const couriers: SupportedCourier[] = ["steadfast", "pathao", "redx", "paperfly"];

    const rawQuotes = couriers.map((c) => computeCourierQuote(c, zoneInfo.zone, weight, cod));

    let recommended: SupportedCourier = "steadfast";
    let reason = "Balanced nationwide coverage and cost efficiency.";

    if (req.priority === "cheapest") {
      const sorted = [...rawQuotes].sort((a, b) => a.total_cost - b.total_cost);
      recommended = sorted[0].courier;
      reason = `${sorted[0].courier_name} offers the lowest total tariff on this route (৳${sorted[0].total_cost}).`;
    } else if (zoneInfo.zone === "inside_dhaka") {
      recommended = "pathao";
      reason = "Lowest base rate and high-density rider pickup within Inside Dhaka.";
    } else {
      recommended = "steadfast";
      reason = "Lowest inter-district base tariff and 64-district doorstep COD coverage.";
    }

    const quotes: CarrierQuote[] = rawQuotes.map((rq) => ({
      ...rq,
      is_recommended: rq.courier === recommended,
    }));

    return {
      success: true,
      zone: zoneInfo.zone,
      zone_title: zoneInfo.zone_title,
      distance_km: zoneInfo.distance_km,
      road_distance_km: zoneInfo.road_distance_km,
      sla_hours: zoneInfo.sla_hours,
      weight_kg: weight,
      cod_amount: cod,
      recommended_courier: recommended,
      recommendation_reason: reason,
      quotes,
    };
  }

  private async fallbackAddressParse(req: AddressValidationRequest): Promise<AddressValidationResponse> {
    const thanaInput = req.thana ? String(req.thana) : null;
    const fullQuery = [req.address, req.thana, req.district, "Bangladesh"].filter(Boolean).join(", ");
    const lower = fullQuery.toLowerCase();

    const BD_DISTRICTS: Array<{ match: RegExp; district: string; division: string; lat: number; lng: number }> = [
      { match: /chattogram|chittagong|চট্টগ্রাম/, district: "Chattogram", division: "Chattogram Division", lat: 22.3569, lng: 91.7832 },
      { match: /sylhet|সিলেট/, district: "Sylhet", division: "Sylhet Division", lat: 24.8949, lng: 91.8687 },
      { match: /rajshahi|রাজশাহী/, district: "Rajshahi", division: "Rajshahi Division", lat: 24.3745, lng: 88.6042 },
      { match: /khulna|খুলনা/, district: "Khulna", division: "Khulna Division", lat: 22.8456, lng: 89.5403 },
      { match: /barishal|barisal|বরিশাল/, district: "Barishal", division: "Barishal Division", lat: 22.7010, lng: 90.3535 },
      { match: /rangpur|রংপুর/, district: "Rangpur", division: "Rangpur Division", lat: 25.7439, lng: 89.2752 },
      { match: /mymensingh|ময়মনসিংহ/, district: "Mymensingh", division: "Mymensingh Division", lat: 24.7471, lng: 90.4203 },
      { match: /cumilla|comilla|কুমিল্লা/, district: "Cumilla", division: "Chattogram Division", lat: 23.4607, lng: 91.1809 },
      { match: /gazipur|গাজীপুর|tongi|টঙ্গী/, district: "Gazipur", division: "Dhaka Division", lat: 23.9999, lng: 90.4203 },
      { match: /narayanganj|নারায়ণগঞ্জ/, district: "Narayanganj", division: "Dhaka Division", lat: 23.6238, lng: 90.5000 },
      { match: /savar|সাভার|ashulia|আশুলিয়া/, district: "Dhaka", division: "Dhaka Division", lat: 23.8583, lng: 90.2667 },
      { match: /keraniganj|কেরানীগঞ্জ|ati bazar|atibazar/, district: "Dhaka", division: "Dhaka Division", lat: 23.7196, lng: 90.3125 },
      { match: /uttara|উত্তরা/, district: "Dhaka", division: "Dhaka Division", lat: 23.8759, lng: 90.3795 },
      { match: /mirpur|মিরপুর/, district: "Dhaka", division: "Dhaka Division", lat: 23.8042, lng: 90.3667 },
      { match: /dhanmondi|ধানমন্ডি/, district: "Dhaka", division: "Dhaka Division", lat: 23.7461, lng: 90.3742 },
      { match: /gulshan|গুলশান|banani|বনানী/, district: "Dhaka", division: "Dhaka Division", lat: 23.7925, lng: 90.4078 },
    ];

    const matched = BD_DISTRICTS.find((d) => d.match.test(lower)) || {
      district: req.district || "Dhaka",
      division: "Dhaka Division",
      lat: 23.7805,
      lng: 90.4078,
    };

    // Never echo thana_input into thana_resolved in fallback mode
    const thanaResolved: string | null = null;
    const locType = "APPROXIMATE";
    const qa = this.buildQualityAssessment(req, fullQuery, locType, 55, thanaResolved);

    return {
      success: true,
      formatted_address: fullQuery,
      thana_input: thanaInput,
      thana_resolved: thanaResolved,
      thana: "",
      district: matched.district,
      division: matched.division,
      coordinates: { lat: matched.lat, lng: matched.lng },
      location_type: locType,
      is_deliverable: true,
      confidence_score: qa.confidence,
      match_quality: qa.matchQuality,
      needs_review: true,
      warnings: qa.warnings,
      place_id: `bd_gazetteer_${matched.district.toLowerCase()}`,
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
    return Math.round(R * c * 1.25 * 10) / 10;
  }
}
