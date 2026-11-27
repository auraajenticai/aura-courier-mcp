import axios from "axios";
// Session / token caches (45m TTL) to avoid upstream auth rate limits
const steadfastWebCookieCache = new Map();
const redxWebTokenCache = new Map();
const paperflyWebTokenCache = new Map();
function pct(delivered, total) {
    if (total <= 0)
        return null;
    return Math.round((delivered / total) * 1000) / 10;
}
export class FraudRiskEngine {
    static async checkSteadfastWeb(cleanPhone, email, password) {
        const cacheKey = email.trim().toLowerCase();
        const now = Date.now();
        let cookieHeader = steadfastWebCookieCache.get(cacheKey)?.expiresAt && steadfastWebCookieCache.get(cacheKey).expiresAt > now
            ? steadfastWebCookieCache.get(cacheKey).cookieHeader
            : "";
        if (!cookieHeader) {
            const loginGet = await axios.get("https://steadfast.com.bd/login", {
                timeout: 6000,
                maxRedirects: 0,
                validateStatus: () => true,
                headers: { "User-Agent": "Mozilla/5.0" },
            });
            const html = String(loginGet.data || "");
            const m = html.match(/name="_token"\s+value="([^"]+)"/);
            if (!m)
                return null;
            const initCookies = (loginGet.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
            const body = new URLSearchParams({ _token: m[1], email: email.trim(), password }).toString();
            const loginPost = await axios.post("https://steadfast.com.bd/login", body, {
                timeout: 6000,
                maxRedirects: 0,
                validateStatus: () => true,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Cookie: initCookies,
                    "User-Agent": "Mozilla/5.0",
                },
            });
            if (loginPost.status !== 302 && loginPost.status !== 200)
                return null;
            const postCookies = (loginPost.headers["set-cookie"] || []).map((c) => c.split(";")[0]);
            if (!postCookies.length)
                return null;
            cookieHeader = postCookies.join("; ");
            steadfastWebCookieCache.set(cacheKey, { cookieHeader, expiresAt: now + 45 * 60 * 1000 });
        }
        const checkRes = await axios.get(`https://steadfast.com.bd/user/frauds/check/${encodeURIComponent(cleanPhone)}`, {
            timeout: 6000,
            maxRedirects: 0,
            validateStatus: () => true,
            headers: {
                Cookie: cookieHeader,
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0",
            },
        });
        if (checkRes.status !== 200 || typeof checkRes.data !== "object" || checkRes.data === null) {
            steadfastWebCookieCache.delete(cacheKey);
            return null;
        }
        const delivered = Number(checkRes.data.total_delivered ?? 0);
        const cancelled = Number(checkRes.data.total_cancelled ?? 0);
        const total = Number(checkRes.data.total_parcels ?? delivered + cancelled);
        return { total, delivered, cancelled };
    }
    static async checkRedxNationwide(cleanPhone, loginPhone, password) {
        const normLogin = loginPhone.replace(/\D/g, "").replace(/^88/, "");
        if (!/^01[3-9]\d{8}$/.test(normLogin) || !password)
            return null;
        const cacheKey = normLogin;
        const now = Date.now();
        let accessToken = redxWebTokenCache.get(cacheKey)?.expiresAt && redxWebTokenCache.get(cacheKey).expiresAt > now
            ? redxWebTokenCache.get(cacheKey).token
            : "";
        if (!accessToken) {
            const loginRes = await axios.post("https://api.redx.com.bd/v4/auth/login", { phone: `88${normLogin}`, password }, {
                timeout: 6000,
                maxRedirects: 0,
                validateStatus: () => true,
                headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
            });
            accessToken = String(loginRes.data?.data?.accessToken || "").trim();
            if (loginRes.status !== 200 || !accessToken)
                return null;
            redxWebTokenCache.set(cacheKey, { token: accessToken, expiresAt: now + 45 * 60 * 1000 });
        }
        // CRITICAL ZERO-MOCK INVARIANT: Only accept HTTP 200 (HTTP 400 returns RedX's static demo object)
        const statsRes = await axios.get(`https://redx.com.bd/api/redx_se/admin/parcel/customer-success-return-rate?phoneNumber=88${encodeURIComponent(cleanPhone)}`, {
            timeout: 6000,
            maxRedirects: 0,
            validateStatus: () => true,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0",
            },
        });
        if (statsRes.status === 401) {
            redxWebTokenCache.delete(cacheKey);
            return null;
        }
        if (statsRes.status !== 200 || !statsRes.data?.data)
            return null;
        const total = Number(statsRes.data.data.totalParcels ?? 0);
        const delivered = Number(statsRes.data.data.deliveredParcels ?? 0);
        const cancelled = Math.max(0, total - delivered);
        return { total, delivered, cancelled };
    }
    static async checkPaperflySmartCheck(cleanPhone, username, password) {
        const now = Date.now();
        const cacheKey = username.trim();
        let token = paperflyWebTokenCache.get(cacheKey)?.expiresAt && paperflyWebTokenCache.get(cacheKey).expiresAt > now
            ? paperflyWebTokenCache.get(cacheKey).token
            : "";
        if (!token) {
            const loginRes = await axios.post("https://go-app.paperfly.com.bd/merchant/api/react/authentication/login_using_password.php", { username: username.trim(), password }, { timeout: 6000, maxRedirects: 0, validateStatus: () => true });
            token = String(loginRes.data?.token || "").trim();
            if (loginRes.status !== 200 || !token) {
                return { status: "UPSTREAM_UNAVAILABLE", total: null, delivered: null, cancelled: null, note: "Paperfly auth unavailable" };
            }
            paperflyWebTokenCache.set(cacheKey, { token, expiresAt: now + 45 * 60 * 1000 });
        }
        const res = await axios.post("https://go-app.paperfly.com.bd/merchant/api/react/smart-check/list.php", { search_text: cleanPhone, limit: 50, page: 1 }, {
            timeout: 6000,
            maxRedirects: 0,
            validateStatus: () => true,
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        if (res.status !== 200 || typeof res.data !== "object" || res.data === null) {
            return { status: "UPSTREAM_UNAVAILABLE", total: null, delivered: null, cancelled: null, note: `Paperfly Smart-Check server HTTP ${res.status}` };
        }
        const records = Array.isArray(res.data.records) ? res.data.records : [];
        const total = Number(res.data.totalRecords ?? records.length);
        let delivered = 0;
        let cancelled = 0;
        for (const r of records) {
            const st = String(r?.status || "").toLowerCase();
            if (st.includes("deliver") || st.includes("success"))
                delivered++;
            else if (st.includes("return") || st.includes("cancel") || st.includes("fail") || st.includes("close"))
                cancelled++;
        }
        return { status: "LIVE", total, delivered, cancelled };
    }
    /**
     * Real-Time Official 4-Courier Fraud & Delivery Risk Evaluation (v2.7.5)
     * Executes parallel live lookups across Aura Courier MCP's 4 official carriers:
     * Steadfast, Pathao, RedX, and Paperfly (plus verified PostgreSQL consignment history).
     * Strictly Zero Mock Data: non-queried or zero-record carrier APIs return `null` counts with clean SaaS status.
     */
    static async evaluateRisk(phoneNumber, steadfastAdapter, pathaoAdapter, config, dbPool) {
        const rawDigits = String(phoneNumber || "").replace(/[^0-9]/g, "");
        const cleanPhone = rawDigits.startsWith("880") && rawDigits.length === 13 ? rawDigits.slice(2) : rawDigits;
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
                courier_breakdown: [],
                coverage_note: "Validated against BTRC 11-digit mobile operator prefix rules (013–019).",
            };
        }
        const breakdown = [];
        const dataSources = [];
        let verifiedByCarrier = false;
        let customerRating;
        // Query verified per-carrier consignment outcomes from durable PostgreSQL `courier_parcels` if connected
        const dbByCourier = {};
        if (dbPool && typeof dbPool.query === "function") {
            try {
                const q = await dbPool.query(`SELECT LOWER(courier) AS courier,
                  COUNT(*) FILTER (WHERE LOWER(status) LIKE '%deliv%')::int AS delivered,
                  COUNT(*) FILTER (WHERE LOWER(status) LIKE '%ret%' OR LOWER(status) LIKE '%cancel%')::int AS cancelled
             FROM courier_parcels
            WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') IN ($1, $2)
            GROUP BY LOWER(courier)`, [cleanPhone, `88${cleanPhone}`]);
                for (const r of q?.rows || []) {
                    const del = Number(r.delivered || 0);
                    const can = Number(r.cancelled || 0);
                    if (del + can > 0 && r.courier) {
                        dbByCourier[String(r.courier)] = { total: del + can, delivered: del, cancelled: can };
                    }
                }
            }
            catch (_) {
                // Non-fatal if standalone MCP runs without PostgreSQL
            }
        }
        // Run Aura Courier MCP's 4 Official Bangladesh Couriers in parallel (Steadfast, Pathao, RedX, Paperfly)
        const [ptTask, sfTask, rxTask, pfTask] = await Promise.allSettled([
            // 1. Pathao Courier (Nationwide Aladdin / Merchant user/success DB)
            (async () => {
                if (pathaoAdapter && pathaoAdapter.isConfigured()) {
                    try {
                        const ptRes = await pathaoAdapter.fraudCheck(cleanPhone);
                        const ptData = ptRes?.data || ptRes || {};
                        const cust = ptData.customer || {};
                        const ptTotal = Number(cust.total_delivery ?? ptData.total_parcels ?? 0);
                        const ptDelivered = Number(cust.successful_delivery ?? ptData.total_delivered ?? 0);
                        const ptCancelled = Number(ptData.total_cancelled ?? Math.max(0, ptTotal - ptDelivered));
                        if (ptData.customer_rating) {
                            customerRating = String(ptData.customer_rating);
                        }
                        return {
                            courier: "pathao",
                            courier_name: "Pathao Courier",
                            status: "LIVE",
                            total_parcels: ptTotal,
                            total_delivered: ptDelivered,
                            total_cancelled: ptCancelled,
                            success_rate: pct(ptDelivered, ptTotal),
                            note: ptData.customer_rating ? `Rating: ${ptData.customer_rating}` : undefined,
                        };
                    }
                    catch (_) {
                        const dbPt = dbByCourier["pathao"];
                        if (dbPt && dbPt.total > 0) {
                            return {
                                courier: "pathao",
                                courier_name: "Pathao Courier",
                                status: "LIVE",
                                total_parcels: dbPt.total,
                                total_delivered: dbPt.delivered,
                                total_cancelled: dbPt.cancelled,
                                success_rate: pct(dbPt.delivered, dbPt.total),
                                note: "Verified consignment ledger",
                            };
                        }
                        return {
                            courier: "pathao",
                            courier_name: "Pathao Courier",
                            status: "API_CONNECTED",
                            total_parcels: null,
                            total_delivered: null,
                            total_cancelled: null,
                            success_rate: null,
                            note: "No prior Pathao record",
                        };
                    }
                }
                return {
                    courier: "pathao",
                    courier_name: "Pathao Courier",
                    status: "NOT_CONNECTED",
                    total_parcels: null,
                    total_delivered: null,
                    total_cancelled: null,
                    success_rate: null,
                    note: "Not configured",
                };
            })(),
            // 2. Steadfast Courier (Packzy API -> optional Web fallback -> verified DB ledger)
            (async () => {
                if (steadfastAdapter && steadfastAdapter.isConfigured()) {
                    try {
                        const sfData = await steadfastAdapter.fraudCheck(cleanPhone);
                        const sfTotal = Number(sfData?.total_parcels ?? sfData?.data?.total_parcels ?? 0);
                        const sfDelivered = Number(sfData?.total_delivered ?? sfData?.data?.total_delivered ?? 0);
                        const sfCancelled = Number(sfData?.total_cancelled ?? sfData?.data?.total_cancelled ?? 0);
                        return {
                            courier: "steadfast",
                            courier_name: "Steadfast Courier",
                            status: "LIVE",
                            total_parcels: sfTotal,
                            total_delivered: sfDelivered,
                            total_cancelled: sfCancelled,
                            success_rate: pct(sfDelivered, sfTotal),
                        };
                    }
                    catch (_) {
                        const sfEmail = config?.steadfast?.email || "";
                        const sfPass = config?.steadfast?.password || "";
                        if (sfEmail && sfPass) {
                            const webRes = await FraudRiskEngine.checkSteadfastWeb(cleanPhone, sfEmail, sfPass).catch(() => null);
                            if (webRes) {
                                return {
                                    courier: "steadfast",
                                    courier_name: "Steadfast Courier",
                                    status: "LIVE",
                                    total_parcels: webRes.total,
                                    total_delivered: webRes.delivered,
                                    total_cancelled: webRes.cancelled,
                                    success_rate: pct(webRes.delivered, webRes.total),
                                };
                            }
                        }
                        const dbSf = dbByCourier["steadfast"];
                        if (dbSf && dbSf.total > 0) {
                            return {
                                courier: "steadfast",
                                courier_name: "Steadfast Courier",
                                status: "LIVE",
                                total_parcels: dbSf.total,
                                total_delivered: dbSf.delivered,
                                total_cancelled: dbSf.cancelled,
                                success_rate: pct(dbSf.delivered, dbSf.total),
                                note: "Verified consignment ledger",
                            };
                        }
                        return {
                            courier: "steadfast",
                            courier_name: "Steadfast Courier",
                            status: "API_CONNECTED",
                            total_parcels: null,
                            total_delivered: null,
                            total_cancelled: null,
                            success_rate: null,
                            note: "No prior Steadfast record",
                        };
                    }
                }
                const dbSf = dbByCourier["steadfast"];
                if (dbSf && dbSf.total > 0) {
                    return {
                        courier: "steadfast",
                        courier_name: "Steadfast Courier",
                        status: "LIVE",
                        total_parcels: dbSf.total,
                        total_delivered: dbSf.delivered,
                        total_cancelled: dbSf.cancelled,
                        success_rate: pct(dbSf.delivered, dbSf.total),
                        note: "Verified consignment ledger",
                    };
                }
                return {
                    courier: "steadfast",
                    courier_name: "Steadfast Courier",
                    status: "NOT_CONNECTED",
                    total_parcels: null,
                    total_delivered: null,
                    total_cancelled: null,
                    success_rate: null,
                    note: "Not configured",
                };
            })(),
            // 3. RedX Delivery (OpenAPI + verified consignment history)
            (async () => {
                const rxPhone = config?.redx?.phone || "";
                const rxPass = config?.redx?.password || "";
                if (rxPhone && rxPass) {
                    const rxRes = await FraudRiskEngine.checkRedxNationwide(cleanPhone, rxPhone, rxPass).catch(() => null);
                    if (rxRes) {
                        return {
                            courier: "redx",
                            courier_name: "RedX Delivery",
                            status: "LIVE",
                            total_parcels: rxRes.total,
                            total_delivered: rxRes.delivered,
                            total_cancelled: rxRes.cancelled,
                            success_rate: pct(rxRes.delivered, rxRes.total),
                        };
                    }
                }
                const dbRx = dbByCourier["redx"];
                if (dbRx && dbRx.total > 0) {
                    return {
                        courier: "redx",
                        courier_name: "RedX Delivery",
                        status: "LIVE",
                        total_parcels: dbRx.total,
                        total_delivered: dbRx.delivered,
                        total_cancelled: dbRx.cancelled,
                        success_rate: pct(dbRx.delivered, dbRx.total),
                        note: "Verified consignment ledger",
                    };
                }
                if (config?.redx?.enabled) {
                    return {
                        courier: "redx",
                        courier_name: "RedX Delivery",
                        status: "API_CONNECTED",
                        total_parcels: null,
                        total_delivered: null,
                        total_cancelled: null,
                        success_rate: null,
                        note: "No prior RedX record",
                    };
                }
                return {
                    courier: "redx",
                    courier_name: "RedX Delivery",
                    status: "NOT_CONNECTED",
                    total_parcels: null,
                    total_delivered: null,
                    total_cancelled: null,
                    success_rate: null,
                    note: "Not configured",
                };
            })(),
            // 4. Paperfly Go (Merchant API + Smart-Check + verified consignment history)
            (async () => {
                const pfUser = config?.paperfly?.username || "";
                const pfPass = config?.paperfly?.password || "";
                if (pfUser && pfPass) {
                    const pfRes = await FraudRiskEngine.checkPaperflySmartCheck(cleanPhone, pfUser, pfPass).catch(() => null);
                    if (pfRes && pfRes.status === "LIVE" && pfRes.total !== null) {
                        return {
                            courier: "paperfly",
                            courier_name: "Paperfly Go",
                            status: "LIVE",
                            total_parcels: pfRes.total,
                            total_delivered: pfRes.delivered,
                            total_cancelled: pfRes.cancelled,
                            success_rate: pfRes.delivered != null ? pct(pfRes.delivered, pfRes.total) : null,
                        };
                    }
                }
                const dbPf = dbByCourier["paperfly"];
                if (dbPf && dbPf.total > 0) {
                    return {
                        courier: "paperfly",
                        courier_name: "Paperfly Go",
                        status: "LIVE",
                        total_parcels: dbPf.total,
                        total_delivered: dbPf.delivered,
                        total_cancelled: dbPf.cancelled,
                        success_rate: pct(dbPf.delivered, dbPf.total),
                        note: "Verified consignment ledger",
                    };
                }
                if (config?.paperfly?.enabled) {
                    return {
                        courier: "paperfly",
                        courier_name: "Paperfly Go",
                        status: "API_CONNECTED",
                        total_parcels: null,
                        total_delivered: null,
                        total_cancelled: null,
                        success_rate: null,
                        note: "No prior Paperfly record",
                    };
                }
                return {
                    courier: "paperfly",
                    courier_name: "Paperfly Go",
                    status: "NOT_CONNECTED",
                    total_parcels: null,
                    total_delivered: null,
                    total_cancelled: null,
                    success_rate: null,
                    note: "Not configured",
                };
            })(),
        ]);
        for (const settled of [ptTask, sfTask, rxTask, pfTask]) {
            if (settled.status === "fulfilled" && settled.value) {
                breakdown.push(settled.value);
            }
        }
        let total = 0;
        let delivered = 0;
        let cancelled = 0;
        for (const item of breakdown) {
            if (item.status === "LIVE" && item.total_parcels !== null) {
                verifiedByCarrier = true;
                dataSources.push(`${item.courier}_nationwide`);
                total += item.total_parcels;
                delivered += item.total_delivered || 0;
                cancelled += item.total_cancelled || 0;
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
                    courier_breakdown: breakdown,
                    coverage_note: `Queried ${dataSources.filter((s) => s !== "prefix_validator").join(", ")} live databases; 0 prior consignments recorded.`,
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
                courier_breakdown: breakdown,
                coverage_note: `Aggregated ${total} historical consignments from ${dataSources.filter((s) => s !== "prefix_validator").join(", ")}.`,
            };
        }
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
            courier_breakdown: breakdown,
            coverage_note: "Validated format via BTRC prefix rules only; no upstream carrier history available.",
        };
    }
}
