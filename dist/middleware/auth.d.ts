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
export declare function hasByokCredentials(req: Request): boolean;
export declare function extractBearerToken(req: Request): string | undefined;
/**
 * Resolve bearer token into tenant context and scopes (read / write).
 */
export declare function resolveAuthContext(req: Request): AuraAuthContext;
/**
 * Middleware: Evaluates auth context for all requests
 */
export declare function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction): void;
/**
 * Strict /mcp Authentication & Per-Key Rate Limit Guard (T1)
 * Missing or invalid Bearer token -> HTTP 401 + UNAUTHORIZED envelope
 */
export declare function requireMcpAuth(req: Request, res: Response, next: NextFunction): void;
/**
 * Verify scope permission for a specific tool and record a privacy-safe audit log entry (T1)
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
 * Verify inbound courier webhook authentication / signature (T1)
 * Rejects unsigned/invalid webhook calls with HTTP 401/403.
 */
export declare function verifyWebhookSignature(req: Request, provider: string): boolean;
