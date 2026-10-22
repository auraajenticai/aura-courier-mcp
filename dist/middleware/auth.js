/**
 * Check if the inbound request has merchant custom carrier credentials (BYOK - Bring Your Own Keys)
 */
export function hasByokCredentials(req) {
    const h = req.headers;
    const q = req.query;
    const hasKey = (header, query) => Boolean(h[header] || q[query]);
    return Boolean(hasKey("x-steadfast-api-key", "steadfast_key") ||
        hasKey("x-pathao-client-id", "pathao_client_id") ||
        hasKey("x-redx-api-token", "redx_token") ||
        hasKey("x-paperfly-api-key", "paperfly_key"));
}
/**
 * Extract bearer token or API key from request
 */
export function extractAuthToken(req) {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (typeof authHeader === "string") {
        if (authHeader.startsWith("Bearer ") || authHeader.startsWith("bearer ")) {
            return authHeader.slice(7).trim();
        }
        return authHeader.trim();
    }
    const customKey = req.headers["x-aura-key"] || req.headers["x-api-key"];
    if (typeof customKey === "string") {
        return customKey.trim();
    }
    const qKey = req.query["aura_key"] || req.query["api_key"];
    if (typeof qKey === "string") {
        return qKey.trim();
    }
    return undefined;
}
/**
 * Optional Auth Evaluator:
 * Public endpoints, discovery, and BYOK requests are permitted.
 * If server has AURA_API_KEY set, master-account mutating actions require authentication.
 */
export function optionalAuthMiddleware(req, res, next) {
    const serverApiKey = process.env.AURA_API_KEY || process.env.COURIER_AUTH_TOKEN;
    const isByok = hasByokCredentials(req);
    const callerToken = extractAuthToken(req);
    const isMasterAuthorized = Boolean(!serverApiKey || (callerToken && callerToken === serverApiKey));
    req.auraAuth = {
        isByok,
        isMasterAuthorized,
        callerToken,
    };
    next();
}
/**
 * Helper to verify whether an action requires master auth and whether it is granted
 */
export function isActionPermitted(req, toolName) {
    const isMutatingAction = ["create_parcel", "get_balance", "resolve_ndr_issue"].includes(toolName);
    // Read-only tools (list_couriers, calculate_delivery_zone_and_fee, compare_courier_rates, etc.) are always permitted
    if (!isMutatingAction) {
        return { permitted: true };
    }
    // If caller brought their own courier credentials, they are modifying their own account — permitted!
    if (req.auraAuth?.isByok) {
        return { permitted: true };
    }
    // If using server default merchant credentials, verify master authorization
    if (req.auraAuth?.isMasterAuthorized) {
        return { permitted: true };
    }
    return {
        permitted: false,
        reason: `Unauthorized: Dispatching parcels or checking wallet balance using the master merchant account requires a valid Aura API key (pass 'Authorization: Bearer <token>' or 'x-aura-key') or Bring-Your-Own-Keys (BYOK) courier headers.`,
    };
}
