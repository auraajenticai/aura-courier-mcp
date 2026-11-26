import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { maskPhone, wrapError, McpToolError } from "../envelope.js";
import { verifyOAuthAccessToken, buildWwwAuthenticateHeader } from "./oauth.js";
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
    "update_parcel",
    "bulk_create_parcels",
]);
// Per-key sliding-window rate limiter store
const keyRateStore = new Map();
export const auditLogBuffer = [];
export const FORBIDDEN_WEAK_SECRETS = new Set([
    "aura_live_mcp_master_key_2026",
    "aura_ro_public_inspector_2026",
    "aura_webhook_secret_2026",
    "change_me",
    "changeme",
    "secret",
    "password",
    "default",
    "test",
]);
export function isStrongSecret(val, minLen = 20) {
    if (!val || typeof val !== "string")
        return false;
    const v = val.trim();
    if (v.length < minLen)
        return false;
    const low = v.toLowerCase();
    if (FORBIDDEN_WEAK_SECRETS.has(low))
        return false;
    if (low.startsWith("your_") || low.includes("<generate") || low.includes("replace_me"))
        return false;
    return true;
}
export function getMasterKey() {
    const candidate = (process.env.AURA_API_KEY || process.env.COURIER_AUTH_TOKEN || "").trim();
    return isStrongSecret(candidate, 20) ? candidate : "";
}
export function getAdminKey() {
    const explicit = (process.env.AURA_ADMIN_KEY || "").trim();
    if (explicit)
        return isStrongSecret(explicit, 20) ? explicit : "";
    return getMasterKey();
}
export function getReadOnlyKey() {
    const candidate = (process.env.AURA_READONLY_KEY || "").trim();
    return isStrongSecret(candidate, 16) ? candidate : "";
}
export function getWebhookSecret() {
    const candidate = (process.env.AURA_WEBHOOK_SECRET || "").trim();
    return isStrongSecret(candidate, 20) ? candidate : "";
}
export function validateSecurityConfig() {
    const errors = [];
    if (!getMasterKey()) {
        errors.push("AURA_API_KEY (or COURIER_AUTH_TOKEN) is missing, weak (<20 chars), or uses a forbidden default value.");
    }
    if (process.env.AURA_ADMIN_KEY && !isStrongSecret(process.env.AURA_ADMIN_KEY, 20)) {
        errors.push("AURA_ADMIN_KEY is weak (<20 chars) or uses a forbidden default value.");
    }
    if (process.env.AURA_READONLY_KEY && !isStrongSecret(process.env.AURA_READONLY_KEY, 16)) {
        errors.push("AURA_READONLY_KEY is weak (<16 chars) or uses a forbidden default value.");
    }
    if (!getWebhookSecret()) {
        errors.push("AURA_WEBHOOK_SECRET is missing, weak (<20 chars), or uses a forbidden default value.");
    }
    const oauthSecret = (process.env.AURA_OAUTH_SECRET || "").trim();
    if (oauthSecret && !isStrongSecret(oauthSecret, 24)) {
        errors.push("AURA_OAUTH_SECRET is weak (<24 chars) or uses a forbidden default value.");
    }
    else if (!oauthSecret && !getMasterKey()) {
        errors.push("AURA_OAUTH_SECRET (or strong AURA_API_KEY) is required for OAuth 2.1 token signing.");
    }
    return { ok: errors.length === 0, errors };
}
function headerStr(req, name) {
    const v = req.headers[name];
    if (Array.isArray(v))
        return String(v[0] || "").trim();
    return typeof v === "string" ? v.trim() : "";
}
/**
 * P0-03 Fix: Detect and validate BYOK carrier credential bundles strictly from request headers.
 * Every BYOK provider supplied must include its complete required credential set.
 * BYOK NEVER bypasses Aura authentication or tool scopes.
 */
