export class FraudRiskEngine {
    /**
     * Real-Time Multi-Carrier Fraud & Delivery Risk Evaluation (T6)
     * Queries Pathao Nationwide Customer Delivery Database (/aladdin/api/v1/user/success),
     * Steadfast Nationwide Logistics Database (/fraud_check/{phone}), and BD Operator Prefix Validator.
     */
    static async evaluateRisk(phoneNumber, steadfastAdapter, pathaoAdapter) {
        const rawDigits = String(phoneNumber || "").replace(/[^0-9]/g, "");
        const cleanPhone = rawDigits.startsWith("880") && rawDigits.length === 13 ? rawDigits.slice(2) : rawDigits;
        // Valid BD Mobile format check (11 digits starting with 013, 014, 015, 016, 017, 018, 019)
        const isValidBDOperator = /^01[3-9]\d{8}$/.test(cleanPhone);
        if (!isValidBDOperator) {
            return {
                phone: phoneNumber,
                risk_level: "INVALID_NUMBER",
                delivery_success_rate: null,
                total_parcels: 0,
                total_delivered: 0,
                total_cancelled: 0,
                cancellation_rate: null,
                is_verified_buyer: false,
                recommendation: "🇧🇩 ভুল বা অকার্যকর বাংলাদেশি মোবাইল নম্বর। ম্যানুয়াল ভেরিফিকেশন ছাড়া পার্সেল বুক করবেন না। | 🇬🇧 Invalid Bangladesh mobile number (11 digits starting with 013–019 required). Do not dispatch without manual verification.",
                carrier_source: "prefix_validator",
                carrier_verified: false,
                data_sources: ["prefix_validator"],
                sample_size: 0,
                coverage_note: "Validated against BTRC 11-digit mobile operator prefix rules (013–019).",
            };
        }
        let total = 0;
        let delivered = 0;
        let cancelled = 0;
        let verifiedByCarrier = false;
        const dataSources = [];
        let customerRating;
        // 1. Query Steadfast Nationwide Fraud Database (GET /fraud_check/{phone})
        if (steadfastAdapter && steadfastAdapter.isConfigured()) {
            try {
                const sfData = await steadfastAdapter.fraudCheck(cleanPhone);
                const sfTotal = Number(sfData?.total_parcels ?? sfData?.data?.total_parcels ?? 0);
                const sfDelivered = Number(sfData?.total_delivered ?? sfData?.data?.total_delivered ?? 0);
                const sfCancelled = Number(sfData?.total_cancelled ?? sfData?.data?.total_cancelled ?? 0);
                total += sfTotal;
                delivered += sfDelivered;
                cancelled += sfCancelled;
                verifiedByCarrier = true;
                dataSources.push("steadfast_nationwide");
            }
            catch (_) {
                // Continue to Pathao check
            }
        }
        // 2. Query Pathao Nationwide Customer Delivery Database (POST /aladdin/api/v1/user/success)
        if (pathaoAdapter && pathaoAdapter.isConfigured()) {
            try {
                const ptRes = await pathaoAdapter.fraudCheck(cleanPhone);
                const ptData = ptRes?.data || ptRes || {};
                const cust = ptData.customer || {};
                const ptTotal = Number(cust.total_delivery ?? 0);
                const ptDelivered = Number(cust.successful_delivery ?? 0);
                const ptCancelled = Math.max(0, ptTotal - ptDelivered);
                total += ptTotal;
                delivered += ptDelivered;
                cancelled += ptCancelled;
                verifiedByCarrier = true;
                dataSources.push("pathao_nationwide");
                if (ptData.customer_rating) {
                    customerRating = String(ptData.customer_rating);
                }
            }
            catch (_) {
                // Carrier lookup error handled gracefully
            }
        }
        dataSources.push("prefix_validator");
        const sourceLabel = dataSources.join("+");
        if (verifiedByCarrier) {
            if (total === 0) {
                return {
                    phone: cleanPhone,
                    risk_level: "NO_HISTORY",
                    delivery_success_rate: null,
                    total_parcels: 0,
                    total_delivered: 0,
                    total_cancelled: 0,
                    cancellation_rate: null,
                    is_verified_buyer: true,
                    recommendation: "🇧🇩 কুরিয়ার ডেটাবেজে পূর্বে কোনো অর্ডার বা রিটার্ন রেকর্ড নেই (নতুন ক্রেতা)। ফোনে ঠিকানা কনফার্ম করে পাঠানো যেতে পারে। | 🇬🇧 No prior delivery or return history found in queried courier databases. Confirm via phone call before COD dispatch.",
                    carrier_source: sourceLabel,
                    carrier_verified: true,
                    data_sources: dataSources,
                    sample_size: 0,
                    coverage_note: `Queried ${dataSources.filter((s) => s !== "prefix_validator").join(" and ")} live databases; 0 prior consignments recorded.`,
                };
            }
            const successRatio = (delivered / total) * 100;
            const cancelRatio = (cancelled / total) * 100;
            const successRateStr = `${successRatio.toFixed(1)}%`;
            const cancelRateStr = `${cancelRatio.toFixed(1)}%`;
            const ratingNote = customerRating ? ` [Carrier Rating: ${customerRating}]` : "";
            let riskLevel = "LOW";
            let rec = "";
            if (successRatio >= 80) {
                riskLevel = "LOW";
                rec = `🇧🇩 কাস্টমার অত্যন্ত নির্ভরযোগ্য (সফল ডেলিভারি: ${delivered}/${total}টি, সাকসেস রেট: ${successRateStr})। নির্দ্বিধায় ক্যাশ অন ডেলিভারি (COD) পাঠান। | 🇬🇧 Highly reliable buyer (${delivered}/${total} delivered, ${successRateStr} success rate)${ratingNote}. Safe for immediate COD dispatch.`;
            }
            else if (successRatio >= 55) {
                riskLevel = "MEDIUM";
                rec = `🇧🇩 মাঝারি ঝুঁকি (সফল: ${delivered}টি, ক্যানসেল/রিটার্ন: ${cancelled}টি, ক্যানসেলেশন রেট: ${cancelRateStr})। পার্সেল পাঠানোর আগে কাস্টমারকে ফোন দিয়ে অর্ডার কনফার্ম করুন। | 🇬🇧 Medium risk (${delivered} delivered, ${cancelled} returned, ${cancelRateStr} return rate)${ratingNote}. Confirm order via phone call before dispatch.`;
            }
            else if (successRatio >= 25) {
                riskLevel = "HIGH";
                rec = `🇧🇩 উচ্চ ঝুঁকির ক্রেতা! পূর্ববর্তী অর্ডারের ${cancelRateStr} ক্যানসেল/রিটার্ন করেছেন (${cancelled}/${total}টি রিটার্ন)। ডেলিভারি চার্জ অগ্রিম নেওয়ার সুপারিশ করা হচ্ছে। | 🇬🇧 High fraud risk! Buyer cancelled/returned ${cancelRateStr} of past orders (${cancelled}/${total} returned)${ratingNote}. Collect advance delivery charge before shipping.`;
            }
            else {
                riskLevel = "CRITICAL";
                rec = `🇧🇩 মারাত্মক ঝুঁকির ক্রেতা! পূর্ববর্তী অর্ডারের ${cancelRateStr} রিটার্ন করেছেন (${cancelled}/${total}টি রিটার্ন)। অগ্রিম পেমেন্ট ছাড়া পার্সেল পাঠাবেন না। | 🇬🇧 Critical return risk! Buyer returned ${cancelRateStr} of past orders (${cancelled}/${total} returned)${ratingNote}. Require advance payment before dispatch.`;
            }
            return {
                phone: cleanPhone,
                risk_level: riskLevel,
                delivery_success_rate: successRateStr,
                total_parcels: total,
                total_delivered: delivered,
                total_cancelled: cancelled,
                cancellation_rate: cancelRateStr,
                is_verified_buyer: riskLevel === "LOW" || riskLevel === "MEDIUM",
                recommendation: rec,
                carrier_source: sourceLabel,
                carrier_verified: true,
                data_sources: dataSources,
                sample_size: total,
                coverage_note: `Aggregated ${total} historical consignments from ${dataSources.filter((s) => s !== "prefix_validator").join(" and ")}.`,
            };
        }
        // Honest fallback when no carrier database returned history
        return {
            phone: cleanPhone,
            risk_level: "NO_HISTORY",
            delivery_success_rate: null,
            total_parcels: 0,
            total_delivered: 0,
            total_cancelled: 0,
            cancellation_rate: null,
            is_verified_buyer: false,
            recommendation: "🇧🇩 সঠিক বাংলাদেশি মোবাইল নম্বর, তবে কুরিয়ার হিস্ট্রি পাওয়া যায়নি। ফোনে নিশ্চিত হয়ে ডিসপ্যাচ করুন। | 🇬🇧 Valid BD mobile number, but no live carrier history was returned. Verify via phone call before dispatch.",
            carrier_source: "prefix_validator",
            carrier_verified: false,
            data_sources: ["prefix_validator"],
            sample_size: 0,
            coverage_note: "Validated format via BTRC prefix rules only; no upstream carrier history available.",
        };
    }
}
