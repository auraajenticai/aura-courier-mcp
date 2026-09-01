import axios from "axios";
export class PaperflyAdapter {
    courierName = "paperfly";
    client;
    user;
    pass;
    key;
    enabled;
    constructor(user, pass, key, baseUrl = "https://api.paperfly.com.bd") {
        this.user = user;
        this.pass = pass;
        this.key = key;
        this.enabled = Boolean(user && pass && key);
        const token = Buffer.from(`${user}:${pass}`).toString("base64");
        this.client = axios.create({
            baseURL: baseUrl,
            headers: {
                Authorization: `Basic ${token}`,
                pap_key: key,
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
            throw new Error("Paperfly Courier credentials (User / Pass / Key) are not configured.");
        }
        const payload = {
            merOrderRef: req.invoice,
            pickMerchantName: "Aura AI Commerce",
            pickMerchantAddress: "Dhaka, Bangladesh",
            custName: req.recipient_name,
            custPhone: req.recipient_phone,
            custAddr: req.recipient_address,
            customerDistrict: "Dhaka",
            customerThana: "Gulshan",
            packagePrice: req.cod_amount,
            max_weight: req.item_weight || 0.5,
            productBrief: req.item_type || "General Ecommerce item",
            deliveryOption: "regular",
        };
        const response = await this.client.post("/OrderPlacement", payload);
        const trackingCode = response.data?.tracking_number || req.invoice;
        return {
            success: true,
            courier: "paperfly",
            tracking_code: trackingCode,
            consignment_id: trackingCode,
            invoice: req.invoice,
            status: "order_placed",
            cod_amount: req.cod_amount,
            created_at: new Date().toISOString(),
            raw_response: response.data,
        };
    }
    async trackParcel(trackingCode) {
        if (!this.enabled) {
            throw new Error("Paperfly Courier credentials are not configured.");
        }
        const response = await this.client.post("/Tracking", {
            ReferenceNumber: trackingCode,
        });
        const data = response.data;
        return {
            success: true,
            courier: "paperfly",
            tracking_code: trackingCode,
            status: data?.Status || "in_progress",
            updated_at: new Date().toISOString(),
            raw_response: data,
        };
    }
    async getBalance() {
        return {
            success: true,
            courier: "paperfly",
            current_balance: 0,
            raw_response: { message: "Paperfly merchant settlements processed weekly via Wingman portal." },
        };
    }
}
