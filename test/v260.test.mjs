import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import axios from "axios";

// Configure test environment before importing app/modules
process.env.NODE_ENV = "test";
process.env.AURA_API_KEY = "aura_test_master_key_v260";
process.env.AURA_READONLY_KEY = "aura_ro_test_reader_v260";
process.env.AURA_WEBHOOK_SECRET = "aura_webhook_secret_test_v260";
process.env.STEADFAST_API_KEY = "sf_test_key";
process.env.STEADFAST_SECRET_KEY = "sf_test_secret";
process.env.PATHAO_CLIENT_ID = "pathao_test_id";
process.env.PATHAO_CLIENT_SECRET = "pathao_test_secret";
process.env.PATHAO_USERNAME = "merchant@example.test";
process.env.PATHAO_PASSWORD = "password_test";
process.env.REDX_API_TOKEN = "redx_test_token";
process.env.PAPERFLY_API_KEY = "pf_test_key";
process.env.PAPERFLY_USERNAME = "pf_user";
process.env.PAPERFLY_PASSWORD = "pf_pass";
process.env.GOOGLE_MAPS_API_KEY = "gmaps_test_key";

const { app } = await import("../dist/http.js");
const { clearIdempotencyStore, clearWebhookEvents } = await import("../dist/registry.js");
const { auditLogBuffer } = await import("../dist/middleware/auth.js");

let server;
let baseUrl;
let upstreamBookingCalls = 0;

// Mock all upstream axios HTTP calls so zero real carrier/Google requests are made
const originalAxiosCreate = axios.create.bind(axios);
axios.get = async (url, config) => {
  const u = String(url);
  // Google Maps Geocoding API mock
  if (u.includes("maps.googleapis.com/maps/api/geocode/json")) {
    const addr = String(config?.params?.address || "");
    if (addr.toLowerCase().includes("dhanmondi")) {
      return {
        status: 200,
        data: {
          status: "OK",
          results: [
            {
              formatted_address: "House 12, Road 5, Dhanmondi, Dhaka 1205, Bangladesh",
              place_id: "mock_place_dhanmondi",
              address_components: [
                { long_name: "Dhanmondi", types: ["sublocality_level_1", "sublocality", "political"] },
                { long_name: "Dhaka District", types: ["administrative_area_level_2", "political"] },
                { long_name: "Dhaka Division", types: ["administrative_area_level_1", "political"] },
              ],
              geometry: {
                location: { lat: 23.7461, lng: 90.3742 },
                location_type: "RANGE_INTERPOLATED",
              },
            },
          ],
        },
      };
    }
    return {
      status: 200,
      data: {
        status: "OK",
        results: [
          {
            formatted_address: addr + ", Bangladesh",
            place_id: "mock_place_generic",
            address_components: [
              { long_name: "Banani", types: ["sublocality_level_1", "political"] },
              { long_name: "Dhaka", types: ["administrative_area_level_2", "political"] },
              { long_name: "Dhaka Division", types: ["administrative_area_level_1", "political"] },
            ],
            geometry: {
              location: { lat: 23.7937, lng: 90.4066 },
              location_type: "ROOFTOP",
            },
          },
        ],
      },
    };
  }
  throw new Error(`Unexpected unmocked axios.get: ${u}`);
};

axios.post = async (url, body) => {
  const u = String(url);
  if (u.includes("routes.googleapis.com/directions/v2:computeRoutes")) {
    const dest = String(body?.destination?.address || "").toLowerCase();
    const distanceMeters = dest.includes("chattogram") || dest.includes("chittagong") ? 248000 : 6200;
    return {
      status: 200,
      data: {
        routes: [{ distanceMeters, duration: "1800s" }],
      },
    };
  }
  throw new Error(`Unexpected unmocked axios.post: ${u}`);
};

