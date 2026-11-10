export type EnvelopeSource = "live_api" | "static_tariff" | "cache" | "validator";
export type EnvelopeErrorCode = "UNAUTHORIZED" | "INVALID_INPUT" | "CONSIGNMENT_NOT_FOUND" | "COURIER_NOT_CONFIGURED" | "COURIER_UPSTREAM_ERROR" | "UNSUPPORTED_BY_PROVIDER" | "DUPLICATE_INVOICE";
export interface EnvelopeError {
    code: EnvelopeErrorCode;
    message: string;
    retryable: boolean;
    courier?: string;
}
export interface EnvelopeMeta {
    request_id: string;
    source: EnvelopeSource;
    as_of: string;
}
export interface GlobalEnvelope<T = any> {
    ok: boolean;
    data: T | null;
    error: EnvelopeError | null;
    meta: EnvelopeMeta;
    [key: string]: any;
}
export declare class McpToolError extends Error {
    readonly code: EnvelopeErrorCode;
    readonly retryable: boolean;
    readonly courier?: string;
    readonly source: EnvelopeSource;
    readonly extraFields?: Record<string, any>;
    constructor(opts: {
        code: EnvelopeErrorCode;
        message: string;
        retryable?: boolean;
        courier?: string;
        source?: EnvelopeSource;
        extraFields?: Record<string, any>;
    });
}
/**
 * Wrap a successful tool payload in the global response envelope while keeping
 * existing top-level fields intact alongside the envelope for backward compatibility.
 */
export declare function wrapSuccess<T>(payload: T, source?: EnvelopeSource): GlobalEnvelope<T>;
/**
 * Sanitize any error (including raw Axios errors) into a structured GlobalEnvelope
 * that NEVER leaks raw Axios/HTTP error strings ("Request failed with status code ...").
 */
export declare function wrapError(err: any, defaultSource?: EnvelopeSource, defaultCourier?: string): GlobalEnvelope<null>;
export declare function sanitizeMessage(msg: string): string;
/**
 * Bounded retry with exponential backoff for read-only GET operations.
 * Retries only on 429, 5xx, or network timeouts.
 */
export declare function withGetRetry<T>(fn: () => Promise<T>, maxRetries?: number, baseDelayMs?: number): Promise<T>;
/**
 * Mask Bangladeshi phone numbers for privacy-safe audit logging (e.g., 017****1234).
 */
export declare function maskPhone(phone: string): string;
