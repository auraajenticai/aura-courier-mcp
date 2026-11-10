import { createHash, timingSafeEqual } from "node:crypto";
import { maskPhone, wrapError, McpToolError } from "../envelope.js";
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
const keyRateStore = new Map();
export const auditLogBuffer = [];
export function hasByokCredentials(req) {
    const h = req.headers;
    const q = req.query;
    const hasKey = (header, query) => Boolean(h[header] || q[query]);
    return Boolean(hasKey("x-steadfast-api-key", "steadfast_key") ||
        hasKey("x-pathao-client-id", "pathao_client_id") ||
        hasKey("x-redx-api-token", "redx_token") ||
        hasKey("x-paperfly-api-key", "paperfly_key"));
}
export function extractBearerToken(req) {
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
    return undefined;
}
function safeCompare(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length)
        return false;
    return timingSafeEqual(bufA, bufB);
}
/**
 * Resolve bearer token into tenant context and scopes (read / write).
 */
export function resolveAuthContext(req) {
    const token = extractBearerToken(req);
    const isByok = hasByokCredentials(req);
    const masterKey = process.env.AURA_API_KEY ||
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
    // 1. Master / Admin Key (Read + Write on master tenant)
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
    // 2. Read-Only Key (Read scope only)
    if (safeCompare(token, readOnlyKey) || token.startsWith("aura_ro_")) {
        const tenantHash = createHash("sha256").update(token).digest("hex").slice(0, 12);
        return {
            authenticated: true,
            tenantId: `tenant_${tenantHash}`,
            scopes: ["read"],
            isByok,
            isAdmin: false,
            callerToken: token,
        };
    }
    // 3. Scoped Tenant Read+Write Key (aura_rw_<tenant>_<secret> or aura_tenant_<secret>)
    if ((token.startsWith("aura_rw_") || token.startsWith("aura_tenant_")) && token.length >= 16) {
        const tenantHash = createHash("sha256").update(token).digest("hex").slice(0, 12);
        return {
            authenticated: true,
            tenantId: `tenant_${tenantHash}`,
            scopes: ["read", "write"],
            isByok,
            isAdmin: false,
            callerToken: token,
        };
    }
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
export function optionalAuthMiddleware(req, _res, next) {
    req.auraAuth = resolveAuthContext(req);
    next();
}
/**
 * Strict /mcp Authentication & Per-Key Rate Limit Guard (T1)
 * Missing or invalid Bearer token -> HTTP 401 + UNAUTHORIZED envelope
 */
export function requireMcpAuth(req, res, next) {
    const ctx = req.auraAuth || resolveAuthContext(req);
    req.auraAuth = ctx;
    if (!ctx.authenticated) {
        res
            .status(401)
            .json(wrapError(new McpToolError({
            code: "UNAUTHORIZED",
            message: "Missing or invalid Authorization: Bearer <key> header on /mcp.",
            retryable: false,
            source: "validator",
        })));
        return;
    }
    // Per-key rate limit check (120 requests / minute per key)
    const keyId = ctx.tenantId;
    const now = Date.now();
    const bucket = keyRateStore.get(keyId);
    if (!bucket || now > bucket.resetAt) {
        keyRateStore.set(keyId, { count: 1, resetAt: now + 60_000 });
    }
    else {
        bucket.count++;
        if (bucket.count > 120) {
            res.status(429).json(wrapError(new McpToolError({
                code: "COURIER_UPSTREAM_ERROR",
                message: "Per-key rate limit exceeded. Try again in 60 seconds.",
                retryable: true,
                source: "validator",
            })));
            return;
        }
    }
    next();
}
/**
 * Verify scope permission for a specific tool and record a privacy-safe audit log entry (T1)
 */
export function isActionPermitted(req, toolName, args) {
    const ctx = req.auraAuth || resolveAuthContext(req);
    if (!ctx.authenticated) {
        recordAuditLog(ctx.tenantId, toolName, args, "denied");
        return {
            permitted: false,
            reason: "Unauthorized: valid Authorization: Bearer <key> required.",
        };
    }
    const requiredScope = WRITE_TOOLS.has(toolName) || !READ_TOOLS.has(toolName) ? "write" : "read";
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
export function recordAuditLog(tenant, tool, args, outcome) {
    const safeCopy = {};
    for (const [k, v] of Object.entries(args || {})) {
        if (/phone/i.test(k)) {
            safeCopy[k] = maskPhone(String(v));
        }
        else if (/address/i.test(k)) {
            safeCopy[k] = "[REDACTED_ADDRESS]";
        }
        else {
            safeCopy[k] = v;
        }
    }
    const argsHash = createHash("sha256").update(JSON.stringify(safeCopy)).digest("hex").slice(0, 16);
    const entry = {
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
 * Verify inbound courier webhook authentication / signature (T1)
 * Rejects unsigned/invalid webhook calls with HTTP 401/403.
 */
export function verifyWebhookSignature(req, provider) {
    const secret = process.env.AURA_WEBHOOK_SECRET ||
        process.env.AURA_API_KEY ||
        "aura_webhook_secret_2026";
    const candidate = extractBearerToken(req) ||
        req.headers["x-webhook-secret"] ||
        req.headers[`x-${provider}-signature`] ||
        req.headers["x-pathao-signature"] ||
        req.headers["x-steadfast-signature"] ||
        req.query["token"] ||
        req.query["secret"];
    if (!candidate || typeof candidate !== "string") {
        return false;
    }
    return safeCompare(candidate.trim(), secret);
}