// Patch Steadfast, Pathao, RedX, and Paperfly adapters' internal HTTP clients via prototype/axios intercept
const { SteadfastAdapter } = await import("../dist/adapters/steadfast.js");
const { PathaoAdapter } = await import("../dist/adapters/pathao.js");
const { RedxAdapter } = await import("../dist/adapters/redx.js");
const { PaperflyAdapter } = await import("../dist/adapters/paperfly.js");
const { McpToolError } = await import("../dist/envelope.js");

SteadfastAdapter.prototype.trackParcel = async function (code) {
  if (code === "SF_VALID_1001") {
    return {
      success: true,
      courier: "steadfast",
      tracking_code: code,
      status: "Pending",
      updated_at: new Date().toISOString(),
      raw_response: { status: 200, delivery_status: "pending" },
    };
  }
  const axiosLikeErr = new Error("Request failed with status code 400");
  axiosLikeErr.response = { status: 404, data: { message: "Consignment not found" } };
  throw new McpToolError({
    code: "CONSIGNMENT_NOT_FOUND",
    message: `Steadfast consignment '${code}' was not found.`,
    courier: "steadfast",
    retryable: false,
  });
};

PathaoAdapter.prototype.trackParcel = async function (code) {
  if (code === "DS_VALID_2002") {
    return {
      success: true,
      courier: "pathao",
      tracking_code: code,
      status: "Picked Up",
      updated_at: new Date().toISOString(),
    };
  }
  throw new McpToolError({
    code: "CONSIGNMENT_NOT_FOUND",
    message: `Pathao consignment '${code}' was not found.`,
    courier: "pathao",
    retryable: false,
  });
};

RedxAdapter.prototype.trackParcel = async function (code) {
  throw new McpToolError({
    code: "CONSIGNMENT_NOT_FOUND",
    message: `RedX consignment '${code}' was not found.`,
    courier: "redx",
    retryable: false,
  });
};

PaperflyAdapter.prototype.trackParcel = async function (code) {
  throw new McpToolError({
    code: "CONSIGNMENT_NOT_FOUND",
    message: `Paperfly consignment '${code}' was not found.`,
    courier: "paperfly",
    retryable: false,
  });
};

SteadfastAdapter.prototype.getBalance = async function () {
  return {
    success: true,
    courier: "steadfast",
    amount_bdt: 14250,
    pending_bdt: 0,
    current_balance: 14250,
    status: "OK",
    as_of: new Date().toISOString(),
  };
};

SteadfastAdapter.prototype.createParcel = async function (req) {
  upstreamBookingCalls++;
  return {
    success: true,
    courier: "steadfast",
    tracking_code: `SF_MOCK_${req.invoice}`,
    consignment_id: 900100,
    invoice: req.invoice,
    status: "In Review",
    cod_amount: req.cod_amount,
    created_at: new Date().toISOString(),
  };
};

PathaoAdapter.prototype.createParcel = async function (req) {
  upstreamBookingCalls++;
  return {
    success: true,
    courier: "pathao",
    tracking_code: `DS_MOCK_${req.invoice}`,
    consignment_id: `DS_MOCK_${req.invoice}`,
    invoice: req.invoice,
    status: "Pending",
    cod_amount: req.cod_amount,
    created_at: new Date().toISOString(),
  };
};

SteadfastAdapter.prototype.fraudCheck = async function (phone) {
  if (phone === "01700000000") {
    return { total_parcels: 10, total_delivered: 9, total_cancelled: 1 };
  }
  return { total_parcels: 0, total_delivered: 0, total_cancelled: 0 };
};

PathaoAdapter.prototype.fraudCheck = async function (phone) {
  if (phone === "01700000000") {
    return { total_parcels: 12, total_delivered: 11, total_cancelled: 1, source: "Pathao Nationwide Customer Success DB" };
  }
  return { total_parcels: 0, total_delivered: 0, total_cancelled: 0 };
};

