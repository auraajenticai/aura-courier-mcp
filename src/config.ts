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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    steadfast: {
      apiKey: env.STEADFAST_API_KEY,
      secretKey: env.STEADFAST_SECRET_KEY,
    },
  };
}
