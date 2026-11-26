import { Request, Response, NextFunction } from "express";
export type AuthScope = "read" | "write";
export interface AuraAuthContext {
    authenticated: boolean;
    tenantId: string;
    scopes: AuthScope[];
    isByok: boolean;
    isAdmin: boolean;
    callerToken?: string;
    deniedReason?: string;
    httpStatus?: number;
}
declare global {
    namespace Express {
        interface Request {
            auraAuth?: AuraAuthContext;
            rawBody?: string | Buffer;
        }
    }
}
export interface AuditEntry {
    timestamp: string;
    tenant: string;
    tool: string;
    args_hash: string;
    outcome: "ok" | "denied" | "error";
}
export declare const auditLogBuffer: AuditEntry[];
export declare const FORBIDDEN_WEAK_SECRETS: Set<string>;
export declare function isStrongSecret(val: string | undefined, minLen?: number): boolean;
export declare function getMasterKey(): string;
export declare function getAdminKey(): string;
export declare function getReadOnlyKey(): string;
export declare function getWebhookSecret(): string;
export declare function validateSecurityConfig(): {
    ok: boolean;
    errors: string[];
};
/**
 * P0-03 Fix: Detect and validate BYOK carrier credential bundles strictly from request headers.
 * Every BYOK provider supplied must include its complete required credential set.
 * BYOK NEVER bypasses Aura authentication or tool scopes.
 */
export declare function validateByokHeaders(req: Request): {
    isByok: boolean;
    valid: boolean;
    reason?: string;
};
export declare function hasByokCredentials(req: Request): boolean;
export declare function extractBearerToken(req: Request): string | undefined;
/**
 * In-memory / env-configured tenant API keys registry.
 * Maps sha256(token) -> { tenantId, scopes, isAdmin }
 */
export interface DynamicKeyRecord {
    tokenHash: string;
    tenantId: string;
    storeName?: string;
    scopes: AuthScope[];
    isAdmin: boolean;
    status: string;
    updatedAt: string;
}
export declare function initDynamicAuthStore(pool: any): Promise<void>;
export declare function upsertDynamicKeyHash(opts: {
    tokenHash?: string;
    rawToken?: string;
    tenantId: string;
    storeName?: string;
    scopes?: AuthScope[];
    isAdmin?: boolean;
    status?: string;
}): Promise<DynamicKeyRecord>;
export declare function setTenantDynamicKeyStatus(tenantId: string, status: string): Promise<number>;
export declare function listDynamicKeySummaries(): {
    hashPrefix: string;
    tenantId: string;
    storeName: string;
    status: string;
    scopes: AuthScope[];
    updatedAt: string;
}[];
export declare function registerApiKey(token: string, tenantId: string, scopes?: AuthScope[], isAdmin?: boolean): void;
/**
 * P0-01 Fix: Fail-Closed Cryptographic Token Resolution.
 * Zero hardcoded fallback keys; zero prefix bypasses.
 */
export declare function resolveAuthContext(req: Request): AuraAuthContext;
/**
 * Middleware: Evaluates auth context for all requests
 */
export declare function resolveAuthContextAsync(req: Request): Promise<AuraAuthContext>;
export declare function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void>;
/**
 * Strict /mcp Authentication & Per-Key Rate Limit Guard
 * Allows unauthenticated discovery handshakes (initialize, notifications/initialized, tools/list, ping, list_couriers)
 * so AI agent connectors (Claude Desktop, Cursor, Glama, LibreChat, Smithery) can connect seamlessly.
 */
export declare function requireMcpAuth(req: Request, res: Response, next: NextFunction): void;
/**
 * Verify scope permission for a specific tool and record a privacy-safe audit log entry
 */
export declare function isActionPermitted(req: Request, toolName: string, args?: Record<string, any>): {
    permitted: boolean;
    reason?: string;
};
/**
 * Record privacy-safe audit log: hashes sanitized arguments; NEVER logs raw phone numbers or addresses.
 */
export declare function recordAuditLog(tenant: string, tool: string, args: Record<string, any> | undefined, outcome: "ok" | "denied" | "error"): void;
export interface WebhookAuthResult {
    valid: boolean;
    tenantId: string;
    authMethod?: string;
}
/**
 * P0-02 Fix: Fail-Closed Carrier Webhook Authentication & Server-Side Tenant Resolution.
 * - Abolishes arbitrary >=8-char URL path token acceptance.
 * - Abolishes hardcoded webhook secret fallbacks.
 * - Resolves tenantId strictly from server-side verified key/provider bindings (never attacker-supplied URL paths).
 */
export declare function authenticateWebhook(req: Request, provider: string): WebhookAuthResult;
export declare function verifyWebhookSignature(req: Request, provider: string): boolean;
