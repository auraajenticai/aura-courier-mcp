export interface CourierConfig {
    steadfast: {
        apiKey: string;
        secretKey: string;
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
}
export type EnvSource = Record<string, string | undefined>;
/**
 * Build a CourierConfig from a key/value source.
 * Defaults to process.env (used by the STDIO/npx entrypoint); the HTTP
 * entrypoint passes a per-request map built from that client's headers/query.
 */
export declare function loadConfig(src?: EnvSource): CourierConfig;
