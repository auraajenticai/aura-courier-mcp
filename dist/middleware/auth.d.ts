import { Request, Response, NextFunction } from "express";
export interface AuraAuthContext {
    isByok: boolean;
    isMasterAuthorized: boolean;
    callerToken?: string;
}
declare global {
    namespace Express {
        interface Request {
            auraAuth?: AuraAuthContext;
        }
    }
}
/**
 * Check if the inbound request has merchant custom carrier credentials (BYOK - Bring Your Own Keys)
 */
export declare function hasByokCredentials(req: Request): boolean;
/**
 * Extract bearer token or API key from request
 */
export declare function extractAuthToken(req: Request): string | undefined;
/**
 * Optional Auth Evaluator:
 * Public endpoints, discovery, and BYOK requests are permitted.
 * If server has AURA_API_KEY set, master-account mutating actions require authentication.
 */
export declare function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): void;
/**
 * Helper to verify whether an action requires master auth and whether it is granted
 */
export declare function isActionPermitted(req: Request, toolName: string): {
    permitted: boolean;
    reason?: string;
};
