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

export function loadConfig(): CourierConfig {
  const steadfastApiKey = process.env.STEADFAST_API_KEY || "";
  const steadfastSecretKey = process.env.STEADFAST_SECRET_KEY || "";

  const pathaoClientId = process.env.PATHAO_CLIENT_ID || "";
  const pathaoClientSecret = process.env.PATHAO_CLIENT_SECRET || "";

  const redxApiToken = process.env.REDX_API_TOKEN || "";

  const paperflyUser = process.env.PAPERFLY_USER || "";
  const paperflyPass = process.env.PAPERFLY_PASSWORD || "";
  const paperflyKey = process.env.PAPERFLY_KEY || "";

  return {
    steadfast: {
      apiKey: steadfastApiKey,
      secretKey: steadfastSecretKey,
      baseUrl: process.env.STEADFAST_BASE_URL || "https://portal.packzy.com/api/v1",
      enabled: Boolean(steadfastApiKey && steadfastSecretKey),
    },
    pathao: {
      clientId: pathaoClientId,
      clientSecret: pathaoClientSecret,
      username: process.env.PATHAO_USERNAME || "",
      password: process.env.PATHAO_PASSWORD || "",
      storeId: process.env.PATHAO_STORE_ID || "",
      baseUrl: process.env.PATHAO_BASE_URL || "https://api-hermes.pathao.com",
      enabled: Boolean(pathaoClientId && pathaoClientSecret),
    },
    redx: {
      apiToken: redxApiToken,
      baseUrl: process.env.REDX_BASE_URL || "https://openapi.redx.com.bd/v1.0.0-beta",
      enabled: Boolean(redxApiToken),
    },
    paperfly: {
      user: paperflyUser,
      pass: paperflyPass,
      key: paperflyKey,
      baseUrl: process.env.PAPERFLY_BASE_URL || "https://api.paperfly.com.bd",
      enabled: Boolean(paperflyUser && paperflyPass && paperflyKey),
    },
  };
}
