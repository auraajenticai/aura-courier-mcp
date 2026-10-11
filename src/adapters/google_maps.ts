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
        } else {
          roadDistanceKm = this.haversineDistance(this.defaultHub.lat, this.defaultHub.lng, destLat, destLng);
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

  private async fallbackAddressParse(req: AddressValidationRequest): Promise<AddressValidationResponse> {
    const fullQuery = [req.address, req.thana, req.district, "Bangladesh"].filter(Boolean).join(", ");

    // Tier 2: Live OpenStreetMap Nominatim Geocoding (Zero-Billing Fallback)
    try {
      const nomRes = await axios.get("https://nominatim.openstreetmap.org/search", {
        params: {
          q: fullQuery,
          countrycodes: "bd",
          format: "json",
          addressdetails: 1,
          limit: 1,
        },
        headers: { "User-Agent": "AuraCourierMCP/2.5 (https://courier.auraajenticai.cloud)" },
        timeout: 5500,
      });
      if (Array.isArray(nomRes.data) && nomRes.data.length > 0) {
        const hit = nomRes.data[0];
        const addr = hit.address || {};
        const lat = parseFloat(hit.lat);
        const lng = parseFloat(hit.lon);
        const thana = addr.suburb || addr.neighbourhood || addr.town || addr.municipality || addr.city_district || req.thana || "";
        const district = (addr.county || addr.city || addr.state_district || req.district || "Dhaka").replace(/\s*District$/i, "");
        const division = addr.state || "Dhaka Division";
        return {
          success: true,
          formatted_address: hit.display_name || fullQuery,
          thana,
          district,
          division,
          coordinates: { lat, lng },
          location_type: "GEOMETRIC_CENTER",
          is_deliverable: true,
          confidence_score: 88,
          place_id: `osm_${hit.place_id || Date.now()}`,
        };
      }
    } catch (_) {
      // Proceed to Tier 3 Spatial Gazetteer
    }

    // Tier 3: Bangladesh 64-District & Dhaka Thana Spatial Gazetteer
    const raw = [req.address, req.thana, req.district].filter(Boolean).join(" ").toLowerCase();
    const gazetteer: Array<{ rx: RegExp; thana: string; district: string; division: string; lat: number; lng: number }> = [
      { rx: /mirpur|মিরপুর|pallabi|পল্লবী|kazipara|shewrapara|কাজীপাড়া|শেওড়াপাড়া/, thana: "Mirpur", district: "Dhaka", division: "Dhaka Division", lat: 23.8042, lng: 90.3667 },
      { rx: /uttara|উত্তরা|airport|বিমানবন্দর|sector|সেক্টর|dakshin khan|uttar khan/, thana: "Uttara", district: "Dhaka", division: "Dhaka Division", lat: 23.8759, lng: 90.3795 },
      { rx: /dhanmondi|ধানমন্ডি|kalabagan|কলাবাগান|jigatola|জিগাতলা|shankar/, thana: "Dhanmondi", district: "Dhaka", division: "Dhaka Division", lat: 23.7461, lng: 90.3742 },
      { rx: /gulshan|গুলশান|banani|বনানী|baridhara|বারিধারা|niketan|নিকেতন/, thana: "Gulshan", district: "Dhaka", division: "Dhaka Division", lat: 23.7925, lng: 90.4078 },
      { rx: /mohammadpur|মোহাম্মদপুর|adabor|আদাবর|lalmatia|লালমাটিয়া|bosila|বসিলা/, thana: "Mohammadpur", district: "Dhaka", division: "Dhaka Division", lat: 23.7662, lng: 90.3589 },
      { rx: /badda|বাড্ডা|rampura|রামপুরা|banasree|বনশ্রী|aftabnagar|আফতাবনগর|hatirjheel/, thana: "Badda", district: "Dhaka", division: "Dhaka Division", lat: 23.7805, lng: 90.4267 },
      { rx: /bashundhara|বসুন্ধরা|vatara|ভাটারা|kuril|কুড়িল|nikunja|নিকুঞ্জ|khilkhet|খিলক্ষেত/, thana: "Vatara", district: "Dhaka", division: "Dhaka Division", lat: 23.8191, lng: 90.4526 },
      { rx: /motijheel|মতিঝিল|paltan|পল্টন|kakrail|কাকরাইল|shantinagar|শান্তিনগর|malibagh|মালিবাগ|mogbazar|মগবাজার/, thana: "Motijheel", district: "Dhaka", division: "Dhaka Division", lat: 23.7330, lng: 90.4172 },
      { rx: /shahbag|শাহবাগ|hatirpool|হাতিরপুল|motaleb|মোতালেব|eleph|এলিফ্যান্ট|new market|নিউ মার্কেট|farmgate|ফার্মগেট|tejgaon|তেজগাঁও|karwan|কারওয়ান/, thana: "Shahbagh", district: "Dhaka", division: "Dhaka Division", lat: 23.7415, lng: 90.3918 },
      { rx: /jatrabari|যাত্রাবাড়ী|demra|ডেমরা|kadamtali|কদমতলী|shanir akhra|শনির আখড়া|wari|ওয়ারী|old dhaka|পুরান ঢাকা|lalbagh|লালবাগ|kotwali/, thana: "Jatrabari", district: "Dhaka", division: "Dhaka Division", lat: 23.7104, lng: 90.4348 },
      { rx: /keraniganj|কেরানীগঞ্জ|ati bazar|আটি বাজার|atibazar|hasnabad/, thana: "Keraniganj", district: "Dhaka", division: "Dhaka Division", lat: 23.6942, lng: 90.3475 },
      { rx: /savar|সাভার|ashulia|আশুলিয়া|hemayetpur|হেমায়েতপুর|dhamrai|ধামরাই/, thana: "Savar", district: "Dhaka", division: "Dhaka Division", lat: 23.8583, lng: 90.2667 },
      { rx: /gazipur|গাজীপুর|tongi|টঙ্গী|board bazar|বোর্ড বাজার|joydebpur|জয়দেবপুর|konabari/, thana: "Tongi", district: "Gazipur", division: "Dhaka Division", lat: 23.9889, lng: 90.3950 },
      { rx: /narayanganj|নারায়ণগঞ্জ|siddhirganj|সিদ্ধিরগঞ্জ|fatullah|ফতুল্লা|chashara|চাষাড়া|sonargaon|rupganj/, thana: "Narayanganj Sadar", district: "Narayanganj", division: "Dhaka Division", lat: 23.6238, lng: 90.5000 },
      { rx: /chattogram|chittagong|চট্টগ্রাম|agrabad|আগ্রাবাদ|nasirabad|নাসিরাবাদ|halishahar|হালিশহর|panchlaish|gec|জিইসি|kotwali/, thana: "Panchlaish", district: "Chattogram", division: "Chattogram Division", lat: 22.3569, lng: 91.7832 },
      { rx: /cox.?s?s*bazar|কক্সবাজার|chakaria|teknaf|ukhiya/, thana: "Cox's Bazar Sadar", district: "Cox's Bazar", division: "Chattogram Division", lat: 21.4272, lng: 92.0058 },
      { rx: /cumilla|comilla|কুমিল্লা|kandirpar|কান্দিরপাড়|laksam|daudkandi/, thana: "Cumilla Sadar", district: "Cumilla", division: "Chattogram Division", lat: 23.4607, lng: 91.1809 },
      { rx: /feni|ফেনী|noakhali|নোয়াখালী|maijdee|চৌমুহনী|lakshmipur|লক্ষ্মীপুর|chandpur|চাঁদপুর|brahmanbaria|ব্রাহ্মণবাড়িয়া/, thana: "Sadar", district: "Noakhali", division: "Chattogram Division", lat: 22.8724, lng: 91.0973 },
      { rx: /sylhet|সিলেট|zindabazar|জিন্দাবাজার|amberkhana|আম্বরখানা|upashahar|উপশহর|moulvibazar|মৌলভীবাজার|sreemangal|habiganj|হবিগঞ্জ|sunamganj|সুনামগঞ্জ/, thana: "Sylhet Sadar", district: "Sylhet", division: "Sylhet Division", lat: 24.8949, lng: 91.8687 },
      { rx: /rajshahi|রাজশাহী|boalia|বোয়ালিয়া|shaheb bazar|সাহেব বাজার|motihar|নাটোর|natore|naogaon|নওগাঁ|chapainawabganj|চাঁপাইনবাবগঞ্জ|pabna|পাবনা|sirajganj|সিরাজগঞ্জ/, thana: "Boalia", district: "Rajshahi", division: "Rajshahi Division", lat: 24.3745, lng: 88.6042 },
      { rx: /bogura|bogra|বগুড়া|sherpur|শেরপুর|joypurhat|জয়পুরহাট/, thana: "Bogura Sadar", district: "Bogura", division: "Rajshahi Division", lat: 24.8481, lng: 89.3730 },
      { rx: /khulna|খুলনা|sonadanga|সোনাডাঙ্গা|khalishpur|খালিশপুর|daulatpur|jashore|jessore|যশোর|kushtia|কুষ্টিয়া|satkhira|সাতক্ষীরা|bagerhat|বাগেরহাট|jhenaidah|ঝিনাইদহ/, thana: "Sonadanga", district: "Khulna", division: "Khulna Division", lat: 22.8456, lng: 89.5403 },
      { rx: /barishal|barisal|বরিশাল|patukhali|পটুয়াখালী|bhola|ভোলা|pirojpur|পিরোজপুর|jhalokati|barguna/, thana: "Barishal Sadar", district: "Barishal", division: "Barishal Division", lat: 22.7010, lng: 90.3535 },
      { rx: /rangpur|রংপুর|dinajpur|দিনাজপুর|thakurgaon|ঠাকুরগাঁও|panchagarh|পঞ্চগড়|nilphamari|নীলফামারী|saidpur|সৈয়দপুর|kurigram|কুড়িগ্রাম|gaibandha|গাইবান্ধা|lalmonirhat/, thana: "Rangpur Sadar", district: "Rangpur", division: "Rangpur Division", lat: 25.7439, lng: 89.2752 },
      { rx: /mymensingh|ময়মনসিংহ|jamalpur|জামালপুর|netrokona|নেত্রকোনা|tangail|টাঙ্গাইল|kishoreganj|কিশোরগঞ্জ|faridpur|ফরিদপুর|madaripur|মাদারীপুর|gopalganj|গোপালগঞ্জ|shariatpur|শরীয়তপুর|rajbari|রাজবাড়ী|manikganj|মানিকগঞ্জ|munshiganj|মুন্সিগঞ্জ|narsingdi|নরসিংদী/, thana: "Mymensingh Sadar", district: "Mymensingh", division: "Mymensingh Division", lat: 24.7471, lng: 90.4203 },
    ];

    for (const g of gazetteer) {
      if (g.rx.test(raw)) {
        return {
          success: true,
          formatted_address: `${req.address}, ${req.thana || g.thana}, ${req.district || g.district}, Bangladesh`,
          thana: req.thana || g.thana,
          district: req.district || g.district,
          division: g.division,
          coordinates: { lat: g.lat, lng: g.lng },
          location_type: "GEOMETRIC_CENTER",
          is_deliverable: true,
          confidence_score: 84,
          place_id: `bd_gazetteer_${g.district.toLowerCase().replace(/\s+/g, "_")}`,
        };
      }
    }

    const isDhaka = /dhaka|ঢাকা/i.test(raw);
    return {
      success: true,
      formatted_address: req.address,
      thana: req.thana || (isDhaka ? "Dhaka Metro" : "Sadar"),
      district: req.district || (isDhaka ? "Dhaka" : "Outside Dhaka"),
      division: isDhaka ? "Dhaka Division" : "Bangladesh",
      coordinates: isDhaka ? { lat: 23.8103, lng: 90.4125 } : { lat: 24.0000, lng: 90.0000 },
      location_type: "APPROXIMATE",
      is_deliverable: true,
      confidence_score: 72,
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
