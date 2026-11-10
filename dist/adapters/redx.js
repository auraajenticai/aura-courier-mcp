import axios from "axios";
import { McpToolError, withGetRetry } from "../envelope.js";
export class RedxAdapter {
    courierName = "redx";
    client;
    enabled;
    pickupStoreId;
    constructor(apiToken, baseUrl, pickupStoreId = "") {
        this.enabled = Boolean(apiToken);
        this.pickupStoreId = pickupStoreId;
        this.client = axios.create({
            baseURL: baseUrl,
            headers: {
                "API-ACCESS-TOKEN": `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            timeout: 15000,
        });
    }
    isConfigured() {
        return this.enabled;
    }
    // RedX's create endpoint needs a numeric delivery_area_id. If the caller did
    // not pass one, best-effort resolve it from the address via GET /areas.
    async resolveDeliveryArea(req) {
        if (req.delivery_area_id) {
            return { id: Number(req.delivery_area_id), name: req.delivery_area || "" };
        }
        const res = await this.client.get("/areas");
        const areas = res.data?.areas || [];
        const addr = (req.recipient_address || "").toLowerCase();
        let best = null;
        for (const a of areas) {
            const base = String(a.name).split("(")[0].trim().toLowerCase();
            if (base && addr.includes(base)) {
                const bestLen = best ? String(best.name).split("(")[0].trim().length : 0;
                if (base.length > bestLen)
                    best = a;
            }
        }
        if (!best) {
            throw new Error("RedX: could not match a delivery area from the address. Pass 'delivery_area_id' explicitly (look it up via RedX /areas).");
        }
        return { id: best.id, name: best.name };
    }
    async createParcel(req) {
        if (!this.enabled) {
            throw new Error("RedX credentials (API access token) are not configured.");
        }
        const area = await this.resolveDeliveryArea(req);
        const weightGrams = Math.max(1, Math.round((req.item_weight ?? 0.5) * 1000));
        const declaredValue = String(req.value ?? req.cod_amount ?? 0);
        const payload = {
            customer_name: req.recipient_name,
            customer_phone: req.recipient_phone,
            delivery_area: area.name || req.delivery_area || "",
            delivery_area_id: area.id,
            customer_address: req.recipient_address,
            merchant_invoice_id: req.invoice,
            cash_collection_amount: String(req.cod_amount ?? 0),
            parcel_weight: weightGrams,
            instruction: req.note || "Aura AI automated dispatch",
            value: declaredValue,
        };
        const storeId = req.pickup_store_id || this.pickupStoreId;
        if (storeId)
            payload.pickup_store_id = Number(storeId);
        if (req.item_type) {
            payload.parcel_details_json = [
                { name: req.item_type, category: req.item_category || "general", value: Number(req.value ?? req.cod_amount ?? 0) },
            ];
        }
        const response = await this.client.post("/parcel", payload);
        const data = response.data;
        const trackingId = data?.tracking_id;
        if (!trackingId) {
            throw new Error(`RedX API error: ${JSON.stringify(data?.message || data)}`);
        }
        return {
            success: true,
            courier: "redx",
            tracking_code: trackingId,
            consignment_id: trackingId,
            invoice: req.invoice,
            status: "pickup-pending",
            cod_amount: req.cod_amount,
            created_at: new Date().toISOString(),
            raw_response: data,
        };
    }
    async trackParcel(trackingCode) {
        if (!this.enabled) {
            throw new McpToolError({
                code: "COURIER_NOT_CONFIGURED",
                message: "RedX credentials are not configured.",
                courier: "redx",
            });
        }
        try {
            const response = await withGetRetry(() => this.client.get(`/parcel/track/${encodeURIComponent(trackingCode)}`));
            const data = response.data;
            const events = data?.tracking || [];
            const latest = events[events.length - 1];
            return {
                success: true,
                courier: "redx",
                tracking_code: trackingCode,
                status: latest?.message_en || "in-transit",
                updated_at: latest?.time || new Date().toISOString(),
                timeline: events.map((e) => ({ status: e.message_en || "", time: e.time || "", note: e.message_bn })),
                raw_response: data,
            };
        }
        catch (err) {
            if (err?.response?.status === 404 || err?.response?.status === 400) {
                throw new McpToolError({
                    code: "CONSIGNMENT_NOT_FOUND",
                    message: `Consignment '${trackingCode}' was not found in RedX.`,
                    retryable: false,
                    courier: "redx",
                });
            }
            throw err;
        }
    }
    /**
     * RedX does not expose a live wallet balance API endpoint (T3).
     */
    async getBalance() {
        return {
            success: true,
            courier: "redx",
            amount_bdt: null,
            pending_bdt: null,
            current_balance: null,
            status: "UNSUPPORTED_BY_PROVIDER",
            hint: "Use RedX merchant portal",
        };
    }
    /**
     * Authentic Upstream RedX Cancellation
     * Endpoint: PATCH /parcels
     */
    async cancelParcel(trackingId, reason) {
        if (!this.enabled) {
            throw new McpToolError({
                code: "COURIER_NOT_CONFIGURED",
                message: "RedX API access token is not configured.",
                courier: "redx",
            });
        }
        try {
            const response = await this.client.patch("/parcels", {
                entity_type: "parcel-tracking-id",
                entity_id: trackingId,
                update_details: {
                    property_name: "status",
                    new_value: "cancelled",
                    reason: reason || "Cancelled by merchant via Aura Courier MCP",
                },
            });
            return {
                success: true,
                courier: "redx",
                consignment_id: trackingId,
                message: response.data?.message || "Parcel successfully cancelled in RedX Delivery.",
                raw_response: response.data,
            };
        }
        catch (err) {
            const msg = err.response?.data?.message || err.message;
            throw new McpToolError({
                code: "COURIER_UPSTREAM_ERROR",
                message: `RedX cancellation failed: ${msg}`,
                courier: "redx",
                retryable: false,
            });
        }
    }
}
