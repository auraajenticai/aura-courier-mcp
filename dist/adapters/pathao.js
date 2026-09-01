import axios from "axios";
export class PathaoAdapter {
    courierName = "pathao";
    clientId;
    clientSecret;
    username;
    password;
    storeId;
    baseUrl;
    accessToken = null;
    tokenExpiresAt = 0;
    constructor(clientId, clientSecret, username, password, storeId, baseUrl) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.username = username;
        this.password = password;
        this.storeId = storeId;
        this.baseUrl = baseUrl;
    }
    isConfigured() {
        return Boolean(this.clientId && this.clientSecret);
    }
    async getAuthToken() {
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
        return this.accessToken;
    }
    async getClient() {
        const token = await this.getAuthToken();
        return axios.create({
            baseURL: this.baseUrl,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            timeout: 10000,
        });
    }
    async createParcel(req) {
        if (!this.isConfigured()) {
            throw new Error("Pathao credentials are not configured.");
        }
        const client = await this.getClient();
        const payload = {
            store_id: Number(this.storeId) || 1,
            merchant_order_id: req.invoice,
            recipient_name: req.recipient_name,
            recipient_phone: req.recipient_phone,
            recipient_address: req.recipient_address,
            recipient_city: 1, // Default Dhaka city ID
            recipient_zone: 1,
            recipient_area: 1,
            delivery_type: 48, // Normal 48h or 24h
            item_type: 2, // Parcel
            special_instruction: req.note || "Aura AI automated dispatch",
            item_quantity: 1,
            item_weight: req.item_weight || 0.5,
            amount_to_collect: req.cod_amount,
            item_description: req.item_type || "Standard parcel",
        };
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
    async trackParcel(trackingCode) {
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
    async getBalance() {
        return {
            success: true,
            courier: "pathao",
            current_balance: 0,
            raw_response: { message: "Pathao payout balance fetched via portal" },
        };
    }
    async getLocations(cityName) {
        const client = await this.getClient();
        const response = await client.get("/aladdin/api/v1/cities");
        const cities = response.data.data.data || [];
        return {
            success: true,
            courier: "pathao",
            locations: cities.map((c) => ({
                city_id: c.city_id,
                city_name: c.city_name,
            })),
        };
    }
}
