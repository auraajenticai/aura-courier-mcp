import { type Express, type Request } from "express";
import { EnvSource } from "./config.js";
/**
 * NEW-01 Fix: Automated Data Retention Engine (Daily Sweep) aligned to live PostgreSQL `courier_parcels` schema.
 */
export declare function runDataRetentionSweep(pool: any): Promise<number>;
/**
 * P0-03 & P1-01 Fix: Pull authenticated tenant BYOK keys strictly from request headers.
 * Arbitrary caller base-URL headers are validated against the official HTTPS carrier allowlist
 * (rejecting any http:, IP literal, private/internal host, or unlisted domain).
 */
export declare function keysFromRequest(req: Request): EnvSource;
export declare const app: Express;
export declare function clearWebhookReplayCache(): void;
