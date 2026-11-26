export interface CourierConfig {
    steadfast: {
        apiKey: string;
        secretKey: string;
        email?: string;
        password?: string;
        baseUrl: string;
        enabled: boolean;
    };
    pathao: {
        clientId: string;
        clientSecret: string;
        username: string;
        password: string;
        storeId: string;
        baseUrl: string;
        enabled: boolean;
    };
    redx: {
        apiToken: string;
        phone?: string;
        password?: string;
        baseUrl: string;
        pickupStoreId: string;
        enabled: boolean;
    };
    paperfly: {
        apiKey: string;
        username: string;
        password: string;
        storeName: string;
        baseUrl: string;
        enabled: boolean;
    };
    googleMaps: {
        apiKey: string;
        enabled: boolean;
    };
    extraFraudCreds?: {
        carrybeeEmail: string;
        carrybeePassword: string;
        ecourierApiKey: string;
        ecourierApiSecret: string;
        ecourierUserId: string;
        parceldexApiKey: string;
    };
}
export type EnvSource = Record<string, string | undefined>;
export declare const ALLOWED_CARRIER_HOSTS: Record<"steadfast" | "pathao" | "redx" | "paperfly", readonly string[]>;
/**
 * P1-01 Anti-SSRF Guard: Enforce HTTPS-only + strict official carrier hostname allowlist.
 * Blocks http:, IP literals (IPv4/IPv6), localhost/.internal, credentials-in-URL, and non-standard ports.
 */
export declare function validateCarrierBaseUrl(provider: "steadfast" | "pathao" | "redx" | "paperfly", candidate: string | undefined, defaultUrl: string): string;
/**
 * Build a CourierConfig from a key/value source.
 * Defaults to process.env (used by the STDIO/npx entrypoint); the HTTP
 * entrypoint passes a per-request map built from authenticated tenant/BYOK headers.
 */
export declare function loadConfig(src?: EnvSource): CourierConfig;
