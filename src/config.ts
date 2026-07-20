/**
 * Credential loading — Bring-Your-Own, per merchant.
 *
 * v1 (single-merchant, stdio MCP): credentials come from the environment.
 * Future (hosted multi-tenant SaaS): swap this module to resolve per-tenant
 * credentials from a secret store keyed by the authenticated merchant — the
 * rest of the codebase does not change, because everything flows through here.
 */
export interface AppConfig {
  steadfast: {
    apiKey?: string;
    secretKey?: string;
  };
  pathao: {
    clientId?: string;
    clientSecret?: string;
    username?: string;
    password?: string;
    sandbox?: boolean;
    defaultStoreId?: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    steadfast: {
      apiKey: env.STEADFAST_API_KEY,
      secretKey: env.STEADFAST_SECRET_KEY,
    },
    pathao: {
      clientId: env.PATHAO_CLIENT_ID,
      clientSecret: env.PATHAO_CLIENT_SECRET,
      username: env.PATHAO_USERNAME,
      password: env.PATHAO_PASSWORD,
      sandbox: env.PATHAO_SANDBOX === "true",
      defaultStoreId: env.PATHAO_STORE_ID ? Number(env.PATHAO_STORE_ID) : undefined,
    },
  };
}
