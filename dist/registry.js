import { SteadfastAdapter } from "./adapters/steadfast.js";
import { PathaoAdapter } from "./adapters/pathao.js";
import { FraudRiskEngine } from "./adapters/fraud_engine.js";
import { RedxAdapter } from "./adapters/redx.js";
import { PaperflyAdapter } from "./adapters/paperfly.js";
import { GoogleMapsAdapter } from "./adapters/google_maps.js";
import { loadConfig } from "./config.js";
import { McpToolError } from "./envelope.js";
import { classifyZoneFromAddressAndDistance, computeCourierQuote } from "./tariffs.js";
/**
 * Process-wide Idempotency Store keyed by `${tenantId}:${invoice}` (Task T8).
 */
const idempotencyStore = new Map();
export function clearIdempotencyStore() {
    idempotencyStore.clear();
}
/**
 * Process-wide Verified Webhook Event Ring Buffer (Task T1 & T8).
 */
const MAX_WEBHOOK_EVENTS = 1000;
const webhookEventsStore = [];
export function recordWebhookEvent(event) {
    webhookEventsStore.push(event);
    if (webhookEventsStore.length > MAX_WEBHOOK_EVENTS) {
        webhookEventsStore.shift();
    }
}
export function clearWebhookEvents() {
    webhookEventsStore.length = 0;
}
export class CourierRegistry {
    adapters = new Map();
    googleMaps;
    constructor(config = loadConfig()) {
        const steadfast = new SteadfastAdapter(config.steadfast.apiKey, config.steadfast.secretKey, config.steadfast.baseUrl);
        this.adapters.set("steadfast", steadfast);
        const pathao = new PathaoAdapter(config.pathao.clientId, config.pathao.clientSecret, config.pathao.username, config.pathao.password, config.pathao.storeId, config.pathao.baseUrl);
        this.adapters.set("pathao", pathao);
        const redx = new RedxAdapter(config.redx.apiToken, config.redx.baseUrl, config.redx.pickupStoreId);
        this.adapters.set("redx", redx);
        const paperfly = new PaperflyAdapter(config.paperfly.apiKey, config.paperfly.username, config.paperfly.password, config.paperfly.storeName, config.paperfly.baseUrl);
        this.adapters.set("paperfly", paperfly);
        this.googleMaps = new GoogleMapsAdapter(config.googleMaps?.apiKey || process.env.GOOGLE_MAPS_API_KEY);
    }
    listCouriers() {
        const list = Array.from(this.adapters.entries()).map(([name, adapter]) => ({
            courier: name,
            is_configured: adapter.isConfigured(),
        }));
        list.push({
            courier: "google_maps",
            is_configured: this.googleMaps.isConfigured(),
        });
        return {
            couriers: list,
            configured_count: list.filter((c) => c.is_configured).length,
        };
    }
    getAdapter(name) {
        const adapter = this.adapters.get(name);
        if (!adapter) {
            throw new McpToolError({
                code: "INVALID_INPUT",
                message: `Courier '${name}' is not supported. Supported couriers: steadfast, pathao, redx, paperfly.`,
            });
        }
        return adapter;
    }
    getGoogleMaps() {
        return this.googleMaps;
    }
    resolveSmartAutoCourierOrder(address, priority = "balanced") {
        const { zone } = classifyZoneFromAddressAndDistance(address);
        let idealOrder;
        if (zone === "inside_dhaka") {
            idealOrder =
                priority === "cheapest"
                    ? ["pathao", "redx", "paperfly", "steadfast"]
                    : ["pathao", "redx", "steadfast", "paperfly"];
        }
        else if (zone === "sub_dhaka") {
            idealOrder =
                priority === "fastest"
                    ? ["pathao", "steadfast", "redx", "paperfly"]
                    : ["paperfly", "steadfast", "pathao", "redx"];
        }
        else {
            idealOrder =
                priority === "cheapest"
                    ? ["paperfly", "pathao", "steadfast", "redx"]
                    : ["steadfast", "paperfly", "pathao", "redx"];
        }
        const configured = idealOrder.filter((c) => this.adapters.get(c)?.isConfigured());
        return configured.length > 0 ? configured : idealOrder;
    }
    async createParcel(req) {
        const cleanPhone = String(req.recipient_phone || "")
            .replace(/[\s\-+]/g, "")
            .replace(/^88/, "");
        const phoneOk = /^01[3-9]\d{8}$/.test(cleanPhone);
        if (!phoneOk) {
            throw new McpToolError({
                code: "INVALID_INPUT",
                message: `Invalid Bangladeshi mobile number '${req.recipient_phone}'. Expected 11 digits matching 01[3-9]XXXXXXXX.`,
                retryable: false,
            });
        }
        const addrStr = String(req.recipient_address || "").trim();
        const addressOk = addrStr.length >= 5;
        if (!addressOk) {
            throw new McpToolError({
                code: "INVALID_INPUT",
                message: "Recipient address must be at least 5 characters long.",
                retryable: false,
            });
        }
        const invoice = String(req.invoice || "").trim();
        if (!invoice) {
            throw new McpToolError({
                code: "INVALID_INPUT",
                message: "A non-empty invoice identifier is required.",
                retryable: false,
            });
        }
        const rawChoice = String(req.courier || "auto").toLowerCase();
        const isAuto = rawChoice === "auto" || rawChoice.startsWith("auto_");
        const priority = rawChoice === "auto_fastest" ? "fastest" : rawChoice === "auto_cheapest" ? "cheapest" : "balanced";
        const { zone } = classifyZoneFromAddressAndDistance(addrStr);
        const candidates = isAuto
            ? this.resolveSmartAutoCourierOrder(addrStr, priority)
            : [rawChoice];
        const primaryCourier = candidates[0] || "steadfast";
        const weightKg = Number(req.item_weight || 0.5);
        const codAmount = Number(req.cod_amount || 0);
        const quote = computeCourierQuote(primaryCourier, zone, weightKg, codAmount);
        const routingReason = isAuto
            ? `Auto-selected '${primaryCourier}' for zone='${zone}' with priority='${priority}' (estimated ${quote.total_cost} BDT).`
            : `Explicitly targeted '${primaryCourier}' for zone='${zone}' (estimated ${quote.total_cost} BDT).`;
        const needsReview = addrStr.split(/[\s,]+/).filter(Boolean).length < 3;
        // Task T8: Dry-run validation & quote mode (zero upstream calls)
        if (req.dry_run === true) {
            return {
                success: true,
                courier: primaryCourier,
                tracking_code: "DRY-RUN",
                consignment_id: "DRY-RUN",
                invoice,
                status: "DRY_RUN",
                cod_amount: codAmount,
                would_book_with: primaryCourier,
                estimated_cost_bdt: quote.total_cost,
                cost_estimate_bdt: quote.total_cost,
                routing_reason: routingReason,
                cancellable_via_api: false,
                validation: {
                    phone_ok: true,
                    address_ok: true,
                    needs_review: needsReview,
                },
            };
        }
        // Task T8: Idempotency by (tenant_id, invoice)
        const tenantKey = String(req.tenant_id || "default");
        const idemKey = `${tenantKey}:${invoice}`;
        const existing = idempotencyStore.get(idemKey);
        if (existing) {
            return {
                ...existing,
                idempotent_replay: true,
            };
        }
        let lastErr = null;
        for (const courierName of candidates) {
            try {
                const adapter = this.getAdapter(courierName);
                const res = await adapter.createParcel({
                    ...req,
                    recipient_phone: cleanPhone,
                    recipient_address: addrStr,
                    invoice,
                    courier: courierName,
                });
                if (res && res.success !== false && (res.tracking_code || res.consignment_id)) {
                    const courierQuote = computeCourierQuote(courierName, zone, weightKg, codAmount);
                    const enriched = {
                        ...res,
                        idempotent_replay: false,
                        routing_reason: isAuto
                            ? `Auto-selected '${courierName}' for zone='${zone}' with priority='${priority}'.`
                            : `Booked on explicitly requested courier '${courierName}'.`,
                        estimated_cost_bdt: courierQuote.total_cost,
                        cost_estimate_bdt: courierQuote.total_cost,
                        cancellable_via_api: false,
                        validation: {
                            phone_ok: true,
                            address_ok: true,
                            needs_review: needsReview,
                        },
                    };
                    idempotencyStore.set(idemKey, enriched);
                    return enriched;
                }
                lastErr = new McpToolError({
                    code: "COURIER_UPSTREAM_ERROR",
                    message: res?.message || res?.error || `${courierName} rejected parcel booking.`,
                    courier: courierName,
                });
            }
            catch (err) {
                lastErr = err;
            }
        }
        if (lastErr instanceof McpToolError) {
            throw lastErr;
        }
        throw new McpToolError({
            code: "COURIER_UPSTREAM_ERROR",
            message: lastErr?.message || "All configured courier gateways failed to book parcel.",
        });
    }
    async trackParcel(trackingCode, courierName) {
        const cleanCode = String(trackingCode || "").trim();
        if (!cleanCode) {
            throw new McpToolError({
                code: "INVALID_INPUT",
                message: "Tracking code must not be empty.",
            });
        }
        if (courierName) {
            try {
                const res = await this.getAdapter(courierName).trackParcel(cleanCode);
                if (res && res.success) {
                    return res;
                }
            }
            catch (err) {
                if (err instanceof McpToolError && err.code === "CONSIGNMENT_NOT_FOUND") {
                    throw new McpToolError({
                        code: "CONSIGNMENT_NOT_FOUND",
                        message: err.message,
                        courier: courierName,
                        retryable: false,
                        extraFields: { couriers_checked: [courierName] },
                    });
                }
                throw err;
            }
            throw new McpToolError({
                code: "CONSIGNMENT_NOT_FOUND",
                message: `Consignment '${cleanCode}' not found on ${courierName}.`,
                courier: courierName,
                retryable: false,
                extraFields: { couriers_checked: [courierName] },
            });
        }
        const codeUpper = cleanCode.toUpperCase();
        let order = ["pathao", "steadfast", "redx", "paperfly"];
        if (codeUpper.startsWith("DS") || codeUpper.startsWith("DB") || codeUpper.startsWith("DT")) {
            order = ["pathao", "steadfast", "redx", "paperfly"];
        }
        else if (codeUpper.startsWith("REDX") || codeUpper.startsWith("RX") || /^2[3-9][A-Z0-9]{6,}$/.test(codeUpper)) {
            order = ["redx", "pathao", "steadfast", "paperfly"];
        }
        else if (codeUpper.startsWith("PF") || codeUpper.startsWith("PFLY")) {
            order = ["paperfly", "pathao", "steadfast", "redx"];
        }
        else if (codeUpper.startsWith("SF") || /^\d{6,}$/.test(codeUpper)) {
            order = ["steadfast", "pathao", "redx", "paperfly"];
        }
        const couriersChecked = [];
        for (const c of order) {
            const adapter = this.adapters.get(c);
            if (!adapter || !adapter.isConfigured())
                continue;
            couriersChecked.push(c);
            try {
                const res = await adapter.trackParcel(cleanCode);
                if (res && res.success) {
                    return res;
                }
            }
            catch (err) {
                // Continue checking remaining configured couriers
            }
        }
        // If no couriers were configured at all, still check the primary candidate so adapter error surfaces
        if (couriersChecked.length === 0) {
            couriersChecked.push(order[0]);
            try {
                const res = await this.getAdapter(order[0]).trackParcel(cleanCode);
                if (res && res.success)
                    return res;
            }
            catch (_) { }
        }
        throw new McpToolError({
            code: "CONSIGNMENT_NOT_FOUND",
            message: `Consignment '${cleanCode}' was not found across configured couriers (${couriersChecked.join(", ")}).`,
            retryable: false,
            extraFields: { couriers_checked: couriersChecked },
        });
    }
    async getBalance(courierName) {
        const target = String(courierName || "all").toLowerCase();
        if (target && target !== "all") {
            return await this.getAdapter(target).getBalance();
        }
        const names = ["steadfast", "pathao", "redx", "paperfly"];
        const results = {};
        let totalBalanceBdt = 0;
        await Promise.all(names.map(async (c) => {
            const adapter = this.adapters.get(c);
            if (!adapter || !adapter.isConfigured()) {
                if (c === "steadfast") {
                    results[c] = {
                        success: false,
                        courier: c,
                        amount_bdt: null,
                        pending_bdt: null,
                        current_balance: null,
                        currency: "BDT",
                        status: "AUTH_MISSING",
                        as_of: new Date().toISOString(),
                        hint: "Configure STEADFAST_API_KEY and STEADFAST_SECRET_KEY",
                    };
                }
                else {
                    results[c] = await adapter.getBalance();
                }
                return;
            }
            try {
                const bal = await adapter.getBalance();
                results[c] = bal;
                if (bal.status === "OK" && typeof bal.amount_bdt === "number") {
                    totalBalanceBdt += bal.amount_bdt;
                }
            }
            catch (err) {
                results[c] = {
                    success: false,
                    courier: c,
                    amount_bdt: null,
                    pending_bdt: null,
                    current_balance: null,
                    currency: "BDT",
                    status: "UPSTREAM_ERROR",
                    as_of: new Date().toISOString(),
                    hint: err?.message || String(err),
                };
            }
        }));
        const asOf = new Date().toISOString();
        return {
            success: true,
            courier: "all",
            amount_bdt: totalBalanceBdt,
            total_balance_bdt: totalBalanceBdt,
            currency: "BDT",
            status: "OK",
            as_of: asOf,
            carriers: results,
            timestamp: asOf,
        };
    }
    async checkFraudRisk(phone) {
        const steadfast = this.adapters.get("steadfast");
        const pathao = this.adapters.get("pathao");
        return await FraudRiskEngine.evaluateRisk(phone, steadfast, pathao);
    }
    async validateAddress(req) {
        return await this.googleMaps.validateAndGeocode(req);
    }
    async calculateZoneAndRate(req) {
        return await this.googleMaps.calculateDeliveryZoneAndFee(req);
    }
    async compareRates(req) {
        return await this.googleMaps.compareRates(req);
    }
    /**
     * Task T2 — Honest Draft-Only NDR Resolution
     * 1. Verifies consignment_id exists via trackParcel (throws CONSIGNMENT_NOT_FOUND if bogus).
     * 2. Generates Bengali WhatsApp copy + carrier ticket drafts with status: "DRAFT_GENERATED" and actions_executed: [].
     */
    async resolveNdr(req) {
        const cid = String(req.consignment_id || "").trim();
        const courier = req.courier;
        // Step 1: Verify the consignment exists on the specified courier (or throws CONSIGNMENT_NOT_FOUND)
        await this.trackParcel(cid, courier);
        const name = req.customer_name || "গ্রাহক";
        const phoneTag = req.customer_phone ? ` [Customer Phone: ${req.customer_phone}]` : "";
        let recommendedAction = "HOLD";
        let customerMsg = "";
        let ticketSubject = "";
        let carrierInstr = "";
        switch (req.issue_type) {
            case "fake_attempt":
                recommendedAction = "RESCHEDULE";
                customerMsg = `প্রস্তাবিত মেসেজ: প্রিয় ${name}, আপনার পার্সেলটির (${cid}) ডেলিভারিতে সাময়িক বিঘ্ন ঘটায় আমরা দুঃখিত। আমরা কুরিয়ার টিমের সাথে যোগাযোগ করার প্রস্তুতি নিচ্ছি যেন অগ্রাধিকার ভিত্তিতে আপনার পার্সেলটি পুনরায় ডেলিভারি করা হয়। আপনার সুবিধাজনক সময় জানালে আমরা দ্রুত ব্যবস্থা নিতে পারব।`;
                ticketSubject = `[NDR Dispute Draft] Consignment ${cid} — Suspected Fake Attempt`;
                carrierInstr = `DRAFT_DISPUTE_TICKET: Consignment ${cid} rider reported failed attempt without customer contact. Requesting supervisor verification and priority re-attempt within 24h.`;
                break;
            case "customer_phone_off":
                recommendedAction = "HOLD";
                customerMsg = `প্রস্তাবিত মেসেজ: প্রিয় ${name}, কুরিয়ার থেকে আপনার ঠিকানায় পার্সেল (${cid}) ডেলিভারির জন্য যোগাযোগের চেষ্টা করা হয়েছিল কিন্তু ফোনে পাওয়া যায়নি। অনুগ্রহ করে ডেলিভারি রিসিভ করার সুবিধাজনক সময় বা বিকল্প নাম্বার এই মেসেজে জানান।`;
                ticketSubject = `[Hold Request Draft] Consignment ${cid} — Awaiting Customer Contact`;
                carrierInstr = `DRAFT_HOLD_INSTRUCTION: Merchant will contact customer via WhatsApp. Please hold consignment ${cid} at local delivery hub and do not initiate RTO yet.`;
                break;
            case "reschedule_requested":
                recommendedAction = "RESCHEDULE";
                customerMsg = `প্রস্তাবিত মেসেজ: প্রিয় ${name}, আপনার পার্সেল (${cid}) ডেলিভারি ${req.reschedule_date || "পরবর্তী কর্মদিবসে"} পুনঃনির্ধারণ করার জন্য আমরা কুরিয়ারকে অনুরোধ পাঠাতে প্রস্তুত। অনুগ্রহ করে নিশ্চিত করুন ওই সময়ে আপনি ডেলিভারি রিসিভ করতে পারবেন কি না।`;
                ticketSubject = `[Reschedule Request Draft] Consignment ${cid} — Target Date: ${req.reschedule_date || "Next Business Day"}`;
                carrierInstr = `DRAFT_RESCHEDULE_INSTRUCTION: Customer requested delivery on ${req.reschedule_date || "next business day"}. Please retain consignment ${cid} at local hub for scheduled dispatch.`;
                break;
            case "wrong_address":
                recommendedAction = "CORRECT_ADDRESS";
                customerMsg = `প্রস্তাবিত মেসেজ: প্রিয় ${name}, আপনার পার্সেলের (${cid}) সংশোধিত ঠিকানা (${req.corrected_address || "নতুন ঠিকানা"}) কুরিয়ারকে জানানোর জন্য ড্রাফট তৈরি করা হয়েছে। ঠিকানাটি সঠিক থাকলে আমাদের কনফার্ম করুন।`;
                ticketSubject = `[Address Correction Draft] Consignment ${cid}`;
                carrierInstr = `DRAFT_ADDRESS_UPDATE: Please update delivery address for consignment ${cid} to: ${req.corrected_address || "Provided in merchant notes"}.`;
                break;
            case "customer_refused":
                recommendedAction = "HOLD";
                customerMsg = `প্রস্তাবিত মেসেজ: প্রিয় ${name}, আমরা লক্ষ্য করেছি পার্সেলটি (${cid}) ডেলিভারির সময় গ্রহণ করা সম্ভব হয়নি। পণ্য বা ডেলিভারি নিয়ে আপনার কোনো প্রশ্ন থাকলে অনুগ্রহ করে আমাদের জানান, আমরা সমাধানে সহায়তা করতে প্রস্তুত।`;
                ticketSubject = `[Retention Hold Draft] Consignment ${cid} — Pending Merchant Follow-up`;
                carrierInstr = `DRAFT_RETENTION_HOLD: Merchant is reaching out to customer regarding consignment ${cid}. Please hold at hub for 24 hours before processing return.`;
                break;
        }
        const nowIso = new Date().toISOString();
        return {
            success: true,
            consignment_id: cid,
            courier,
            status: "DRAFT_GENERATED",
            consignment_verified: true,
            actions_executed: [],
            whatsapp_draft: {
                language: "bn",
                text: customerMsg,
            },
            courier_ticket_draft: {
                subject: ticketSubject,
                body: carrierInstr + phoneTag,
            },
            recommended_carrier_action: recommendedAction,
            requires_manual_execution: true,
            resolution_status: "DRAFT_GENERATED",
            action_taken: "প্রস্তাবিত ড্রাফট তৈরি করা হয়েছে (কোনো অটোমেটিক মেসেজ বা কুরিয়ার টিকিট পাঠানো হয়নি)।",
            customer_whatsapp_message: customerMsg,
            carrier_instruction: carrierInstr + phoneTag,
            timestamp: nowIso,
        };
    }
    /**
     * Task T8 — cancel_parcel(courier, consignment_id)
     */
    async cancelParcel(courier, consignmentId) {
        const cid = String(consignmentId || "").trim();
        if (!cid) {
            throw new McpToolError({
                code: "INVALID_INPUT",
                message: "consignment_id is required to request cancellation.",
            });
        }
        this.getAdapter(courier); // Validates supported courier name
        throw new McpToolError({
            code: "UNSUPPORTED_BY_PROVIDER",
            message: `${courier} does not expose an automated parcel cancellation endpoint in its public merchant API; please cancel consignment '${cid}' in the ${courier} merchant portal.`,
            courier,
            retryable: false,
            extraFields: {
                consignment_id: cid,
                cancellable_via_api: false,
                hint: `Use ${courier} merchant portal`,
            },
        });
    }
    /**
     * Task T8 — bulk_create_parcels(items[], dry_run?)
     */
    async bulkCreateParcels(items, dryRun, tenantId) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new McpToolError({
                code: "INVALID_INPUT",
                message: "items must be a non-empty array of parcel creation objects.",
            });
        }
        if (items.length > 100) {
            throw new McpToolError({
                code: "INVALID_INPUT",
                message: "bulk_create_parcels supports at most 100 parcels per batch.",
            });
        }
        let succeeded = 0;
        let failed = 0;
        const results = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const invoice = String(item?.invoice || `BATCH-${i + 1}`);
            try {
                const res = await this.createParcel({
                    ...item,
                    invoice,
                    dry_run: dryRun !== undefined ? Boolean(dryRun) : Boolean(item?.dry_run),
                    tenant_id: tenantId || item?.tenant_id,
                });
                succeeded++;
                results.push({ index: i, invoice, ok: true, data: res });
            }
            catch (err) {
                failed++;
                results.push({
                    index: i,
                    invoice,
                    ok: false,
                    error: {
                        code: err?.code || "BOOKING_ERROR",
                        message: err?.message || String(err),
                    },
                });
            }
        }
        return {
            success: failed === 0,
            total: items.length,
            succeeded,
            failed,
            dry_run: Boolean(dryRun),
            results,
        };
    }
    /**
     * Task T8 — get_webhook_events(consignment_id?, since?)
     */
    getWebhookEvents(consignmentId, since) {
        let filtered = [...webhookEventsStore];
        if (consignmentId) {
            const target = String(consignmentId).trim().toLowerCase();
            filtered = filtered.filter((e) => String(e.consignment_id).toLowerCase() === target);
        }
        if (since) {
            const sinceMs = Date.parse(since);
            if (!Number.isNaN(sinceMs)) {
                filtered = filtered.filter((e) => Date.parse(e.received_at) >= sinceMs);
            }
        }
        return {
            success: true,
            count: filtered.length,
            events: filtered,
        };
    }
}