export function validateByokHeaders(req) {
    const sfKey = headerStr(req, "x-steadfast-api-key");
    const sfSec = headerStr(req, "x-steadfast-secret-key");
    const pId = headerStr(req, "x-pathao-client-id");
    const pSec = headerStr(req, "x-pathao-client-secret");
    const pUser = headerStr(req, "x-pathao-username");
    const pPass = headerStr(req, "x-pathao-password");
    const rxTok = headerStr(req, "x-redx-api-token");
    const pfKey = headerStr(req, "x-paperfly-api-key");
    const pfUser = headerStr(req, "x-paperfly-username");
    const pfPass = headerStr(req, "x-paperfly-password");
    const hasSf = Boolean(sfKey || sfSec);
    const hasPathao = Boolean(pId || pSec || pUser || pPass);
    const hasRx = Boolean(rxTok);
    const hasPf = Boolean(pfKey || pfUser || pfPass);
    const isByok = hasSf || hasPathao || hasRx || hasPf;
    if (!isByok)
        return { isByok: false, valid: true };
    if (hasSf && (sfKey.length < 6 || sfSec.length < 6)) {
        return {
            isByok: true,
            valid: false,
            reason: "Incomplete Steadfast BYOK bundle: both x-steadfast-api-key and x-steadfast-secret-key (>=6 chars) are required.",
        };
    }
    if (hasPathao && (!pId || !pSec || !pUser || !pPass)) {
        return {
            isByok: true,
            valid: false,
            reason: "Incomplete Pathao BYOK bundle: x-pathao-client-id, x-pathao-client-secret, x-pathao-username, and x-pathao-password are all required.",
        };
    }
    if (hasRx && rxTok.length < 12) {
        return {
            isByok: true,
            valid: false,
            reason: "Invalid RedX BYOK bundle: x-redx-api-token must be at least 12 characters.",
        };
    }
    if (hasPf && (!pfKey || !pfUser || !pfPass)) {
        return {
            isByok: true,
            valid: false,
            reason: "Incomplete Paperfly BYOK bundle: x-paperfly-api-key, x-paperfly-username, and x-paperfly-password are all required.",
        };
    }
    return { isByok: true, valid: true };
}
export function hasByokCredentials(req) {
    return validateByokHeaders(req).isByok;
}
export function extractBearerToken(req) {
    const cachedQueryTok = req._extractedQueryToken;
    if (typeof cachedQueryTok === "string" && cachedQueryTok) {
        return cachedQueryTok;
    }
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
    // NEW-05 Fix: Restrict query-parameter tokens strictly to MCP/SSE connector endpoints (never /admin, /track, /webhooks, /oauth)
    // and scrub secret query parameters from req.url / req.originalUrl immediately to prevent downstream log exposure.
    if (process.env.ALLOW_QUERY_TOKEN !== "false") {
        const reqPath = (req.path || (req.url ? req.url.split("?")[0] : "")).trim();
        if (reqPath === "/mcp" || reqPath === "/sse" || reqPath === "/messages") {
            const q = req.query;
            if (q) {
                const candidate = q.token || q.key || q.apiKey || q.api_key;
                if (typeof candidate === "string" && candidate.trim()) {
                    const cleanTok = candidate.trim();
                    req._extractedQueryToken = cleanTok;
                    req._usedQueryToken = true;
                    delete q.token;
                    delete q.key;
                    delete q.apiKey;
                    delete q.api_key;
                    if (typeof req.url === "string" && req.url.includes("?")) {
                        req.url = req.url.replace(/([?&])(token|key|apiKey|api_key)=[^&]*/gi, "$1[REDACTED]").replace(/\?&/, "?");
                    }
                    if (typeof req.originalUrl === "string" && req.originalUrl.includes("?")) {
                        req.originalUrl = req.originalUrl
                            .replace(/([?&])(token|key|apiKey|api_key)=[^&]*/gi, "$1[REDACTED]")
                            .replace(/\?&/, "?");
                    }
                    return cleanTok;
                }
            }
        }
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
const dynamicKeyHashes = new Map();
const remoteVerifyCache = new Map();
let authDbPool = null;
export async function initDynamicAuthStore(pool) {
    authDbPool = pool;
    if (!pool)
        return;
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS aura_mcp_dynamic_keys (
        token_hash TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        store_name TEXT,
        scopes JSONB NOT NULL DEFAULT '["read","write"]',
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    }
    catch (ddlErr) {
        // Least-privilege runtime DB roles (e.g. aura_courier_runtime) intentionally lack schema CREATE;
        // the table is pre-provisioned, so continue cleanly to load rows below.
        if (!/permission denied/i.test(String(ddlErr?.message || ""))) {
            console.warn("[Auth] Dynamic key table DDL skipped:", ddlErr?.message);
        }
    }
    try {
        const res = await pool.query("SELECT token_hash, tenant_id, store_name, scopes, is_admin, status, updated_at FROM aura_mcp_dynamic_keys");
        for (const row of res.rows || []) {
            dynamicKeyHashes.set(row.token_hash, {
                tokenHash: row.token_hash,
                tenantId: row.tenant_id,
                storeName: row.store_name || undefined,
                scopes: Array.isArray(row.scopes) ? row.scopes : ["read", "write"],
                isAdmin: Boolean(row.is_admin),
                status: String(row.status || "ACTIVE").toUpperCase(),
                updatedAt: new Date(row.updated_at || Date.now()).toISOString(),
            });
        }
        console.log(`[Auth] Loaded ${dynamicKeyHashes.size} dynamic MCP key(s) from PostgreSQL.`);
    }
    catch (err) {
        console.warn("[Auth] Dynamic key table load skipped:", err?.message);
    }
}
export async function upsertDynamicKeyHash(opts) {
    const hash = (opts.tokenHash || (opts.rawToken ? createHash("sha256").update(opts.rawToken).digest("hex") : "")).trim();
    if (!hash)
        throw new Error("tokenHash or rawToken required");
    const status = String(opts.status || "ACTIVE").toUpperCase();
    const scopes = Array.isArray(opts.scopes) && opts.scopes.length ? opts.scopes : ["read", "write"];
    const rec = {
        tokenHash: hash,
        tenantId: opts.tenantId,
        storeName: opts.storeName,
        scopes,
        isAdmin: Boolean(opts.isAdmin),
        status,
        updatedAt: new Date().toISOString(),
    };
    dynamicKeyHashes.set(hash, rec);
    if (opts.rawToken) {
        remoteVerifyCache.set(hash, { exp: Date.now() + 20_000, record: rec });
    }
    if (authDbPool) {
        try {
            await authDbPool.query(`INSERT INTO aura_mcp_dynamic_keys (token_hash, tenant_id, store_name, scopes, is_admin, status, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())
         ON CONFLICT (token_hash) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           store_name = COALESCE(EXCLUDED.store_name, aura_mcp_dynamic_keys.store_name),
           scopes = EXCLUDED.scopes,
           is_admin = EXCLUDED.is_admin,
           status = EXCLUDED.status,
           updated_at = NOW()`, [hash, rec.tenantId, rec.storeName || null, JSON.stringify(scopes), rec.isAdmin, status]);
        }
        catch (err) {
            console.warn("[Auth] Failed persisting dynamic key:", err?.message);
        }
    }
    return rec;
}
export async function setTenantDynamicKeyStatus(tenantId, status) {
    const norm = String(status || "SUSPENDED").toUpperCase();
    let updated = 0;
    for (const [h, rec] of dynamicKeyHashes.entries()) {
        if (rec.tenantId === tenantId) {
            dynamicKeyHashes.set(h, { ...rec, status: norm, updatedAt: new Date().toISOString() });
            remoteVerifyCache.delete(h);
            updated++;
        }
    }
    if (authDbPool) {
        try {
            await authDbPool.query("UPDATE aura_mcp_dynamic_keys SET status = $1, updated_at = NOW() WHERE tenant_id = $2", [norm, tenantId]);
        }
        catch { }
    }
    return updated;
}
export function listDynamicKeySummaries() {
    return Array.from(dynamicKeyHashes.values()).map((r) => ({
        hashPrefix: r.tokenHash.slice(0, 10) + "...",
        tenantId: r.tenantId,
        storeName: r.storeName || "",
        status: r.status,
        scopes: r.scopes,
        updatedAt: r.updatedAt,
    }));
}
const registeredKeyHashes = new Map();
export function registerApiKey(token, tenantId, scopes = ["read", "write"], isAdmin = false) {
    const hash = createHash("sha256").update(token).digest("hex");
    registeredKeyHashes.set(hash, { tenantId, scopes, isAdmin });
}
/**
 * P0-01 Fix: Fail-Closed Cryptographic Token Resolution.
 * Zero hardcoded fallback keys; zero prefix bypasses.
 */
export function resolveAuthContext(req) {
    const token = extractBearerToken(req);
    const isByok = hasByokCredentials(req);
    const masterKey = getMasterKey();
    const readOnlyKey = getReadOnlyKey();
    const adminKey = getAdminKey();
    if (!token) {
        return {
            authenticated: false,
            tenantId: "anonymous",
            scopes: [],
            isByok,
            isAdmin: false,
        };
    }
    // Reject known leaked/default weak tokens unconditionally
    if (FORBIDDEN_WEAK_SECRETS.has(token.toLowerCase())) {
        return {
            authenticated: false,
            tenantId: "invalid",
            scopes: [],
            isByok,
            isAdmin: false,
        };
    }
    // 0. Standard MCP OAuth 2.1 JWT Access Token (Google Gemini, ChatGPT, Claude Web)
    if (token.startsWith("eyJ") && token.split(".").length === 3) {
        const oauthClaims = verifyOAuthAccessToken(token);
        if (oauthClaims) {
            return {
                authenticated: true,
                tenantId: oauthClaims.sub,
                scopes: Array.isArray(oauthClaims.scp) && oauthClaims.scp.length ? oauthClaims.scp : ["read"],
                isByok,
                isAdmin: Boolean(oauthClaims.adm),
                callerToken: token,
            };
        }
    }
    // 1. Master / Admin Key (Full Read + Write across all tenants — strictly from strong env secret)
    if ((masterKey && safeCompare(token, masterKey)) || (adminKey && safeCompare(token, adminKey))) {
        return {
            authenticated: true,
            tenantId: "master",
            scopes: ["read", "write"],
            isByok,
            isAdmin: true,
            callerToken: token,
        };
    }
    // 2. Read-Only Gateway Discovery Key (strictly from strong env secret)
    if (readOnlyKey && safeCompare(token, readOnlyKey)) {
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
        const reg = registeredKeyHashes.get(tokenHash);
        return {
            authenticated: true,
            tenantId: reg.tenantId,
            scopes: reg.scopes,
            isByok,
            isAdmin: reg.isAdmin,
            callerToken: token,
        };
    }
    // 3b. Dynamic Database / Synced Tenant Key lookup
    if (dynamicKeyHashes.has(tokenHash)) {
        const dyn = dynamicKeyHashes.get(tokenHash);
        if (dyn.status === "PAYMENT_DUE") {
            return {
                authenticated: false,
                tenantId: dyn.tenantId,
                scopes: [],
                isByok,
                isAdmin: false,
                callerToken: token,
                deniedReason: "পেমেন্ট বাকি থাকায় MCP Connector অ্যাক্সেস হোল্ড করা হয়েছে (Payment Due)।",
                httpStatus: 402,
            };
        }
        if (dyn.status === "SUSPENDED" || dyn.status === "DISABLED") {
            return {
                authenticated: false,
                tenantId: dyn.tenantId,
                scopes: [],
                isByok,
                isAdmin: false,
                callerToken: token,
                deniedReason: "অ্যাডমিন দ্বারা MCP Connector অ্যাক্সেস স্থগিত করা হয়েছে।",
                httpStatus: 403,
            };
        }
        return {
            authenticated: true,
            tenantId: dyn.tenantId,
            scopes: dyn.scopes,
            isByok,
            isAdmin: dyn.isAdmin,
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
export async function resolveAuthContextAsync(req) {
    const token = extractBearerToken(req);
    const local = resolveAuthContext(req);
    if (process.env.NODE_ENV === "test" ||
        !token ||
        !token.startsWith("snl_mcp_") ||
        local.authenticated ||
        local.deniedReason) {
        return local;
    }
    const hash = createHash("sha256").update(token).digest("hex");
    const cached = remoteVerifyCache.get(hash);
    if (cached && Date.now() < cached.exp && cached.record) {
        return resolveAuthContext(req);
    }
    const verifyUrl = process.env.SNEHALATA_VERIFY_KEY_URL || "https://www.snehalata.com/api/mcp/verify-key";
    const syncSecret = (process.env.AURA_MCP_SYNC_SECRET || getMasterKey()).trim();
    if (!syncSecret)
        return local;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
        const resp = await fetch(verifyUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-aura-sync-secret": syncSecret,
            },
            body: JSON.stringify({ token }),
            signal: ctrl.signal,
        });
        if (!resp.ok)
            return local;
        const data = await resp.json().catch(() => ({}));
        if (!data?.valid || !data?.tenantId)
            return local;
        const status = data.allowed ? String(data.status || "ACTIVE") : String(data.status || "PAYMENT_DUE");
        await upsertDynamicKeyHash({
            tokenHash: hash,
            rawToken: token,
            tenantId: String(data.tenantId),
            storeName: data.storeName,
            scopes: Array.isArray(data.scopes) && data.scopes.length ? data.scopes : ["read", "write"],
            isAdmin: Boolean(data.isAdmin),
            status,
        });
        return resolveAuthContext(req);
    }
    catch {
        return local;
    }
    finally {
        clearTimeout(timer);
    }
}
export async function optionalAuthMiddleware(req, _res, next) {
    req.auraAuth = await resolveAuthContextAsync(req);
    next();
}
/**
 * Strict /mcp Authentication & Per-Key Rate Limit Guard
 * Allows unauthenticated discovery handshakes (initialize, notifications/initialized, tools/list, ping, list_couriers)
 * so AI agent connectors (Claude Desktop, Cursor, Glama, LibreChat, Smithery) can connect seamlessly.
 */
export function requireMcpAuth(req, res, next) {
    const body = req.body || {};
    const method = body && typeof body === "object" ? body.method : undefined;
    const ctx = req.auraAuth || resolveAuthContext(req);
    req.auraAuth = ctx;
    if (ctx.deniedReason) {
        res.status(ctx.httpStatus || 402).json(wrapError(new McpToolError({
            code: "UNAUTHORIZED",
            message: ctx.deniedReason,
            retryable: false,
            source: "validator",
        })));
        return;
    }
    // If a caller explicitly passed an invalid / expired / forged token, always reject with 401 + RFC 9728 WWW-Authenticate
    if (ctx.tenantId === "invalid") {
        res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(req, true));
        res.status(401).json(wrapError(new McpToolError({
            code: "UNAUTHORIZED",
            message: "Invalid or expired Authorization token.",
            retryable: false,
            source: "validator",
        })));
        return;
    }
    // Allow stateless public catalog discovery (tools/list, ping) for MCP directories while requiring auth on initialize/tools/call so OAuth 2.1 clients (Gemini, ChatGPT, Claude Web) trigger automatic OAuth discovery via 401 WWW-Authenticate.
    const isDiscovery = method === "tools/list" ||
        method === "ping";
    if (isDiscovery) {
        return next();
    }
    // P0-03 Fix: NEVER bypass Aura auth on BYOK headers. Authenticate caller first, then validate BYOK bundle.
    if (!ctx.authenticated) {
        res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(req, false));
        res.status(401).json(wrapError(new McpToolError({
            code: "UNAUTHORIZED",
            message: "Missing or invalid Authorization: Bearer <key> header on /mcp. Authenticate via MCP OAuth 2.1 or provide a valid tenant API key (BYOK headers require authentication too).",
            retryable: false,
            source: "validator",
        })));
        return;
    }
    const byokCheck = validateByokHeaders(req);
    if (byokCheck.isByok && !byokCheck.valid) {
        res.status(400).json(wrapError(new McpToolError({
            code: "INVALID_INPUT",
            message: byokCheck.reason || "Incomplete BYOK carrier credential bundle.",
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
 * Verify scope permission for a specific tool and record a privacy-safe audit log entry
 */
export function isActionPermitted(req, toolName, args) {
    const ctx = req.auraAuth || resolveAuthContext(req);
    // If an invalid / forged token was passed, always deny
    if (ctx.tenantId === "invalid") {
        recordAuditLog(ctx.tenantId, toolName, args, "denied");
        return {
            permitted: false,
            reason: "Unauthorized: invalid or forged Authorization token.",
        };
    }
    // P0-03 Fix: Every tool invocation (including BYOK) MUST be authenticated and pass scope checks.
    if (!ctx.authenticated) {
        recordAuditLog(ctx.tenantId, toolName, args, "denied");
        return {
            permitted: false,
            reason: "Unauthorized: valid Authorization: Bearer <key> or OAuth 2.1 token required.",
        };
    }
    if (ctx.isByok) {
        const byokCheck = validateByokHeaders(req);
        if (!byokCheck.valid) {
            recordAuditLog(ctx.tenantId, toolName, args, "denied");
            return {
                permitted: false,
                reason: byokCheck.reason || "Incomplete BYOK carrier credential bundle.",
            };
        }
    }
    // F14: list_couriers is allowed for any authenticated caller (read discovery)
    if (toolName === "list_couriers") {
        return { permitted: true };
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
 * P0-02 Fix: Fail-Closed Carrier Webhook Authentication & Server-Side Tenant Resolution.
 * - Abolishes arbitrary >=8-char URL path token acceptance.
 * - Abolishes hardcoded webhook secret fallbacks.
 * - Resolves tenantId strictly from server-side verified key/provider bindings (never attacker-supplied URL paths).
 */
export function authenticateWebhook(req, provider) {
    const prov = (provider || "").toLowerCase();
    const webhookMasterSecret = getWebhookSecret();
    // 1. Pathao Webhook: Verify X-Pathao-Signature via HMAC-SHA256 over raw body
    const pathaoSig = (req.headers["x-pathao-signature"] || req.headers["x-signature"]);
    if (prov === "pathao" && pathaoSig && typeof pathaoSig === "string") {
        const rawBody = req.rawBody ? String(req.rawBody) : JSON.stringify(req.body || {});
        const candidateSecrets = [
            (process.env.PATHAO_WEBHOOK_SECRET || "").trim(),
            (process.env.PATHAO_CLIENT_SECRET || "").trim(),
            webhookMasterSecret,
        ].filter(Boolean);
        for (const secret of candidateSecrets) {
            const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
            if (safeCompare(pathaoSig.trim(), expected)) {
                return {
                    valid: true,
                    tenantId: (process.env.PATHAO_WEBHOOK_TENANT || "default").trim() || "default",
                    authMethod: "pathao_hmac",
                };
            }
        }
    }
    // 2. Steadfast Webhook: Verify X-Steadfast-Signature or secret header against STEADFAST_SECRET_KEY
    const sfSig = (req.headers["x-steadfast-signature"] || req.headers["x-webhook-secret"]);
    if (prov === "steadfast" && sfSig && typeof sfSig === "string") {
        const sfSecret = (process.env.STEADFAST_SECRET_KEY || "").trim();
        if (sfSecret && safeCompare(sfSig.trim(), sfSecret)) {
            return { valid: true, tenantId: "default", authMethod: "steadfast_secret" };
        }
    }
    // 3. RedX & Paperfly Provider Secrets
    const rxSig = (req.headers["x-redx-signature"] || req.headers["x-webhook-secret"]);
    if (prov === "redx" && rxSig && typeof rxSig === "string") {
        const rxSecret = (process.env.REDX_API_TOKEN || "").trim();
        if (rxSecret && safeCompare(rxSig.trim(), rxSecret)) {
            return { valid: true, tenantId: "default", authMethod: "redx_secret" };
        }
    }
    const pfSig = (req.headers["x-paperfly-signature"] || req.headers["x-webhook-secret"]);
    if (prov === "paperfly" && pfSig && typeof pfSig === "string") {
        const pfSecret = (process.env.PAPERFLY_API_KEY || "").trim();
        if (pfSecret && safeCompare(pfSig.trim(), pfSecret)) {
            return { valid: true, tenantId: "default", authMethod: "paperfly_secret" };
        }
    }
    // 4. Platform Webhook Master Secret or Cryptographically Registered Tenant Key ONLY
    const paramToken = (req.params && req.params.merchant_token)
        ? String(req.params.merchant_token).trim()
        : undefined;
    const candidate = req.headers["x-webhook-secret"] ||
        extractBearerToken(req) ||
        paramToken;
    if (candidate && typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (!trimmed || FORBIDDEN_WEAK_SECRETS.has(trimmed.toLowerCase())) {
            return { valid: false, tenantId: "unauthorized" };
        }
        // 4a. Platform Webhook Master Secret (server-trusted caller may specify tenant scope via query/header)
        if (webhookMasterSecret && safeCompare(trimmed, webhookMasterSecret)) {
            const requestedTenant = String((req.query && req.query.tenant) ||
                req.headers["x-tenant-id"] ||
                "default").trim();
            const safeTenant = /^[a-zA-Z0-9_\-]{1,64}$/.test(requestedTenant) ? requestedTenant : "default";
            return { valid: true, tenantId: safeTenant, authMethod: "webhook_master_secret" };
        }
        // 4b. Registered Static / Dynamic Tenant Key (SHA-256 lookup — tenant strictly bound server-side)
        const tokenHash = createHash("sha256").update(trimmed).digest("hex");
        if (registeredKeyHashes.has(tokenHash)) {
            const reg = registeredKeyHashes.get(tokenHash);
            return { valid: true, tenantId: reg.tenantId, authMethod: "registered_tenant_key" };
        }
        if (dynamicKeyHashes.has(tokenHash)) {
            const dyn = dynamicKeyHashes.get(tokenHash);
            if (dyn.status === "ACTIVE") {
                return { valid: true, tenantId: dyn.tenantId, authMethod: "dynamic_tenant_key" };
            }
            return { valid: false, tenantId: "unauthorized" };
        }
        // 4c. Env-configured Tenant Keys (strictly compare against secret key tKey, NEVER tenant ID tId)
        const envTenants = process.env.AURA_TENANT_KEYS;
        if (envTenants) {
            for (const pair of envTenants.split(",")) {
                const [tId, tKey] = pair.split(":");
                if (tId && tKey && isStrongSecret(tKey.trim(), 16) && safeCompare(trimmed, tKey.trim())) {
                    return { valid: true, tenantId: tId.trim(), authMethod: "env_tenant_key" };
                }
            }
        }
    }
    return { valid: false, tenantId: "unauthorized" };
}
export function verifyWebhookSignature(req, provider) {
    return authenticateWebhook(req, provider).valid;
}
