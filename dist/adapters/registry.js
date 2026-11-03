/**
 * Adapter registry — the gateway that routes a normalized request to the
 * right courier adapter. New couriers register here; callers never touch
 * adapters directly, only this registry.
 */
import { CourierError } from "./base.js";
import { SteadfastAdapter } from "./steadfast.js";
import { PathaoAdapter } from "./pathao.js";
export class CourierRegistry {
    adapters = new Map();
    constructor(config) {
        this.register(new SteadfastAdapter(config.steadfast));
        this.register(new PathaoAdapter(config.pathao));
    }
    register(adapter) {
        this.adapters.set(adapter.id, adapter);
    }
    get(courier) {
        const adapter = this.adapters.get(courier);
        if (!adapter) {
            throw new CourierError("unknown_courier", `No adapter registered for "${courier}".`);
        }
        return adapter;
    }
    /** For the `list_couriers` tool and diagnostics. */
    list() {
        return [...this.adapters.values()].map((a) => ({
            id: a.id,
            label: a.label,
            configured: a.isConfigured(),
        }));
    }
}
//# sourceMappingURL=registry.js.map