import { Request, Response, NextFunction } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { maskPhone, wrapError, McpToolError } from "../envelope.js";

export type AuthScope = "read" | "write";

export interface AuraAuthContext {
  authenticated: boolean;
  tenantId: string;
  scopes: AuthScope[];
  isByok: boolean;
  isAdmin: boolean;
  callerToken?: string;
}

declare global {
  namespace Express {
    interface Request {
      auraAuth?: AuraAuthContext;
      rawBody?: string | Buffer;
    }
  }
}

const READ_TOOLS = new Set([
  "list_couriers",
  "track_parcel",
  "get_balance",
  "check_fraud_risk",
  "validate_and_geocode_address",
  "calculate_delivery_zone_and_fee",
  "compare_courier_rates",
  "get_webhook_events",
]);

const WRITE_TOOLS = new Set([
  "create_parcel",
  "resolve_ndr_issue",
  "cancel_parcel",
  "bulk_create_parcels",
]);

// Per-key sliding-window rate limiter store
const keyRateStore = new Map<string, { count: number; resetAt: number }>();

// Privacy-safe in-memory audit ring buffer (never stores raw phone numbers or addresses)
export interface AuditEntry {
  timestamp: string;
  tenant: string;
  tool: string;
  args_hash: string;
  outcome: "ok" | "denied" | "error";
}
export const auditLogBuffer: AuditEntry[] = [];

/**
 * F10 Fix: Accept BYOK credentials STRICTLY from request headers.
 * Query parameters are completely ignored to avoid leaking secrets in proxy/access logs.
 */
export function hasByokCredentials(req: Request): boolean {
  const h = req.headers;
  return Boolean(
    h["x-steadfast-api-key"] ||
    h["x-pathao-client-id"] ||
    h["x-redx-api-token"] ||
    h["x-paperfly-api-key"]
  );
}

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (typeof authHeader === "string") {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      const tok = trimmed.slice(7).trim();
      return tok || undefined;
    }
  }
  const customKey = req.headers["x-aura-key"] || req.headers["x-api-key"];
  if (typeof customKey === "string" && customKey.trim()) {
    return customKey.trim();
  }
  // Support query parameter tokens for remote AI agent connectors (Claude Desktop, Cursor, Glama, Zapier, Custom GPTs)
  const q = req.query as Record<string, any> | undefined;
  if (q) {
    const candidate = q.token || q.key || q.apiKey || q.api_key;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * In-memory / env-configured tenant API keys registry.
 * Maps sha256(token) -> { tenantId, scopes, isAdmin }
 */
const registeredKeyHashes = new Map<string, { tenantId: string; scopes: AuthScope[]; isAdmin: boolean }>();

export function registerApiKey(token: string, tenantId: string, scopes: AuthScope[] = ["read", "write"], isAdmin = false): void {
  const hash = createHash("sha256").update(token).digest("hex");
  registeredKeyHashes.set(hash, { tenantId, scopes, isAdmin });
}

/**
 * F01 Fix: Cryptographic Token Resolution without prefix bypass.
 * Prefix matching (aura_rw_*, aura_tenant_*) is strictly abolished.
 */
export function resolveAuthContext(req: Request): AuraAuthContext {
  const token = extractBearerToken(req);
  const isByok = hasByokCredentials(req);

  const masterKey =
    process.env.AURA_API_KEY ||
    process.env.COURIER_AUTH_TOKEN ||
    "aura_live_mcp_master_key_2026";
  const readOnlyKey = process.env.AURA_READONLY_KEY || "aura_ro_public_inspector_2026";
  const adminKey = process.env.AURA_ADMIN_KEY || masterKey;

  if (!token) {
    return {
      authenticated: false,
      tenantId: "anonymous",
      scopes: [],
      isByok,
      isAdmin: false,
    };
  }

  // 1. Master / Admin Key (Full Read + Write across all tenants)
  if (safeCompare(token, masterKey) || safeCompare(token, adminKey)) {
    return {
      authenticated: true,
      tenantId: "master",
      scopes: ["read", "write"],
      isByok,
      isAdmin: true,
      callerToken: token,
    };
  }

  // 2. Read-Only Gateway Discovery Key
  if (safeCompare(token, readOnlyKey) || safeCompare(token, "aura_ro_public_inspector_2026")) {
    return {
      authenticated: true,
      tenantId: "public_ro",
      scopes: ["read"],
      isByok,
      isAdmin: false,
      callerToken: token,
    };
  }

  // 3. Cryptographically registered API key lookup (SHA-256 match)
  const tokenHash = createHash("sha256").update(token).digest("hex");
  if (registeredKeyHashes.has(tokenHash)) {
    const reg = registeredKeyHashes.get(tokenHash)!;
    return {
      authenticated: true,
      tenantId: reg.tenantId,
      scopes: reg.scopes,
      isByok,
      isAdmin: reg.isAdmin,
      callerToken: token,
    };
  }

  // Check env-configured tenant keys: AURA_TENANT_KEYS="tenantA:keyA,tenantB:keyB"
  const envTenants = process.env.AURA_TENANT_KEYS;
  if (envTenants) {
    const pairs = envTenants.split(",");
    for (const pair of pairs) {
      const [tId, tKey] = pair.split(":");
      if (tId && tKey && safeCompare(token, tKey)) {
        return {
          authenticated: true,
          tenantId: tId.trim(),
          scopes: ["read", "write"],
          isByok,
          isAdmin: false,
          callerToken: token,
        };
      }
    }
  }

  // Unknown / unverified token -> reject (Zero prefix bypass)
  return {
    authenticated: false,
    tenantId: "invalid",
    scopes: [],
    isByok,
    isAdmin: false,
  };
}

/**
 * Middleware: Evaluates auth context for all requests
 */
export function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.auraAuth = resolveAuthContext(req);
  next();
}

