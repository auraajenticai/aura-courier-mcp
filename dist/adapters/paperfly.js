import axios from "axios";
import { McpToolError } from "../envelope.js";
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
            throw new McpToolError({
                code: "COURIER_NOT_CONFIGURED",
                message: "Paperfly credentials are not configured.",
                courier: "paperfly",
            });
        }
        if (!this.username || !this.password) {
            throw new McpToolError({
                code: "COURIER_NOT_CONFIGURED",
                message: "Paperfly tracking requires merchant-panel username and password.",
                courier: "paperfly",
            });
        }
        try {
            const response = await this.client.post("/API-Order-Tracking", { ReferenceNumber: trackingCode }, { headers: { paperflykey: this.apiKey }, auth: { username: this.username, password: this.password } });
            const data = response.data;
            if (data?.error) {
                throw new McpToolError({
                    code: "CONSIGNMENT_NOT_FOUND",
                    message: `Consignment '${trackingCode}' was not found in Paperfly.`,
                    retryable: false,
                    courier: "paperfly",
                });
            }
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
        catch (err) {
            if (err instanceof McpToolError)
                throw err;
            if (err?.response?.status === 400 || err?.response?.status === 404) {
                throw new McpToolError({
                    code: "CONSIGNMENT_NOT_FOUND",
                    message: `Consignment '${trackingCode}' was not found in Paperfly.`,
                    retryable: false,
                    courier: "paperfly",
                });
            }
            throw err;
        }
    }
    /**
     * Paperfly does not expose a live wallet balance API endpoint (T3).
     */
    async getBalance() {
        return {
            success: true,
            courier: "paperfly",
            amount_bdt: null,
            pending_bdt: null,
            current_balance: null,
            status: "UNSUPPORTED_BY_PROVIDER",
            hint: "Use Paperfly merchant portal",
        };
    }
    /**
     * Authentic Upstream Paperfly Cancellation
     * Endpoint: POST /api/v1/cancel-order
     */
    async cancelParcel(orderId, reason) {
        if (!this.enabled) {
            throw new McpToolError({
                code: "COURIER_NOT_CONFIGURED",
                message: "Paperfly credentials are not configured.",
                courier: "paperfly",
            });
        }
        try {
            const response = await this.client.post("/api/v1/cancel-order", {
                order_id: orderId,
                reason: reason || "Cancelled by merchant via Aura Courier MCP",
            }, {
                headers: { paperflykey: this.apiKey },
                auth: { username: this.username, password: this.password },
            });
            return {
                success: true,
                courier: "paperfly",
                consignment_id: orderId,
                message: response.data?.success?.message || response.data?.message || "Parcel successfully cancelled in Paperfly Go.",
                raw_response: response.data,
            };
        }
        catch (err) {
            const msg = err.response?.data?.message || err.message;
            throw new McpToolError({
                code: "COURIER_UPSTREAM_ERROR",
                message: `Paperfly cancellation failed: ${msg}`,
                courier: "paperfly",
                retryable: false,
            });
        }
    }
}
