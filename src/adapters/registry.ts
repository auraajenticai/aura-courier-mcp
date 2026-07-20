/**
 * Adapter registry — the gateway that routes a normalized request to the
 * right courier adapter. New couriers register here; callers never touch
 * adapters directly, only this registry.
 */
import { CourierError, type CourierAdapter } from "./base.js";
import { SteadfastAdapter } from "./steadfast.js";
import type { AppConfig } from "../config.js";
import type { CourierId } from "../types.js";

export class CourierRegistry {
  private readonly adapters = new Map<CourierId, CourierAdapter>();

  constructor(config: AppConfig) {
    this.register(new SteadfastAdapter(config.steadfast));
    // Next: this.register(new PathaoAdapter(config.pathao));
  }

  private register(adapter: CourierAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(courier: CourierId): CourierAdapter {
    const adapter = this.adapters.get(courier);
    if (!adapter) {
      throw new CourierError("unknown_courier", `No adapter registered for "${courier}".`);
    }
    return adapter;
  }

  /** For the `list_couriers` tool and diagnostics. */
  list(): { id: CourierId; label: string; configured: boolean }[] {
    return [...this.adapters.values()].map((a) => ({
      id: a.id,
      label: a.label,
      configured: a.isConfigured(),
    }));
  }
}
