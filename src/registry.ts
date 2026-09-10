import { CourierAdapter } from "./adapters/base.js";
import { SteadfastAdapter } from "./adapters/steadfast.js";
import { PathaoAdapter } from "./adapters/pathao.js";
import { FraudRiskEngine } from "./adapters/fraud_engine.js";
import { RedxAdapter } from "./adapters/redx.js";
import { PaperflyAdapter } from "./adapters/paperfly.js";
import { GoogleMapsAdapter } from "./adapters/google_maps.js";
import { loadConfig, CourierConfig } from "./config.js";
import {
  AddressValidationRequest,
  AddressValidationResponse,
  BalanceResponse,
  CourierRateComparisonRequest,
  CourierRateComparisonResponse,
  FraudRiskScoreResponse,
  NdrResolutionRequest,
  NdrResolutionResponse,
  ParcelCreateRequest,
  ParcelResponse,
  SupportedCourier,
  TrackingResponse,
  ZoneRateRequest,
  ZoneRateResponse,
} from "./types.js";

export class CourierRegistry {
  private adapters: Map<SupportedCourier, CourierAdapter> = new Map();
  private googleMaps: GoogleMapsAdapter;

  constructor(config: CourierConfig = loadConfig()) {
    const steadfast = new SteadfastAdapter(
      config.steadfast.apiKey,
      config.steadfast.secretKey,
      config.steadfast.baseUrl
    );
    this.adapters.set("steadfast", steadfast);

    const pathao = new PathaoAdapter(
      config.pathao.clientId,
      config.pathao.clientSecret,
      config.pathao.username,
      config.pathao.password,
      config.pathao.storeId,
      config.pathao.baseUrl
    );
    this.adapters.set("pathao", pathao);

    const redx = new RedxAdapter(config.redx.apiToken, config.redx.baseUrl, config.redx.pickupStoreId);
    this.adapters.set("redx", redx);

    const paperfly = new PaperflyAdapter(
      config.paperfly.apiKey,
      config.paperfly.username,
      config.paperfly.password,
      config.paperfly.storeName,
      config.paperfly.baseUrl
    );
    this.adapters.set("paperfly", paperfly);

    this.googleMaps = new GoogleMapsAdapter(config.googleMaps?.apiKey || process.env.GOOGLE_MAPS_API_KEY);
  }

  listCouriers() {
    const list = Array.from(this.adapters.entries()).map(([name, adapter]) => ({
      courier: name,
      is_configured: adapter.isConfigured(),
    }));

    list.push({
      courier: "google_maps" as any,
      is_configured: this.googleMaps.isConfigured(),
    });

    return list;
  }

  getAdapter(name: SupportedCourier): CourierAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`Courier '${name}' is not supported yet.`);
    }
    return adapter;
  }

  getGoogleMaps(): GoogleMapsAdapter {
    return this.googleMaps;
  }

  async createParcel(req: ParcelCreateRequest): Promise<ParcelResponse> {
    let courierName: SupportedCourier = "steadfast";

    if (req.courier && req.courier !== "auto") {
      courierName = req.courier;
    } else {
      // Smart routing: inside Dhaka metro with Pathao configured prefers Pathao, else Steadfast
      const addr = req.recipient_address.toLowerCase();
      if (
        addr.includes("dhaka") &&
        (addr.includes("gulshan") ||
          addr.includes("banani") ||
          addr.includes("dhanmondi") ||
          addr.includes("uttara") ||
          addr.includes("mirpur"))
      ) {
        courierName = this.adapters.get("pathao")?.isConfigured() ? "pathao" : "steadfast";
      } else {
        courierName = "steadfast";
      }
    }

    const adapter = this.getAdapter(courierName);
    return await adapter.createParcel(req);
  }

  async trackParcel(trackingCode: string, courierName?: SupportedCourier): Promise<TrackingResponse> {
    if (courierName) {
      return await this.getAdapter(courierName).trackParcel(trackingCode);
    }

    // Default try Steadfast first, fallback to Pathao
    try {
      return await this.getAdapter("steadfast").trackParcel(trackingCode);
    } catch {
      return await this.getAdapter("pathao").trackParcel(trackingCode);
    }
  }

  async getBalance(courierName: SupportedCourier): Promise<BalanceResponse> {
    return await this.getAdapter(courierName).getBalance();
  }

  async checkFraudRisk(phone: string): Promise<FraudRiskScoreResponse> {
    const steadfast = this.adapters.get("steadfast") as SteadfastAdapter | undefined;
    return await FraudRiskEngine.evaluateRisk(phone, steadfast);
  }

  async validateAddress(req: AddressValidationRequest): Promise<AddressValidationResponse> {
    return await this.googleMaps.validateAndGeocode(req);
  }

  async calculateZoneAndRate(req: ZoneRateRequest): Promise<ZoneRateResponse> {
    return await this.googleMaps.calculateDeliveryZoneAndFee(req);
  }

  async compareRates(req: CourierRateComparisonRequest): Promise<CourierRateComparisonResponse> {
    return await this.googleMaps.compareRates(req);
  }

  async resolveNdr(req: NdrResolutionRequest): Promise<NdrResolutionResponse> {
    const cid = req.consignment_id;
    const name = req.customer_name || "গ্রাহক";
    const courier = req.courier;

    let status: "DISPUTE_FILED" | "RESCHEDULE_QUEUED" | "ADDRESS_UPDATED" | "CUSTOMER_REENGAGED" = "CUSTOMER_REENGAGED";
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
      carrier_instruction: carrierInstr,
      timestamp: new Date().toISOString(),
    };
  }
}
