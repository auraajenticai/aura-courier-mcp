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
        enabled: boolean;
    };
    paperfly: {
        user: string;
        pass: string;
        key: string;
        baseUrl: string;
        enabled: boolean;
    };
}
export declare function loadConfig(): CourierConfig;
