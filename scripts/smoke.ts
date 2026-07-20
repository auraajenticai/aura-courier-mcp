/**
 * Offline smoke test — verifies core logic WITHOUT credentials or network.
 * Proves: status normalization, adapter registration, configured-detection,
 * and that an unconfigured call fails cleanly (typed error, not a crash).
 */
import { mapSteadfastStatus } from "../src/adapters/steadfast.js";
import { mapPathaoStatus } from "../src/adapters/pathao.js";
import { CourierRegistry } from "../src/adapters/registry.js";
import { loadConfig } from "../src/config.js";
import { CourierError } from "../src/adapters/base.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

console.log("Aura Courier MCP — smoke test\n");

// 1) Status normalization
check("delivered -> delivered", mapSteadfastStatus("delivered") === "delivered");
check(
  "delivered_approval_pending -> delivered",
  mapSteadfastStatus("delivered_approval_pending") === "delivered",
);
check("hold -> on_hold", mapSteadfastStatus("hold") === "on_hold");
check("cancelled -> cancelled", mapSteadfastStatus("cancelled") === "cancelled");
check("garbage -> unknown", mapSteadfastStatus("zzz") === "unknown");
check("undefined -> unknown", mapSteadfastStatus(undefined) === "unknown");

// 2) Registry + configured detection (empty env)
const reg = new CourierRegistry(loadConfig({} as NodeJS.ProcessEnv));
const list = reg.list();
check("steadfast is registered", list.some((c) => c.id === "steadfast"));
check(
  "steadfast unconfigured without env",
  list.find((c) => c.id === "steadfast")?.configured === false,
);

// 2b) Pathao registered + status normalization (different-shaped courier)
check("pathao is registered", list.some((c) => c.id === "pathao"));
check(
  "pathao unconfigured without env",
  list.find((c) => c.id === "pathao")?.configured === false,
);
check("pathao Delivered -> delivered", mapPathaoStatus("Delivered") === "delivered");
check(
  "pathao Partial_Delivery -> partial_delivered",
  mapPathaoStatus("Partial_Delivery") === "partial_delivered",
);
check("pathao In_Transit -> in_transit", mapPathaoStatus("In_Transit") === "in_transit");
check(
  "pathao Delivery_Failed -> unknown (NOT delivered)",
  mapPathaoStatus("Delivery_Failed") === "unknown",
);
check("pathao Returned -> returned", mapPathaoStatus("Returned") === "returned");
check("pathao Pending -> pending", mapPathaoStatus("Pending") === "pending");

// 3) Clean typed error when not configured (no network hit)
let threw: unknown = null;
try {
  await reg.get("steadfast").createParcel({
    courier: "steadfast",
    invoice: "smoke-1",
    recipientName: "Test",
    recipientPhone: "01700000000",
    recipientAddress: "Dhaka",
    codAmount: 0,
  });
} catch (e) {
  threw = e;
}
check(
  "unconfigured createParcel throws not_configured",
  threw instanceof CourierError && threw.code === "not_configured",
);

// 4) Configured detection with env present
const reg2 = new CourierRegistry(
  loadConfig({
    STEADFAST_API_KEY: "k",
    STEADFAST_SECRET_KEY: "s",
    PATHAO_CLIENT_ID: "id",
    PATHAO_CLIENT_SECRET: "sec",
    PATHAO_USERNAME: "u",
    PATHAO_PASSWORD: "p",
  } as NodeJS.ProcessEnv),
);
check(
  "steadfast configured when env present",
  reg2.list().find((c) => c.id === "steadfast")?.configured === true,
);
check(
  "pathao configured when env present",
  reg2.list().find((c) => c.id === "pathao")?.configured === true,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
