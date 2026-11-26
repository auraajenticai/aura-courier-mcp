import dotenv from "dotenv";
if (process.env.NODE_ENV !== "test") {
    const runtimePort = process.env.PORT;
    dotenv.config({ override: true });
    if (runtimePort) {
        process.env.PORT = runtimePort;
    }
}
else {
    dotenv.config();
}
export const ALLOWED_CARRIER_HOSTS = {
    steadfast: ["portal.packzy.com", "portal.steadfast.com.bd"],
    pathao: ["api-hermes.pathao.com", "courier-api-sandbox.pathao.com"],
    redx: ["openapi.redx.com.bd", "sandbox.redx.com.bd"],
    paperfly: ["api.paperfly.com.bd"],
};
/**
 * P1-01 Anti-SSRF Guard: Enforce HTTPS-only + strict official carrier hostname allowlist.
 * Blocks http:, IP literals (IPv4/IPv6), localhost/.internal, credentials-in-URL, and non-standard ports.
 */
export function validateCarrierBaseUrl(provider, candidate, defaultUrl) {
    const raw = (candidate || "").trim();
    if (!raw)
        return defaultUrl;
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new Error(`Invalid ${provider} base URL format.`);
    }
    if (parsed.protocol !== "https:") {
        throw new Error(`Disallowed ${provider} base URL protocol '${parsed.protocol}' (HTTPS required).`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`Disallowed credentials in ${provider} base URL.`);
    }
    if (parsed.port && parsed.port !== "443") {
        throw new Error(`Disallowed non-standard port '${parsed.port}' in ${provider} base URL.`);
    }
    const host = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_CARRIER_HOSTS[provider];
    if (!allowed.includes(host)) {
        throw new Error(`Disallowed ${provider} base URL host '${host}'. Permitted official hosts: ${allowed.join(", ")}.`);
    }
    return parsed.toString().replace(/\/+$/, "");
}
/**
 * Build a CourierConfig from a key/value source.
 * Defaults to process.env (used by the STDIO/npx entrypoint); the HTTP
 * entrypoint passes a per-request map built from authenticated tenant/BYOK headers.
 */
export function loadConfig(src = process.env) {
    const steadfastApiKey = src.STEADFAST_API_KEY || "";
    const steadfastSecretKey = src.STEADFAST_SECRET_KEY || "";
    const pathaoClientId = src.PATHAO_CLIENT_ID || "";
    const pathaoClientSecret = src.PATHAO_CLIENT_SECRET || "";
    const googleMapsKey = src.GOOGLE_MAPS_API_KEY || "";
    return {
        steadfast: {
            apiKey: steadfastApiKey,
            secretKey: steadfastSecretKey,
            email: src.STEADFAST_EMAIL || "",
            password: src.STEADFAST_PASSWORD || "",
            baseUrl: validateCarrierBaseUrl("steadfast", src.STEADFAST_BASE_URL, "https://portal.packzy.com/api/v1"),
            enabled: Boolean(steadfastApiKey && steadfastSecretKey),
        },
        pathao: {
            clientId: pathaoClientId,
            clientSecret: pathaoClientSecret,
            username: src.PATHAO_USERNAME || "",
            password: src.PATHAO_PASSWORD || "",
            storeId: src.PATHAO_STORE_ID || "",
            baseUrl: validateCarrierBaseUrl("pathao", src.PATHAO_BASE_URL, "https://api-hermes.pathao.com"),
            enabled: Boolean(pathaoClientId && pathaoClientSecret),
        },
        redx: {
            apiToken: src.REDX_API_TOKEN || "",
            phone: src.REDX_PHONE || "",
            password: src.REDX_PASSWORD || "",
            baseUrl: validateCarrierBaseUrl("redx", src.REDX_BASE_URL, "https://openapi.redx.com.bd/v1.0.0-beta"),
            pickupStoreId: src.REDX_PICKUP_STORE_ID || "",
            enabled: Boolean(src.REDX_API_TOKEN),
        },
        paperfly: {
            apiKey: src.PAPERFLY_API_KEY || "",
            username: src.PAPERFLY_USERNAME || "",
            password: src.PAPERFLY_PASSWORD || "",
            storeName: src.PAPERFLY_STORE_NAME || "",
            baseUrl: validateCarrierBaseUrl("paperfly", src.PAPERFLY_BASE_URL, "https://api.paperfly.com.bd"),
            enabled: Boolean(src.PAPERFLY_API_KEY && src.PAPERFLY_USERNAME),
        },
        googleMaps: {
            apiKey: googleMapsKey,
            enabled: Boolean(googleMapsKey),
        },
        extraFraudCreds: {
            carrybeeEmail: src.CARRYBEE_EMAIL || "",
            carrybeePassword: src.CARRYBEE_PASSWORD || "",
            ecourierApiKey: src.ECOURIER_API_KEY || "",
            ecourierApiSecret: src.ECOURIER_API_SECRET || "",
            ecourierUserId: src.ECOURIER_USER_ID || "",
            parceldexApiKey: src.PARCELDEX_API_KEY || "",
        },
    };
}
