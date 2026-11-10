import { randomUUID } from "node:crypto";

export type EnvelopeSource = "live_api" | "static_tariff" | "cache" | "validator";

export type EnvelopeErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "CONSIGNMENT_NOT_FOUND"
  | "COURIER_NOT_CONFIGURED"
  | "COURIER_UPSTREAM_ERROR"
  | "UNSUPPORTED_BY_PROVIDER"
  | "DUPLICATE_INVOICE";

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

export class McpToolError extends Error {
  public readonly code: EnvelopeErrorCode;
  public readonly retryable: boolean;
  public readonly courier?: string;
  public readonly source: EnvelopeSource;
  public readonly extraFields?: Record<string, any>;

  constructor(opts: {
    code: EnvelopeErrorCode;
    message: string;
    retryable?: boolean;
    courier?: string;
    source?: EnvelopeSource;
    extraFields?: Record<string, any>;
  }) {
    super(opts.message);
    this.name = "McpToolError";
    this.code = opts.code;
    this.retryable = Boolean(opts.retryable);
    this.courier = opts.courier;
    this.source = opts.source || "live_api";
    this.extraFields = opts.extraFields;
  }
}

/**
 * Wrap a successful tool payload in the global response envelope while keeping
 * existing top-level fields intact alongside the envelope for backward compatibility.
 */
export function wrapSuccess<T>(payload: T, source: EnvelopeSource = "live_api"): GlobalEnvelope<T> {
  const spread =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, any>)
      : { items: payload, success: true };

  return {
    ...spread,
    ok: true,
    data: payload,
    error: null,
    meta: {
      request_id: randomUUID(),
      source,
      as_of: new Date().toISOString(),
    },
  };
}

/**
 * Sanitize any error (including raw Axios errors) into a structured GlobalEnvelope
 * that NEVER leaks raw Axios/HTTP error strings ("Request failed with status code ...").
 */
export function wrapError(
  err: any,
  defaultSource: EnvelopeSource = "live_api",
  defaultCourier?: string
): GlobalEnvelope<null> {
  if (err instanceof McpToolError) {
    return {
      ...(err.extraFields || {}),
      success: false,
      ok: false,
      data: null,
      error: {
        code: err.code,
        message: sanitizeMessage(err.message),
        retryable: err.retryable,
        ...(err.courier ? { courier: err.courier } : defaultCourier ? { courier: defaultCourier } : {}),
      },
      meta: {
        request_id: randomUUID(),
        source: err.source || defaultSource,
        as_of: new Date().toISOString(),
      },
    };
  }

  const httpStatus = err?.response?.status as number | undefined;
  const errCode = String(err?.code || "");
  const rawMsg = String(err?.message || "Unexpected operational error");

  let code: EnvelopeErrorCode = "COURIER_UPSTREAM_ERROR";
  let retryable = false;
  let cleanMsg = "Upstream courier gateway error.";

  if (rawMsg.toLowerCase().includes("not configured")) {
    code = "COURIER_NOT_CONFIGURED";
    retryable = false;
    cleanMsg = sanitizeMessage(rawMsg);
  } else if (httpStatus === 401 || httpStatus === 403) {
    code = "COURIER_UPSTREAM_ERROR";
    retryable = false;
    cleanMsg = "Courier upstream authentication or access rejected by provider.";
  } else if (httpStatus === 404) {
    code = "CONSIGNMENT_NOT_FOUND";
    retryable = false;
    cleanMsg = "Requested consignment or resource was not found in the courier network.";
  } else if (
    httpStatus === 429 ||
    (httpStatus && httpStatus >= 500) ||
    errCode === "ECONNABORTED" ||
    errCode === "ETIMEDOUT" ||
    errCode === "ECONNRESET" ||
    rawMsg.toLowerCase().includes("timeout")
  ) {
    code = "COURIER_UPSTREAM_ERROR";
    retryable = true;
    cleanMsg = "Courier upstream service temporarily unavailable or timed out.";
  } else if (httpStatus === 400 || httpStatus === 422 || rawMsg.toLowerCase().includes("invalid")) {
    code = "INVALID_INPUT";
    retryable = false;
    cleanMsg = sanitizeMessage(rawMsg);
  } else {
    cleanMsg = sanitizeMessage(rawMsg);
  }

  return {
    success: false,
    ok: false,
    data: null,
    error: {
      code,
      message: cleanMsg,
      retryable,
      ...(defaultCourier ? { courier: defaultCourier } : {}),
    },
    meta: {
      request_id: randomUUID(),
      source: defaultSource,
      as_of: new Date().toISOString(),
    },
  };
}

export function sanitizeMessage(msg: string): string {
  return String(msg || "Operation failed")
    .replace(/Request failed with status code \d+/gi, "Upstream provider returned an error status")
    .replace(/AxiosError:\s*/gi, "")
    .trim();
}

/**
 * Bounded retry with exponential backoff for read-only GET operations.
 * Retries only on 429, 5xx, or network timeouts.
 */
export async function withGetRetry<T>(fn: () => Promise<T>, maxRetries = 2, baseDelayMs = 150): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status;
      const code = String(err?.code || "");
      const isRetryable =
        status === 429 ||
        (typeof status === "number" && status >= 500) ||
        code === "ECONNABORTED" ||
        code === "ETIMEDOUT" ||
        code === "ECONNRESET";

      if (!isRetryable || attempt >= maxRetries) {
        throw err;
      }
      attempt++;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Mask Bangladeshi phone numbers for privacy-safe audit logging (e.g., 017****1234).
 */
export function maskPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}