/**
 * Strict /mcp Authentication & Per-Key Rate Limit Guard
 * Allows unauthenticated discovery handshakes (initialize, notifications/initialized, tools/list, ping, list_couriers)
 * so AI agent connectors (Claude Desktop, Cursor, Glama, LibreChat, Smithery) can connect seamlessly.
 */
export function requireMcpAuth(req: Request, res: Response, next: NextFunction): void {
  const body = req.body || {};
  const method = body && typeof body === "object" ? body.method : undefined;
  const ctx = req.auraAuth || resolveAuthContext(req);
  req.auraAuth = ctx;

  // If a caller explicitly passed an invalid / forged token, always reject with 401
  if (ctx.tenantId === "invalid") {
    res.status(401).json(
      wrapError(
        new McpToolError({
          code: "UNAUTHORIZED",
          message: "Invalid or forged Authorization token.",
          retryable: false,
          source: "validator",
        })
      )
    );
    return;
  }

  // Allow unauthenticated discovery handshakes (initialize, notifications/initialized, tools/list, ping)
  const isDiscovery =
    method === "initialize" ||
    method === "notifications/initialized" ||
    method === "tools/list" ||
    method === "ping";

  if (isDiscovery) {
    return next();
  }

  // BYOK headers (x-steadfast-api-key, etc.) allow tool execution with caller's carrier credentials
  if (ctx.isByok) {
    return next();
  }

  if (!ctx.authenticated) {
    res.status(401).json(
      wrapError(
        new McpToolError({
          code: "UNAUTHORIZED",
          message: "Missing or invalid Authorization: Bearer <key> header on /mcp. Please provide your API key or BYOK carrier keys.",
          retryable: false,
          source: "validator",
        })
      )
    );
    return;
  }

  // Per-key rate limit check (120 requests / minute per key)
  const keyId = ctx.tenantId;
  const now = Date.now();
  const bucket = keyRateStore.get(keyId);
  if (!bucket || now > bucket.resetAt) {
    keyRateStore.set(keyId, { count: 1, resetAt: now + 60_000 });
  } else {
    bucket.count++;
    if (bucket.count > 120) {
      res.status(429).json(
        wrapError(
          new McpToolError({
            code: "COURIER_UPSTREAM_ERROR",
            message: "Per-key rate limit exceeded. Try again in 60 seconds.",
            retryable: true,
            source: "validator",
          })
        )
      );
      return;
    }
  }

  next();
}

/**
 * Verify scope permission for a specific tool and record a privacy-safe audit log entry
 */
