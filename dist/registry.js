import { SteadfastAdapter } from "./adapters/steadfast.js";
import { PathaoAdapter } from "./adapters/pathao.js";
import { FraudRiskEngine } from "./adapters/fraud_engine.js";
import { RedxAdapter } from "./adapters/redx.js";
import { PaperflyAdapter } from "./adapters/paperfly.js";
import { GoogleMapsAdapter } from "./adapters/google_maps.js";
import { loadConfig } from "./config.js";
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
        return list;
    }
    getAdapter(name) {
        const adapter = this.adapters.get(name);
        if (!adapter) {
            throw new Error(`Courier '${name}' is not supported yet.`);
        }
        return adapter;
    }
    getGoogleMaps() {
        return this.googleMaps;
    }
    resolveSmartAutoCourierOrder(address, priority = "balanced") {
        const addr = String(address || "").toLowerCase();
        const isSubDhaka = /savar|ashulia|keraniganj|gajipur|gazipur|tongi|narayanganj|siddhirganj|fatullah|dohar|nawabganj|সাভার|আশুলিয়া|কেরানীগঞ্জ|গাজীপুর|টঙ্গী|নারায়ণগঞ্জ/.test(addr);
        const isDhakaMetro = !isSubDhaka && (/dhaka|ঢাকা|gulshan|banani|dhanmondi|uttara|mirpur|mohammadpur|motijheel|badda|rampura|bashundhara|tejgaon|khilgaon|malibagh|mogbazar|farmgate|shahbag|hatirpool|lalmatia|wari|jatrabari|গুলশান|বনানী|ধানমন্ডি|উত্তরা|মিরপুর|মোহাম্মদপুর|মতিঝিল|বাড্ডা|রামপুরা|বসুন্ধরা|তেজগাঁও|খিলগাঁও|মালিবাগ|মগবাজার|ফার্মগেট|শাহবাগ|হাতিরপুল|ওয়ারী|যাত্রাবাড়ী/.test(addr));
        let idealOrder;
        if (isDhakaMetro) {
            idealOrder = priority === "cheapest"
                ? ["pathao", "redx", "paperfly", "steadfast"]
                : ["pathao", "redx", "steadfast", "paperfly"];
        }
        else if (isSubDhaka) {
            idealOrder = priority === "fastest"
                ? ["pathao", "steadfast", "redx", "paperfly"]
                : ["paperfly", "steadfast", "pathao", "redx"];
        }
        else {
            idealOrder = priority === "cheapest"
                ? ["paperfly", "pathao", "steadfast", "redx"]
                : ["steadfast", "paperfly", "pathao", "redx"];
        }
        const configured = idealOrder.filter((c) => this.adapters.get(c)?.isConfigured());
        return configured.length > 0 ? configured : idealOrder;
    }
    async createParcel(req) {
        const rawChoice = String(req.courier || "auto").toLowerCase();
        const isAuto = rawChoice === "auto" || rawChoice.startsWith("auto_");
        const priority = rawChoice === "auto_fastest" ? "fastest" : rawChoice === "auto_cheapest" ? "cheapest" : "balanced";
        const candidates = isAuto
            ? this.resolveSmartAutoCourierOrder(req.recipient_address, priority)
            : [rawChoice];
        let lastErr = null;
        for (const courierName of candidates) {
            try {
                const adapter = this.getAdapter(courierName);
                const res = await adapter.createParcel({ ...req, courier: courierName });
                if (res && res.success !== false && (res.tracking_code || res.consignment_id)) {
                    return res;
                }
                lastErr = new Error(res?.message || res?.error || `${courierName} rejected parcel`);
            }
            catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || new Error("All configured courier gateways failed to book parcel.");
    }
    async trackParcel(trackingCode, courierName) {
        if (courierName) {
            return await this.getAdapter(courierName).trackParcel(trackingCode);
        }
        // Default try Steadfast first, fallback to Pathao
        try {
            return await this.getAdapter("steadfast").trackParcel(trackingCode);
        }
        catch {
            return await this.getAdapter("pathao").trackParcel(trackingCode);
        }
    }
    async getBalance(courierName) {
        return await this.getAdapter(courierName).getBalance();
    }
    async checkFraudRisk(phone) {
        const steadfast = this.adapters.get("steadfast");
        return await FraudRiskEngine.evaluateRisk(phone, steadfast);
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
    async resolveNdr(req) {
        const cid = req.consignment_id;
        const name = req.customer_name || "গ্রাহক";
        const courier = req.courier;
        const phoneTag = req.customer_phone ? ` [Customer Phone: ${req.customer_phone}]` : "";
        let status = "CUSTOMER_REENGAGED";
        let actionTaken = "";
        let customerMsg = "";
        let carrierInstr = "";
        switch (req.issue_type) {
            case "fake_attempt":
                status = "DISPUTE_FILED";
                actionTaken = "কুরিয়ার রাইডারের ফেক ডেলিভারি অ্যাটেম্পট সনাক্ত হয়েছে। কুরিয়ার অথরিটির কাছে জরুরি ইনভেস্টিগেশন ও রি-অ্যাটেম্পট রিকোয়েস্ট পাঠানো হয়েছে।";
                customerMsg = `প্রিয় ${name}, আপনার পার্সেলটির ডেলিভারিতে সমস্যা হওয়ায় আমরা অত্যন্ত দুঃখিত। কুরিয়ার ম্যানেজমেন্টকে আমরা বিষয়টি জানিয়েছি এবং অগ্রাধিকার ভিত্তিতে পার্সেলটি পুনরায় পৌঁছে দেওয়ার ব্যবস্থা নেওয়া হচ্ছে।`;
                carrierInstr = `CRITICAL_DISPUTE: Consignment ${cid} rider reported fake attempt. Supervisor intervention required for priority re-attempt within 24h.`;
                break;
            case "customer_phone_off":
                status = "CUSTOMER_REENGAGED";
                actionTaken = "গ্রাহকের ফোন বন্ধ বা রিসিভ না করায় হোয়াটসঅ্যাপে ফলোআপ ও সুবিধাজনক সময় জানানোর অনুরোধ পাঠানো হয়েছে।";
                customerMsg = `প্রিয় ${name}, কুরিয়ার থেকে আপনার ঠিকানায় পার্সেল নিয়ে যাওয়া হয়েছিল কিন্তু আপনাকে ফোনে পাওয়া যায়নি। অনুগ্রহ করে ডেলিভারি রিসিভ করার সুবিধাজনক সময় বা বিকল্প নাম্বার আমাদের মেসেজে জানান।`;
                carrierInstr = `HOLD_FOR_CONTACT: Reached customer via messaging. Consignment ${cid} on hold at local hub. Do not RTO.`;
                break;
            case "reschedule_requested":
                status = "RESCHEDULE_QUEUED";
                actionTaken = `গ্রাহকের অনুরোধে ডেলিভারি ${req.reschedule_date || "পরবর্তী কর্মদিবসে"} পুনঃনির্ধারণ করা হয়েছে।`;
                customerMsg = `প্রিয় ${name}, আপনার অনুরোধ অনুযায়ী পার্সেল ডেলিভারি ${req.reschedule_date || "পরবর্তী কর্মদিবসে"} পুনঃনির্ধারণ করা হয়েছে।`;
                carrierInstr = `RESCHEDULE_DELIVERY: Customer requested delivery on ${req.reschedule_date || "next business day"}. Retain at local hub.`;
                break;
            case "wrong_address":
                status = "ADDRESS_UPDATED";
                actionTaken = `গ্রাহকের সংশোধিত ঠিকানা (${req.corrected_address || "আপডেটেড ঠিকানা"}) সিস্টেমে নথিভুক্ত করা হয়েছে এবং রাইডারকে রি-রুট করা হচ্ছে।`;
                customerMsg = `প্রিয় ${name}, আপনার পার্সেলের ঠিকানা সংশোধন করা হয়েছে। রাইডার আপনার নতুন ঠিকানায় ডেলিভারির জন্য যোগাযোগ করবে।`;
                carrierInstr = `ADDRESS_UPDATE: Route parcel ${cid} to updated address: ${req.corrected_address || "Provided in notes"}.`;
                break;
            case "customer_refused":
                status = "CUSTOMER_REENGAGED";
                actionTaken = "গ্রাহক পার্সেল গ্রহণে অস্বীকৃতি জানানোয় কারণ অনুসন্ধান ও সমস্যা সমাধানে রিটেনশন মেসেজ পাঠানো হয়েছে।";
                customerMsg = `প্রিয় ${name}, আমরা জানতে পেরেছি আপনি পার্সেলটি গ্রহণ করতে পারেননি। পণ্য নিয়ে আপনার কোনো প্রশ্ন বা অসন্তোষ থাকলে দয়া করে আমাদের জানান, আমরা সরাসরি সমাধান করে দিচ্ছি।`;
                carrierInstr = `HOLD_PENDING_MERCHANT_ACTION: Merchant in retention contact with customer. Hold consignment ${cid} 24 hours before RTO.`;
                break;
        }
        return {
            success: true,
            consignment_id: cid,
            courier,
            resolution_status: status,
            action_taken: actionTaken,
            customer_whatsapp_message: customerMsg,
            carrier_instruction: carrierInstr + phoneTag,
            timestamp: new Date().toISOString(),
        };
    }
}
