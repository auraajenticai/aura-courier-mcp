/**
 * Normalized, courier-agnostic domain models.
 *
 * This is the heart of the platform: every courier adapter maps its own API
 * shape into THESE types, so Claude (and any MCP client) always sees one
 * consistent interface regardless of which courier is used underneath.
 */

/** Couriers we support (or plan to). Add here when an adapter lands. */
export type CourierId = "steadfast" | "pathao" | "redx" | "paperfly";

/** Unified delivery status across every courier. */
export type ParcelStatus =
  | "pending"
  | "in_review"
  | "picked"
  | "in_transit"
  | "delivered"
  | "partial_delivered"
  | "returned"
  | "cancelled"
  | "on_hold"
  | "unknown";

/** What the caller provides to book a parcel. Courier-neutral. */
export interface CreateParcelInput {
  courier: CourierId;
  /** Merchant's own order/invoice id. Doubles as the idempotency key. */
  invoice: string;
  recipientName: string;
  /** 11-digit BD mobile number, e.g. 01700000000. */
  recipientPhone: string;
  recipientAddress: string;
  /** Cash-on-delivery amount in BDT. Use 0 for prepaid. */
  codAmount: number;
  itemDescription?: string;
  note?: string;
}

/** A booked parcel, normalized. */
export interface Parcel {
  courier: CourierId;
  consignmentId: string;
  trackingCode: string;
  invoice: string;
  status: ParcelStatus;
  codAmount: number;
  recipientName: string;
  recipientPhone: string;
  /** Raw courier payload, kept for debugging/audit. */
  raw?: unknown;
}

/** How to look a parcel up — any one field is enough. */
export interface TrackRef {
  consignmentId?: string;
  invoice?: string;
  trackingCode?: string;
}

/** A tracking lookup result, normalized. */
export interface TrackingResult {
  courier: CourierId;
  reference: string;
  status: ParcelStatus;
  raw?: unknown;
}

/** Merchant account balance for a courier. */
export interface BalanceResult {
  courier: CourierId;
  currentBalance: number;
  currency: string;
}