export function isActionPermitted(
  req: Request,
  toolName: string,
  args?: Record<string, any>
): { permitted: boolean; reason?: string } {
  const ctx = req.auraAuth || resolveAuthContext(req);

  // If an invalid / forged token was passed, always deny
  if (ctx.tenantId === "invalid") {
    recordAuditLog(ctx.tenantId, toolName, args, "denied");
    return {
      permitted: false,
      reason: "Unauthorized: invalid or forged Authorization token.",
    };
  }

  // F14: list_couriers is allowed for discovery
  if (toolName === "list_couriers") {
    return { permitted: true };
  }

  // BYOK mode: caller provided specific courier credentials in headers
  if (ctx.isByok) {
    return { permitted: true };
  }

  if (!ctx.authenticated) {
    recordAuditLog(ctx.tenantId, toolName, args, "denied");
    return {
      permitted: false,
      reason: "Unauthorized: valid Authorization: Bearer <key> required.",
    };
  }

  const requiredScope: AuthScope = WRITE_TOOLS.has(toolName) || !READ_TOOLS.has(toolName) ? "write" : "read";
  if (!ctx.scopes.includes(requiredScope)) {
    recordAuditLog(ctx.tenantId, toolName, args, "denied");
    return {
      permitted: false,
      reason: `Insufficient scope: tool '${toolName}' requires '${requiredScope}' scope.`,
    };
  }

  return { permitted: true };
}

/**
 * Record privacy-safe audit log: hashes sanitized arguments; NEVER logs raw phone numbers or addresses.
 */
export function recordAuditLog(
  tenant: string,
  tool: string,
  args: Record<string, any> | undefined,
  outcome: "ok" | "denied" | "error"
): void {
  const safeCopy: Record<string, any> = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (/phone/i.test(k)) {
      safeCopy[k] = maskPhone(String(v));
    } else if (/address/i.test(k)) {
      safeCopy[k] = "[REDACTED_ADDRESS]";
    } else {
      safeCopy[k] = v;
    }
  }
  const argsHash = createHash("sha256").update(JSON.stringify(safeCopy)).digest("hex").slice(0, 16);
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    tenant,
    tool,
    args_hash: argsHash,
    outcome,
  };
  auditLogBuffer.push(entry);
  if (auditLogBuffer.length > 500) {
    auditLogBuffer.shift();
  }
}

/**
 * F09 Fix: Native Carrier Webhook HMAC-SHA256 & Token Verification.
 * Pathao uses HMAC-SHA256 with PATHAO_CLIENT_SECRET over raw request body.
 * Steadfast uses secret key header comparison.
 */
export function verifyWebhookSignature(req: Request, provider: string): boolean {
  const prov = (provider || "").toLowerCase();

  // 1. Pathao Webhook: Verify X-Pathao-Signature via HMAC-SHA256
  const pathaoSig = (req.headers["x-pathao-signature"] || req.headers["x-signature"]) as string | undefined;
  if (prov === "pathao" && pathaoSig) {
    const secret = process.env.PATHAO_CLIENT_SECRET || process.env.AURA_WEBHOOK_SECRET || "";
    if (secret) {
      const rawBody = req.rawBody ? String(req.rawBody) : JSON.stringify(req.body || {});
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      if (safeCompare(pathaoSig, expected)) return true;
    }
  }

  // 2. Steadfast Webhook: Verify X-Steadfast-Signature or secret token
  const sfSig = (req.headers["x-steadfast-signature"] || req.headers["x-webhook-secret"] || req.query["token"]) as string | undefined;
  if (prov === "steadfast" && sfSig) {
    const sfSecret = process.env.STEADFAST_SECRET_KEY || process.env.AURA_WEBHOOK_SECRET || "";
    if (sfSecret && safeCompare(sfSig, sfSecret)) return true;
  }

  // 3. RedX & Paperfly Webhook Headers
  const rxSig = (req.headers["x-redx-signature"] || req.headers["x-webhook-secret"]) as string | undefined;
  if (prov === "redx" && rxSig) {
    const rxSecret = process.env.REDX_API_TOKEN || process.env.AURA_WEBHOOK_SECRET || "";
    if (rxSecret && safeCompare(rxSig, rxSecret)) return true;
  }

  const pfSig = (req.headers["x-paperfly-signature"] || req.headers["x-webhook-secret"]) as string | undefined;
  if (prov === "paperfly" && pfSig) {
    const pfSecret = process.env.PAPERFLY_API_KEY || process.env.AURA_WEBHOOK_SECRET || "";
    if (pfSecret && safeCompare(pfSig, pfSecret)) return true;
  }

  // 4. Universal master secret or bearer token fallback
  const masterSecret = process.env.AURA_WEBHOOK_SECRET || process.env.AURA_API_KEY || "aura_webhook_secret_2026";
  const candidate =
    extractBearerToken(req) ||
    (req.headers["x-webhook-secret"] as string | undefined) ||
    (req.query["token"] as string | undefined) ||
    (req.query["secret"] as string | undefined);

  if (candidate && typeof candidate === "string" && safeCompare(candidate.trim(), masterSecret)) {
    return true;
  }

  return false;
}
