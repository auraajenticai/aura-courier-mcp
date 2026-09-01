import axios from "axios";
export class RedXAdapter {
    courierName = "redx";
    client;
    apiToken;
    enabled;
    constructor(apiToken, baseUrl = "https://openapi.redx.com.bd/v1.0.0-beta") {
        this.apiToken = apiToken;
        this.enabled = Boolean(apiToken);
        this.client = axios.create({
            baseURL: baseUrl,
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            timeout: 10000,
        });
    }
    isConfigured() {
        return this.enabled;
    }
    async createParcel(req) {
        if (!this.enabled) {
            throw new Error("RedX Courier credentials (API Token) are not configured.");
        }
        const payload = {
            customer_name: req.recipient_name,
            customer_phone: req.recipient_phone,
            delivery_area: req.recipient_address,
            delivery_area_id: 1, // Default auto-resolved area
            customer_address: req.recipient_address,
            merchant_invoice_id: req.invoice,
            cash_collection_amount: req.cod_amount,
            parcel_weight: (req.item_weight || 0.5) * 1000, // RedX uses grams
            instruction: req.note || "Aura AI automated dispatch",
            value: req.cod_amount || 500,
        };
        const response = await this.client.post("/parcels", payload);
        const trackingId = response.data.tracking_id || response.data.parcel_id;
        return {
            success: true,
            courier: "redx",
            tracking_code: trackingId,
            consignment_id: trackingId,
            invoice: req.invoice,
            status: "ready_for_pickup",
            cod_amount: req.cod_amount,
            delivery_fee: response.data.delivery_fee || 60,
            created_at: new Date().toISOString(),
            raw_response: response.data,
        };
    }
    async trackParcel(trackingCode) {
        if (!this.enabled) {
            throw new Error("RedX Courier credentials are not configured.");
        }
        const response = await this.client.get(`/parcels/track/${encodeURIComponent(trackingCode)}`);
        const data = response.data;
        return {
            success: true,
            courier: "redx",
            tracking_code: trackingCode,
            status: data.tracking?.status || "in_transit",
            timeline: (data.tracking?.history || []).map((h) => ({
                status: h.status,
                time: h.created_at,
                note: h.message,
            })),
            raw_response: data,
        };
    }
    async getBalance() {
        return {
            success: true,
            courier: "redx",
            current_balance: 0,
            raw_response: { message: "RedX payouts are disbursed directly to connected merchant bank accounts." },
        };
    }
    async getLocations(cityName) {
        const response = await this.client.get("/areas");
        const areas = response.data.areas || [];
        return {
            success: true,
            courier: "redx",
            locations: areas.map((a) => ({
                city_id: a.id,
                city_name: a.name,
                zone_name: a.zone_name,
                area_name: a.name,
            })),
        };
    }
}
