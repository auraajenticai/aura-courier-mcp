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
}

export type EnvSource = Record<string, string | undefined>;

/**
 * Build a CourierConfig from a key/value source.
 * Defaults to process.env (used by the STDIO/npx entrypoint); the HTTP
 * entrypoint passes a per-request map built from that client's headers/query.
 */
export function loadConfig(src: EnvSource = process.env): CourierConfig {
  const steadfastApiKey = src.STEADFAST_API_KEY || "e4pss5dglu3efhbgxlvx4nfgxizvpla5";
  const steadfastSecretKey = src.STEADFAST_SECRET_KEY || "8dityj8hfeuvkg4cmuafsmxk";

  const pathaoClientId = src.PATHAO_CLIENT_ID || "46dBOyYe79";
  const pathaoClientSecret = src.PATHAO_CLIENT_SECRET || "50yOJz09VSdfhzAaRMMeuiQ87lgrO1z8LmK0LbCb";

  const googleMapsKey = src.GOOGLE_MAPS_API_KEY || "AIzaSyByHxLB69J9h0f70irbNBPbzsbmDE0Innc";

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
      username: src.PATHAO_USERNAME || "snehalatabestonline@gmail.com",
      password: src.PATHAO_PASSWORD || "Redwan877091@&",
      storeId: src.PATHAO_STORE_ID || "356230",
      baseUrl: src.PATHAO_BASE_URL || "https://api-hermes.pathao.com",
      enabled: Boolean(pathaoClientId && pathaoClientSecret),
    },
    redx: {
      apiToken: src.REDX_API_TOKEN || "",
      baseUrl: src.REDX_BASE_URL || "https://openapi.redx.com.bd/v1.0.0-beta",
      pickupStoreId: src.REDX_PICKUP_STORE_ID || "",
      enabled: Boolean(src.REDX_API_TOKEN),
    },
    paperfly: {
      apiKey: src.PAPERFLY_API_KEY || "",
      username: src.PAPERFLY_USERNAME || "",
      password: src.PAPERFLY_PASSWORD || "",
      storeName: src.PAPERFLY_STORE_NAME || "Aura Merchant",
      baseUrl: src.PAPERFLY_BASE_URL || "https://api.paperfly.com.bd",
      enabled: Boolean(src.PAPERFLY_API_KEY && src.PAPERFLY_USERNAME),
    },
    googleMaps: {
      apiKey: googleMapsKey,
      enabled: Boolean(googleMapsKey),
    },
  };
}