async function callMcpTool(toolName, args = {}, token = process.env.AURA_API_KEY) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  const body = await res.json();
  const text = body?.result?.content?.[0]?.text;
  const parsed = text ? JSON.parse(text) : body;
  return { status: res.status, rpc: body, envelope: parsed };
}

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("1. POST /mcp without Authorization returns 401 and ok:false, error.code:'UNAUTHORIZED'", async () => {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.ok(body.meta.request_id);
});

test("2. POST /webhooks/steadfast without signature returns 401", async () => {
  const res = await fetch(`${baseUrl}/webhooks/steadfast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consignment_id: "SF_VALID_1001", status: "delivered" }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("3. resolve_ndr_issue with bogus consignment_id returns ok:false, error.code:'CONSIGNMENT_NOT_FOUND', NOT fake Bengali copy", async () => {
  const { envelope } = await callMcpTool("resolve_ndr_issue", {
    consignment_id: "BOGUS_CONSIGNMENT_999999",
    courier: "steadfast",
    issue_type: "customer_phone_off",
    customer_phone: "01700000000",
  });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "CONSIGNMENT_NOT_FOUND");
  assert.equal(envelope.data, null);
  assert.equal(envelope.whatsapp_draft, undefined);
});

test("4. resolve_ndr_issue with valid consignment_id returns status:'DRAFT_GENERATED', actions_executed:[], and copy prefixed with 'প্রস্তাবিত মেসেজ:'", async () => {
  const { envelope } = await callMcpTool("resolve_ndr_issue", {
    consignment_id: "SF_VALID_1001",
    courier: "steadfast",
    issue_type: "customer_phone_off",
    customer_phone: "01700000000",
    customer_name: "টেস্ট গ্রাহক",
  });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.status, "DRAFT_GENERATED");
  assert.deepEqual(envelope.actions_executed, []);
  assert.equal(envelope.requires_manual_execution, true);
  assert.ok(envelope.whatsapp_draft.text.startsWith("প্রস্তাবিত মেসেজ:"));
  assert.ok(!JSON.stringify(envelope).includes("CUSTOMER_REENGAGED"));
});

test("5. get_balance('steadfast') returns numeric amount_bdt and status:'OK'; pathao/redx/paperfly return amount_bdt:null, status:'UNSUPPORTED_BY_PROVIDER'", async () => {
  const sf = await callMcpTool("get_balance", { courier: "steadfast" });
  assert.equal(sf.envelope.ok, true);
  assert.equal(typeof sf.envelope.amount_bdt, "number");
  assert.equal(sf.envelope.amount_bdt, 14250);
  assert.equal(sf.envelope.status, "OK");

  for (const c of ["pathao", "redx", "paperfly"]) {
    const res = await callMcpTool("get_balance", { courier: c });
    assert.equal(res.envelope.ok, true);
    assert.equal(res.envelope.amount_bdt, null);
    assert.equal(res.envelope.pending_bdt, null);
    assert.equal(res.envelope.status, "UNSUPPORTED_BY_PROVIDER");
    assert.ok(res.envelope.hint.includes("merchant portal"));
  }
});

test("6. calculate_delivery_zone_and_fee and compare_courier_rates agree on zone and sla_hours for 'Road 11, Banani, Dhaka'; Chattogram has no Dhaka-only note", async () => {
  const zoneRes = await callMcpTool("calculate_delivery_zone_and_fee", {
    recipient_address: "Road 11, Banani, Dhaka",
    weight_kg: 0.5,
  });
  const compRes = await callMcpTool("compare_courier_rates", {
    recipient_address: "Road 11, Banani, Dhaka",
    weight_kg: 0.5,
    cod_amount: 1000,
  });

  assert.equal(zoneRes.envelope.ok, true);
  assert.equal(compRes.envelope.ok, true);
  assert.equal(zoneRes.envelope.meta.source, "static_tariff");
  assert.equal(compRes.envelope.meta.source, "static_tariff");
  assert.equal(zoneRes.envelope.zone, "inside_dhaka");
  assert.equal(compRes.envelope.zone, "inside_dhaka");
  assert.deepEqual(zoneRes.envelope.sla_hours, { min: 12, max: 48 });
  assert.deepEqual(compRes.envelope.sla_hours, { min: 12, max: 48 });

  const ctgRes = await callMcpTool("compare_courier_rates", {
    recipient_address: "Agrabad, Chattogram",
    weight_kg: 1.0,
    cod_amount: 1500,
  });
  assert.equal(ctgRes.envelope.zone, "outside_dhaka");
  for (const q of ctgRes.envelope.quotes) {
    assert.ok(
      !q.coverage_notes.toLowerCase().includes("within dhaka metropolitan"),
      `Unexpected Dhaka-only note on Chattogram route for ${q.courier}: ${q.coverage_notes}`
    );
  }
});

test("7. validate_and_geocode_address with mismatched thana_input returns thana_resolved != 'TEST_FAKE_THANA_XYZ', warnings non-empty, and confidence_score <= 60 when not ROOFTOP", async () => {
  const { envelope } = await callMcpTool("validate_and_geocode_address", {
    address: "House 12, Road 5, Dhanmondi, Dhaka",
    thana: "TEST_FAKE_THANA_XYZ",
  });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.thana_input, "TEST_FAKE_THANA_XYZ");
  assert.notEqual(envelope.thana_resolved, "TEST_FAKE_THANA_XYZ");
  assert.equal(envelope.thana_resolved, "Dhanmondi");
  assert.ok(Array.isArray(envelope.warnings) && envelope.warnings.length > 0);
  assert.equal(envelope.needs_review, true);
  assert.ok(envelope.confidence_score <= 60);
});

test("8. check_fraud_risk('01000000000') returns risk_level:'INVALID_NUMBER' and delivery_success_rate:null", async () => {
  const { envelope } = await callMcpTool("check_fraud_risk", { phone: "01000000000" });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.risk_level, "INVALID_NUMBER");
  assert.equal(envelope.delivery_success_rate, null);
  assert.equal(envelope.cancellation_rate, null);
  assert.equal(envelope.sample_size, 0);
  assert.deepEqual(envelope.data_sources, ["prefix_validator"]);
});

test("9. track_parcel('DEFINITELY_NOT_REAL_999999') returns ok:false, error.code:'CONSIGNMENT_NOT_FOUND', and no 'Request failed with status code' anywhere in payload", async () => {
  const { envelope } = await callMcpTool("track_parcel", {
    tracking_code: "DEFINITELY_NOT_REAL_999999",
  });
  const serialized = JSON.stringify(envelope);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "CONSIGNMENT_NOT_FOUND");
  assert.ok(Array.isArray(envelope.couriers_checked) && envelope.couriers_checked.length > 0);
  assert.ok(!serialized.includes("Request failed with status code"));
});

test("10. create_parcel({ ..., dry_run:true }) makes zero upstream booking calls and returns would_book_with and estimated_cost_bdt", async () => {
  clearIdempotencyStore();
  const beforeCalls = upstreamBookingCalls;
  const { envelope } = await callMcpTool("create_parcel", {
    courier: "auto",
    invoice: "INV-DRY-1001",
    recipient_name: "Test Receiver",
    recipient_phone: "01700000000",
    recipient_address: "House 10, Road 4, Dhanmondi, Dhaka",
    cod_amount: 1200,
    dry_run: true,
  });
  assert.equal(upstreamBookingCalls, beforeCalls);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.status, "DRY_RUN");
  assert.ok(envelope.would_book_with);
  assert.equal(typeof envelope.estimated_cost_bdt, "number");
  assert.equal(envelope.validation.phone_ok, true);
});

test("11. GET /health unauthenticated returns only { ok, version }; with admin token returns full telemetry", async () => {
  const unauthRes = await fetch(`${baseUrl}/health`, {
    headers: { Accept: "application/json" },
  });
  assert.equal(unauthRes.status, 200);
  const unauthBody = await unauthRes.json();
  assert.deepEqual(Object.keys(unauthBody).sort(), ["ok", "version"]);
  assert.equal(unauthBody.ok, true);
  assert.equal(unauthBody.version, "2.6.0");

  const adminRes = await fetch(`${baseUrl}/health?detail=1`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${process.env.AURA_API_KEY}`,
    },
  });
  assert.equal(adminRes.status, 200);
  const adminBody = await adminRes.json();
  assert.equal(adminBody.ok, true);
  assert.equal(adminBody.version, "2.6.0");
  assert.equal(adminBody.tools_count, 12);
  assert.ok(adminBody.performance);
});

