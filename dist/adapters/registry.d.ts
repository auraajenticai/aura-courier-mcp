/**
 * Adapter registry — the gateway that routes a normalized request to the
 * right courier adapter. New couriers register here; callers never touch
 * adapters directly, only this registry.
 */
import { type CourierAdapter } from "./base.js";
import type { AppConfig } from "../config.js";
import type { CourierId } from "../types.js";
export declare class CourierRegistry {
    private readonly adapters;
    constructor(config: AppConfig);
    private register;
    get(courier: CourierId): CourierAdapter;
    /** For the `list_couriers` tool and diagnostics. */
    list(): {
        id: CourierId;
        label: string;
        configured: boolean;
    }[];
}
