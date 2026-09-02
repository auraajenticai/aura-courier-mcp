import dotenv from "dotenv";

dotenv.config();

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
}

export type EnvSource = Record<string, string | undefined>;

/**
 * Build a CourierConfig from a key/value source.
 * Defaults to process.env (used by the STDIO/npx entrypoint); the HTTP
 * entrypoint passes a per-request map built from that client's headers/query.
 */
export function loadConfig(src: EnvSource = process.env): CourierConfig {
  const steadfastApiKey = src.STEADFAST_API_KEY || "";
  const steadfastSecretKey = src.STEADFAST_SECRET_KEY || "";

  const pathaoClientId = src.PATHAO_CLIENT_ID || "";
  const pathaoClientSecret = src.PATHAO_CLIENT_SECRET || "";

  return {
    steadfast: {
      apiKey: steadfastApiKey,
      secretKey: steadfastSecretKey,
      baseUrl: src.STEADFAST_BASE_URL || "https://portal.packzy.com/api/v1",
      enabled: Boolean(steadfastApiKey && steadfastSecretKey),
    },
    pathao: {
      clientId: pathaoClientId,
      clientSecret: pathaoClientSecret,
      username: src.PATHAO_USERNAME || "",
      password: src.PATHAO_PASSWORD || "",
      storeId: src.PATHAO_STORE_ID || "",
      baseUrl: src.PATHAO_BASE_URL || "https://api-hermes.pathao.com",
      enabled: Boolean(pathaoClientId && pathaoClientSecret),
    },
    redx: {
      apiToken: src.REDX_API_TOKEN || "",
      baseUrl: src.REDX_BASE_URL || "https://openapi.redx.com.bd/v1.0.0-beta",
      pickupStoreId: src.REDX_PICKUP_STORE_ID || "",
      enabled: Boolean(src.REDX_API_TOKEN),
    },
  };
}