test("12. Idempotent create_parcel replay, cancel_parcel UNSUPPORTED_BY_PROVIDER, bulk_create_parcels, and authenticated get_webhook_events", async () => {
  clearIdempotencyStore();
  clearWebhookEvents();

  const beforeCalls = upstreamBookingCalls;
  const first = await callMcpTool("create_parcel", {
    courier: "steadfast",
    invoice: "INV-IDEM-2026",
    recipient_name: "Synthetic Customer",
    recipient_phone: "01700000000",
    recipient_address: "House 12, Road 5, Dhanmondi, Dhaka",
    cod_amount: 1500,
  });
  assert.equal(first.envelope.ok, true);
  assert.equal(first.envelope.idempotent_replay, false);
  assert.equal(upstreamBookingCalls, beforeCalls + 1);

  const second = await callMcpTool("create_parcel", {
    courier: "steadfast",
    invoice: "INV-IDEM-2026",
    recipient_name: "Synthetic Customer",
    recipient_phone: "01700000000",
    recipient_address: "House 12, Road 5, Dhanmondi, Dhaka",
    cod_amount: 1500,
  });
  assert.equal(second.envelope.ok, true);
  assert.equal(second.envelope.idempotent_replay, true);
  assert.equal(second.envelope.tracking_code, first.envelope.tracking_code);
  assert.equal(upstreamBookingCalls, beforeCalls + 1);

  // cancel_parcel returns UNSUPPORTED_BY_PROVIDER
  const cancelRes = await callMcpTool("cancel_parcel", {
    courier: "steadfast",
    consignment_id: first.envelope.tracking_code,
  });
  assert.equal(cancelRes.envelope.ok, false);
  assert.equal(cancelRes.envelope.error.code, "UNSUPPORTED_BY_PROVIDER");

  // Signed webhook event -> get_webhook_events
  const whPost = await fetch(`${baseUrl}/webhooks/steadfast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": process.env.AURA_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      consignment_id: "SF_VALID_1001",
      invoice: "INV-IDEM-2026",
      status: "delivered",
      notification_type: "delivery_status",
    }),
  });
  assert.equal(whPost.status, 200);

  const eventsRes = await callMcpTool("get_webhook_events", {
    consignment_id: "SF_VALID_1001",
  });
  assert.equal(eventsRes.envelope.ok, true);
  assert.equal(eventsRes.envelope.count, 1);
  assert.equal(eventsRes.envelope.events[0].status, "delivered");

  // Privacy-safe audit log check: raw phone 01700000000 never appears in auditLogBuffer
  const serializedAudit = JSON.stringify(auditLogBuffer);
  assert.ok(!serializedAudit.includes("01700000000"));
});


import { createHmac } from "node:crypto";

test("13. F01: Prefix Auth Bypass Prevention — aura_rw_forged_token returns 401", async () => {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer aura_rw_forged_token_12345678",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_couriers", arguments: {} },
    }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("14. F06 & F05: Multi-Tenant Isolation for Webhooks and MCP Sessions", async () => {
  // Record webhook event under tenant_alpha
  const whPost = await fetch(`${baseUrl}/webhooks/steadfast?tenant=tenant_alpha`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": process.env.AURA_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      consignment_id: "SF_ALPHA_999",
      status: "in_transit",
    }),
  });
  assert.equal(whPost.status, 200);

  // Query as tenant_beta -> MUST return 0 events (Zero cross-tenant leak)
  // Register tenant_beta key in auth module
  const { registerApiKey } = await import("../dist/middleware/auth.js");
  registerApiKey("token_beta_key", "tenant_beta", ["read", "write"]);
  registerApiKey("token_alpha_key", "tenant_alpha", ["read", "write"]);

  const resBeta = await callMcpTool("get_webhook_events", { consignment_id: "SF_ALPHA_999" }, "token_beta_key");
  assert.equal(resBeta.envelope.ok, true);
  assert.equal(resBeta.envelope.count, 0);

  // Query as tenant_alpha -> MUST return 1 event
  const resAlpha = await callMcpTool("get_webhook_events", { consignment_id: "SF_ALPHA_999" }, "token_alpha_key");
  assert.equal(resAlpha.envelope.ok, true);
  assert.equal(resAlpha.envelope.count, 1);
  assert.equal(resAlpha.envelope.events[0].consignment_id, "SF_ALPHA_999");
});

test("15. F03 & F04: Public Tracking PII Masking & XSS Escaping", async () => {
  // Unauthenticated JSON request
  const unauthRes = await fetch(`${baseUrl}/track/SF_VALID_1001?format=json`);
  assert.equal(unauthRes.status, 200);
  const unauthData = await unauthRes.json();
  assert.equal(unauthData.ok, true);
  // Phone must be masked
  if (unauthData.recipient_phone) {
    assert.ok(unauthData.recipient_phone.includes("****"));
  }

  // HTML XSS escaping check (URL-encoded consignment code)
  const xssCode = encodeURIComponent("<script>alert(1)</script>");
  const xssRes = await fetch(`${baseUrl}/track/${xssCode}`, { headers: { Accept: "text/html" } });
  const html = await xssRes.text();
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("16. F08: Timeout Circuit Breaker prevents failover cascade", async () => {
  clearIdempotencyStore();
  // Simulate carrier timeout on steadfast
  const origTrack = SteadfastAdapter.prototype.createParcel;
  SteadfastAdapter.prototype.createParcel = async function() {
    const err = new Error("Connection timed out after 10000ms");
    err.code = "ETIMEDOUT";
    throw err;
  };

  try {
    const res = await callMcpTool("create_parcel", {
      courier: "steadfast",
      invoice: "INV-TIMEOUT-TEST",
      recipient_name: "Timeout Customer",
      recipient_phone: "01700000000",
      recipient_address: "House 1, Road 2, Banani, Dhaka",
      cod_amount: 500,
    });
    assert.equal(res.envelope.ok, false);
    assert.equal(res.envelope.error.code, "COURIER_UPSTREAM_ERROR");
    assert.ok(res.envelope.status === "UNKNOWN_PENDING_RECONCILIATION" || res.envelope.error.message.includes("timed out"));
  } finally {
    SteadfastAdapter.prototype.createParcel = origTrack;
  }
});

test("17. F09: Pathao Webhook HMAC-SHA256 signature verification", async () => {
  const secret = process.env.PATHAO_CLIENT_SECRET;
  const payload = JSON.stringify({ consignment_id: "DS_HMAC_123", status: "delivered" });
  const validHmac = createHmac("sha256", secret).update(payload).digest("hex");

  // Valid HMAC
  const okRes = await fetch(`${baseUrl}/webhooks/pathao`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pathao-signature": validHmac,
    },
    body: payload,
  });
  assert.equal(okRes.status, 200);

  // Invalid HMAC
  const badRes = await fetch(`${baseUrl}/webhooks/pathao`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pathao-signature": "bad_invalid_hmac_signature",
    },
    body: payload,
  });
  assert.equal(badRes.status, 401);
});
