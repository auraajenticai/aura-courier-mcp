import { Request, Response, NextFunction } from "express";
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
export interface AuditEntry {
    timestamp: string;
    tenant: string;
    tool: string;
    args_hash: string;
    outcome: "ok" | "denied" | "error";
}
export declare const auditLogBuffer: AuditEntry[];
/**
 * F10 Fix: Accept BYOK credentials STRICTLY from request headers.
 * Query parameters are completely ignored to avoid leaking secrets in proxy/access logs.
 */
export declare function hasByokCredentials(req: Request): boolean;
export declare function extractBearerToken(req: Request): string | undefined;
export declare function registerApiKey(token: string, tenantId: string, scopes?: AuthScope[], isAdmin?: boolean): void;
/**
 * F01 Fix: Cryptographic Token Resolution without prefix bypass.
 * Prefix matching (aura_rw_*, aura_tenant_*) is strictly abolished.
 */
export declare function resolveAuthContext(req: Request): AuraAuthContext;
/**
 * Middleware: Evaluates auth context for all requests
 */
export declare function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction): void;
/**
 * Strict /mcp Authentication & Per-Key Rate Limit Guard
 * F14: Allows unauthenticated read-only discovery on tools/list.
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
/**
 * F09 Fix: Native Carrier Webhook HMAC-SHA256 & Token Verification.
 * Pathao uses HMAC-SHA256 with PATHAO_CLIENT_SECRET over raw request body.
 * Steadfast uses secret key header comparison.
 */
export declare function verifyWebhookSignature(req: Request, provider: string): boolean;
