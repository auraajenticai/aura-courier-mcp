import axios from "axios";
export class PaperflyAdapter {
    courierName = "paperfly";
    apiKey;
    username;
    password;
    storeName;
    client;
    enabled;
    constructor(apiKey, username, password, storeName, baseUrl) {
        this.apiKey = apiKey;
        this.username = username;
        this.password = password;
        this.storeName = storeName;
        this.enabled = Boolean(apiKey && username && password);
        this.client = axios.create({
            baseURL: baseUrl,
            timeout: 15000,
            headers: { "Content-Type": "application/json" },
        });
    }
    isConfigured() {
        return this.enabled;
    }
    async createParcel(req) {
        if (!this.enabled) {
            throw new Error("Paperfly credentials (paperflykey + merchant username & password) are not configured.");
        }
        if (!this.storeName) {
            throw new Error("Paperfly store name is required to create a parcel.");
        }
        const payload = {
            merchantOrderReference: req.invoice,
            storeName: this.storeName,
            productBrief: req.item_type || "Product",
            packagePrice: String(req.value ?? req.cod_amount ?? 0),
            max_weight: String(req.item_weight ?? 0.5),
            customerName: req.recipient_name,
            customerAddress: req.recipient_address,
            customerPhone: req.recipient_phone,
        };
        const response = await this.client.post("/merchant/api/service/new_order_v2.php", payload, {
            headers: { paperflykey: this.apiKey },
            auth: { username: this.username, password: this.password },
        });
        const data = response.data;
        const ok = data?.success;
        if (!ok?.tracking_number) {
            throw new Error(`Paperfly API error: ${JSON.stringify(data?.error || data?.message || data)}`);
        }
        return {
            success: true,
            courier: "paperfly",
            tracking_code: ok.tracking_number,
            consignment_id: ok.tracking_barcode || ok.tracking_number,
            invoice: req.invoice,
            status: ok.message || "created",
            cod_amount: req.cod_amount,
            created_at: new Date().toISOString(),
            raw_response: data,
        };
    }
    async trackParcel(trackingCode) {
        if (!this.enabled) {
            throw new Error("Paperfly credentials are not configured.");
        }
        if (!this.username || !this.password) {
            throw new Error("Paperfly tracking needs your merchant-panel username & password (Basic Auth). Add them to use track_parcel.");
        }
        // Paperfly tracks by your merchant order reference (merchantOrderReference), not its tracking number.
        const response = await this.client.post("/API-Order-Tracking", { ReferenceNumber: trackingCode }, { headers: { paperflykey: this.apiKey }, auth: { username: this.username, password: this.password } });
        const data = response.data;
        const st = data?.success?.trackingStatus?.[0] || {};
        const stages = [
            [st.Delivered, "delivered"],
            [st.Partial, "partial-delivery"],
            [st.Returned, "returned"],
            [st.PickedForDelivery, "out-for-delivery"],
            [st.inTransit, "in-transit"],
            [st.ReceivedAtPoint, "received-at-point"],
            [st.Pick, "picked-up"],
        ];
        const status = stages.find(([v]) => v && String(v).trim())?.[1] || data?.success?.message || "pending";
        return {
            success: true,
            courier: "paperfly",
            tracking_code: trackingCode,
            status,
            updated_at: new Date().toISOString(),
            raw_response: data,
        };
    }
    async getBalance() {
        throw new Error("Paperfly does not expose a merchant balance endpoint via its public API — check the Paperfly merchant panel.");
    }
}
