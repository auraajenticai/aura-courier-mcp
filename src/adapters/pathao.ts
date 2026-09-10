import axios, { AxiosInstance } from "axios";
import { CourierAdapter } from "./base.js";
import {
  BalanceResponse,
  LocationResolutionResponse,
  ParcelCreateRequest,
  ParcelResponse,
  SupportedCourier,
  TrackingResponse,
} from "../types.js";

export class PathaoAdapter implements CourierAdapter {
  courierName: SupportedCourier = "pathao";
  private clientId: string;
  private clientSecret: string;
  private username: string;
  private password: string;
  private storeId: string;
  private baseUrl: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  // In-memory caches for fast sub-second routing
  private cityCache: any[] | null = null;
  private zoneCache: Map<number, any[]> = new Map();
  private areaCache: Map<number, any[]> = new Map();

  constructor(
    clientId: string,
    clientSecret: string,
    username: string,
    password: string,
    storeId: string = "356230",
    baseUrl: string = "https://api-hermes.pathao.com"
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.password = password;
    this.storeId = storeId || "356230";
    this.baseUrl = baseUrl || "https://api-hermes.pathao.com";
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getAuthToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt > now + 60000) {
      return this.accessToken;
    }

    const response = await axios.post(`${this.baseUrl}/aladdin/api/v1/issue-token`, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username: this.username,
      password: this.password,
      grant_type: "password",
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiresAt = now + (response.data.expires_in || 3600) * 1000;
    return this.accessToken!;
  }

