import axios from "axios";
import {
  AddressValidationRequest,
  AddressValidationResponse,
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
      // Fallback: rule-based district detection if no key configured yet
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

    // If coordinates not provided, geocode address first
    if (!destLat || !destLng) {
      const geo = await this.validateAndGeocode({ address: req.recipient_address });
      destLat = geo.coordinates.lat;
      destLng = geo.coordinates.lng;
    }

    let roadDistanceKm = 0;
    let routeSummary = "";

    if (this.apiKey && destLat && destLng) {
      try {
        // Routes API (New)
        const routesUrl = "https://routes.googleapis.com/directions/v2:computeRoutes";
        const routesRes = await axios.post(
          routesUrl,
          {
            origin: {
              location: {
                latLng: {
                  latitude: this.defaultHub.lat,
                  longitude: this.defaultHub.lng,
                },
              },
            },
            destination: {
              location: {
                latLng: {
                  latitude: destLat,
                  longitude: destLng,
                },
              },
            },
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
        // Fallback to Haversine calculation if Routes API has quota/network error
        roadDistanceKm = this.haversineDistance(
          this.defaultHub.lat,
          this.defaultHub.lng,
          destLat,
          destLng
        );
      }
    } else if (destLat && destLng) {
      roadDistanceKm = this.haversineDistance(
        this.defaultHub.lat,
        this.defaultHub.lng,
        destLat,
        destLng
      );
    }

    // Zone Classification Logic for Bangladesh E-Commerce
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
      cod_charge_percentage: 1.0, // 1% standard COD charge
      route_summary: routeSummary || `Hub to Destination (~${roadDistanceKm} km)`,
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
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 1.2 * 10) / 10; // 1.2 road tortuosity factor
  }
}
