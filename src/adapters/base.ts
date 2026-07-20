/**
 * The contract every courier adapter must satisfy.
 *
 * Adding a new courier (Pathao, RedX, Paperfly...) = implement this interface
 * and register it. Nothing else in the system changes. That is the whole moat:
 * we out-EXECUTE by adding couriers fast, behind one stable interface.
 */
import type {
  BalanceResult,
  CourierId,
  CreateParcelInput,
  Parcel,
  TrackRef,
  TrackingResult,
} from "../types.js";

export interface CourierAdapter {
  readonly id: CourierId;
  readonly label: string;

  /** True only when this adapter has the credentials it needs to make live calls. */
  isConfigured(): boolean;

  createParcel(input: CreateParcelInput): Promise<Parcel>;
  track(ref: TrackRef): Promise<TrackingResult>;

  /** Optional — not every courier exposes a balance endpoint. */
  getBalance?(): Promise<BalanceResult>;
}

/** A typed error so tools can report clean, actionable messages instead of raw crashes. */
export class CourierError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CourierError";
  }
}