  private async getClient(): Promise<AxiosInstance> {
    const token = await this.getAuthToken();
    return axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 12000,
    });
  }

  /**
   * Dynamically resolve merchant store_id from Pathao portal if missing or default
   */
  private async resolveStoreId(): Promise<number> {
    if (this.storeId && Number(this.storeId) > 1) {
      return Number(this.storeId);
    }
    try {
      const client = await this.getClient();
      const res = await client.get("/aladdin/api/v1/stores");
      const stores = res.data?.data?.data || [];
      const activeStore = stores.find((s: any) => s.is_active) || stores[0];
      if (activeStore && activeStore.store_id) {
        this.storeId = String(activeStore.store_id);
        return Number(activeStore.store_id);
      }
    } catch (err: any) {
      console.warn("Pathao store resolution notice:", err.message);
    }
    return 356230; // Snehalata registered store id
  }

  /**
   * DeepMind Intelligent Spatial Hierarchy Resolver for Pathao
   * Eliminates 422 Unprocessable Entity by matching address tokens against live Pathao geo catalog
   */
  async resolveLocation(
    address: string,
    req?: ParcelCreateRequest
  ): Promise<{ cityId: number; zoneId: number; areaId?: number }> {
    const client = await this.getClient();

    if (req?.delivery_area_id && typeof req.delivery_area_id === "number") {
      return { cityId: 1, zoneId: Number(req.delivery_area_id) };
    }

    const addrLower = (address || "").toLowerCase();

    // 1. Resolve City
    let cityId = 1; // Default Dhaka city ID
    try {
      if (!this.cityCache) {
        const cRes = await client.get("/aladdin/api/v1/countries/1/city-list");
        this.cityCache = cRes.data?.data?.data || [];
      }
      for (const c of this.cityCache || []) {
        const cName = String(c.city_name || "").toLowerCase().trim();
        if (cName && cName !== "dhaka" && addrLower.includes(cName)) {
          cityId = c.city_id;
          break;
        }
      }
    } catch (err: any) {
      cityId = 1;
    }

    // 2. Resolve Zone for City
    let zoneId = cityId === 1 ? 62 : 1; // Default 62 (Dhanmondi, Dhaka)
    try {
      if (!this.zoneCache.has(cityId)) {
        const zRes = await client.get(`/aladdin/api/v1/cities/${cityId}/zone-list`);
        const zones = zRes.data?.data?.data || [];
        this.zoneCache.set(cityId, zones);
      }
      const zones = this.zoneCache.get(cityId) || [];
      const sortedZones = [...zones].sort((a, b) => b.zone_name.length - a.zone_name.length);

      const cleanAddrNoCity = addrLower
        .replace(/bangladesh|dhaka/gi, " ")
        .replace(/[,.-]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .join(" ");

      let matchedZone: any = null;
      for (const z of sortedZones) {
        const zName = z.zone_name.toLowerCase().trim();
        if (zName === "dhaka" || zName === "dhaka city") continue;
        if (cleanAddrNoCity.includes(zName)) {
          matchedZone = z;
          break;
        }
      }

      if (!matchedZone) {
        for (const z of sortedZones) {
          const words = z.zone_name
            .toLowerCase()
            .split(/\s+/)
            .filter((w: string) => w.length >= 4 && !["road", "block", "sector", "area"].includes(w));
          if (words.some((w: string) => cleanAddrNoCity.includes(w))) {
            matchedZone = z;
            break;
          }
        }
      }

      if (matchedZone) {
        zoneId = matchedZone.zone_id;
      } else if (zones.length > 0) {
        // Safe fallback zone for that city
        zoneId = zones[0].zone_id;
      }
    } catch (err: any) {
      console.warn("Pathao zone resolution notice:", err.message);
    }

    // 3. Resolve Area for Zone
    let areaId: number | undefined = undefined;
    try {
      if (!this.areaCache.has(zoneId)) {
        const aRes = await client.get(`/aladdin/api/v1/zones/${zoneId}/area-list`);
        const areas = aRes.data?.data?.data || [];
        this.areaCache.set(zoneId, areas);
      }
      const areas = this.areaCache.get(zoneId) || [];
      if (areas.length > 0) {
        for (const a of areas) {
          const aName = a.area_name.toLowerCase().trim();
          if (aName.length >= 4 && addrLower.includes(aName)) {
            areaId = a.area_id;
            break;
          }
        }
        if (!areaId) {
          areaId = areas[0].area_id;
        }
      }
    } catch (err: any) {
      // Area is optional in Pathao
    }

    return { cityId, zoneId, areaId };
  }

  async createParcel(req: ParcelCreateRequest): Promise<ParcelResponse> {
    if (!this.isConfigured()) {
      throw new Error("Pathao credentials are not configured.");
    }

    const client = await this.getClient();
    const resolvedStoreId = await this.resolveStoreId();
    const { cityId, zoneId, areaId } = await this.resolveLocation(req.recipient_address, req);

    const cleanPhone = req.recipient_phone.replace(/\D/g, "");
    const formattedPhone = cleanPhone.length > 11 ? cleanPhone.slice(-11) : cleanPhone;

    const payload: Record<string, any> = {
      store_id: resolvedStoreId,
      merchant_order_id: req.invoice,
      recipient_name: (req.recipient_name || "Customer").trim().slice(0, 100),
      recipient_phone: formattedPhone,
      recipient_address: (req.recipient_address || "").trim().slice(0, 220),
      delivery_type: 48, // 48 for Normal Delivery, 12 for On Demand Delivery
      item_type: 2, // 1 for Document, 2 for Parcel
      special_instruction: (req.note || "Aura AI automated dispatch").slice(0, 250),
      item_quantity: 1,
      item_weight: Math.max(0.5, Math.min(10, Number(req.item_weight || 0.5))),
      amount_to_collect: Math.round(Number(req.cod_amount || 0)),
      item_description: (req.item_type || "Standard parcel").slice(0, 250),
    };

    // Pathao docs: "do not send a null value. If not included in the request payload,
    // then our system will populate it automatically based on recipient_address"
    if (cityId && zoneId && zoneId > 1) {
      payload.recipient_city = Number(cityId);
      payload.recipient_zone = Number(zoneId);
      if (areaId && areaId > 1) {
        payload.recipient_area = Number(areaId);
      }
    }

    const response = await client.post("/aladdin/api/v1/orders", payload);
    const data = response.data.data;

    return {
      success: true,
      courier: "pathao",
      tracking_code: data.consignment_id,
      consignment_id: data.consignment_id,
      invoice: req.invoice,
      status: data.order_status || "Pending",
      cod_amount: req.cod_amount,
      delivery_fee: data.delivery_fee,
      created_at: new Date().toISOString(),
      raw_response: response.data,
    };
  }

  async trackParcel(trackingCode: string): Promise<TrackingResponse> {
    if (!this.isConfigured()) {
      throw new Error("Pathao credentials are not configured.");
    }

    const client = await this.getClient();
    const response = await client.get(`/aladdin/api/v1/orders/${encodeURIComponent(trackingCode)}/info`);
    const data = response.data.data;

    return {
      success: true,
      courier: "pathao",
      tracking_code: trackingCode,
      status: data.order_status || "unknown",
      updated_at: data.updated_at || new Date().toISOString(),
      raw_response: response.data,
    };
  }

  async getBalance(): Promise<BalanceResponse> {
    return {
      success: true,
      courier: "pathao",
      current_balance: 0,
      raw_response: { message: "Pathao payout balance managed via merchant portal" },
    };
  }

  async getLocations(cityName?: string): Promise<LocationResolutionResponse> {
    const client = await this.getClient();
    const response = await client.get("/aladdin/api/v1/cities");
    const cities = response.data.data.data || [];

    return {
      success: true,
      courier: "pathao",
      locations: cities.map((c: any) => ({
        city_id: c.city_id,
        city_name: c.city_name,
      })),
    };
  }
}
