import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";

process.env.NODE_ENV = "test";
process.env.AURA_API_KEY = "aura_sec_master_key_9f8e7d6c5b4a3210fedcba987654";
process.env.AURA_ADMIN_KEY = "aura_sec_admin_key_1234567890abcdef1234567890ab";
process.env.AURA_READONLY_KEY = "aura_sec_ro_key_abcdef1234567890";
process.env.AURA_WEBHOOK_SECRET = "aura_sec_webhook_key_0123456789abcdef0123456789";
process.env.AURA_OAUTH_SECRET = "aura_sec_oauth_root_fedcba9876543210fedcba987654";
process.env.PATHAO_CLIENT_ID = "pathao_test_id";
process.env.PATHAO_CLIENT_SECRET = "pathao_super_secret_do_not_leak_9999999999";
process.env.STEADFAST_API_KEY = "sf_test_key_valid";
process.env.STEADFAST_SECRET_KEY = "sf_test_secret_valid";

const { app, clearWebhookReplayCache } = await import("../dist/http.js");
const {
  resolveAuthContext,
  validateSecurityConfig,
  registerApiKey,
  authenticateWebhook,
} = await import("../dist/middleware/auth.js");
const { validateCarrierBaseUrl } = await import("../dist/config.js");
const {
  clearIdempotencyStore,
  clearWebhookEvents,
  setRegistryDbPool,
} = await import("../dist/registry.js");
const { SteadfastAdapter } = await import("../dist/adapters/steadfast.js");
const { PathaoAdapter } = await import("../dist/adapters/pathao.js");

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  setRegistryDbPool(null);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("P0-01: Predictable hardcoded fallback keys are ALWAYS rejected & startup fails closed without strong secrets", async () => {
  // 1. Live server rejects old default master & readonly keys
  for (const leakedKey of ["aura_live_mcp_master_key_2026", "aura_ro_public_inspector_2026", "aura_webhook_secret_2026"]) {
    const res = await fetch(`${baseUrl}/admin/tokens`, {
      headers: { Authorization: `Bearer ${leakedKey}` },
    });
    assert.equal(res.status, 401, `Leaked default key ${leakedKey} must be rejected`);
  }

  // 2. Even if env vars are unset in isolated state, resolveAuthContext MUST fail closed (never authenticate defaults)
  const saved = {
    AURA_API_KEY: process.env.AURA_API_KEY,
    AURA_ADMIN_KEY: process.env.AURA_ADMIN_KEY,
    AURA_READONLY_KEY: process.env.AURA_READONLY_KEY,
    AURA_WEBHOOK_SECRET: process.env.AURA_WEBHOOK_SECRET,
    AURA_OAUTH_SECRET: process.env.AURA_OAUTH_SECRET,
  };
  try {
    delete process.env.AURA_API_KEY;
    delete process.env.AURA_ADMIN_KEY;
    delete process.env.AURA_READONLY_KEY;
    delete process.env.AURA_WEBHOOK_SECRET;
    delete process.env.AURA_OAUTH_SECRET;

    const sec = validateSecurityConfig();
    assert.equal(sec.ok, false);
    assert.ok(sec.errors.length >= 2);

    const ctxDefault = resolveAuthContext({
      headers: { authorization: "Bearer aura_live_mcp_master_key_2026" },
      query: {},
    });
    assert.equal(ctxDefault.authenticated, false);
    assert.equal(ctxDefault.isAdmin, false);
  } finally {
    Object.assign(process.env, saved);
  }

  // 3. Real production process startup MUST exit non-zero when required secrets are absent
  const child = spawnSync(process.execPath, ["dist/http.js"], {
    env: { PATH: process.env.PATH, NODE_ENV: "production", PORT: "0" },
    encoding: "utf8",
    timeout: 8000,
  });
  assert.notEqual(child.status, 0, "Production server must refuse to start without strong secrets");
  assert.ok((child.stderr || "").includes("FATAL SECURITY CONFIG"));
});

test("P0-02: Arbitrary webhook path tokens rejected (401), Pathao secret NEVER leaked, server-side tenant binding & replay blocked (409)", async () => {
  clearWebhookEvents();
  clearWebhookReplayCache();

  // 1. Arbitrary 8+ char merchant_token path -> MUST return 401 and NEVER disclose PATHAO_CLIENT_SECRET
  const attackChallenge = await fetch(`${baseUrl}/webhooks/pathao/attacker_random_token_99`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "webhook_integration" }),
  });
  assert.equal(attackChallenge.status, 401);
  assert.equal(attackChallenge.headers.get("x-pathao-merchant-webhook-integration-secret"), null);
  const attackBody = await attackChallenge.text();
  assert.ok(!attackBody.includes(process.env.PATHAO_CLIENT_SECRET));

  // 2. Even with a VALID Pathao HMAC on webhook_integration, PATHAO_CLIENT_SECRET is NEVER echoed in response headers
  const challengePayload = JSON.stringify({ event: "webhook_integration" });
  const validChallengeSig = createHmac("sha256", process.env.PATHAO_CLIENT_SECRET).update(challengePayload).digest("hex");
  const validChallenge = await fetch(`${baseUrl}/webhooks/pathao`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pathao-signature": validChallengeSig,
    },
    body: challengePayload,
  });
  assert.equal(validChallenge.status, 202);
  assert.equal(validChallenge.headers.get("x-pathao-merchant-webhook-integration-secret"), null);

  // 3. Server-side tenant binding: registered tenant key ignores attacker ?tenant=victim override
  const tenantSecret = "tenant_bound_webhook_key_998877665544";
  registerApiKey(tenantSecret, "tenant_real_owner", ["read", "write"]);
  const tenantWebhook = await fetch(`${baseUrl}/webhooks/steadfast/${tenantSecret}?tenant=victim_tenant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consignment_id: "SF_TENANT_BIND_1", status: "delivered", event_id: "evt_bind_001" }),
  });
  assert.equal(tenantWebhook.status, 200);
  const whJson = await tenantWebhook.json();
  assert.equal(whJson.tenant_scope, "tenant_real_owner");

  // 4. Replay protection: exact duplicate event_id returns 409 Conflict
  const replayRes = await fetch(`${baseUrl}/webhooks/steadfast/${tenantSecret}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consignment_id: "SF_TENANT_BIND_1", status: "delivered", event_id: "evt_bind_001" }),
  });
  assert.equal(replayRes.status, 409);

  // 5. Stale timestamp rejected (401)
  const staleRes = await fetch(`${baseUrl}/webhooks/steadfast/${tenantSecret}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-timestamp": String(Math.floor(Date.now() / 1000) - 3600),
    },
    body: JSON.stringify({ consignment_id: "SF_STALE_1", status: "delivered", event_id: "evt_stale_001" }),
  });
  assert.equal(staleRes.status, 401);

  // 6. Direct check on authenticateWebhook: tenant ID string alone in AURA_TENANT_KEYS cannot authenticate
  process.env.AURA_TENANT_KEYS = "my_tenant_name:strong_tenant_secret_key_abcdef1234";
  const fakeTid = authenticateWebhook(
    { params: { merchant_token: "my_tenant_name" }, headers: {}, query: {}, body: {} },
    "steadfast"
  );
  assert.equal(fakeTid.valid, false);
  delete process.env.AURA_TENANT_KEYS;
});

test("P0-03: Unauthenticated BYOK headers cannot bypass auth/scopes; incomplete BYOK bundle rejected (400); unauthenticated /sse returns 401", async () => {
  // 1. Synthetic BYOK header without Aura Bearer token -> 401 Unauthorized
  const unauthByok = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-steadfast-api-key": "fake_unauth_byok_key",
      "x-steadfast-secret-key": "fake_unauth_byok_secret",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "create_parcel", arguments: { courier: "steadfast", invoice: "INV-BYOK-1" } },
    }),
  });
  assert.equal(unauthByok.status, 401);

  // 2. Authenticated READ-ONLY key + BYOK headers still CANNOT invoke write tool create_parcel
  const roByok = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AURA_READONLY_KEY}`,
      "x-steadfast-api-key": "sf_byok_key_123456",
      "x-steadfast-secret-key": "sf_byok_sec_123456",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "create_parcel", arguments: { courier: "steadfast", invoice: "INV-BYOK-RO" } },
    }),
  });
  assert.equal(roByok.status, 200);
  const roRpc = await roByok.json();
  assert.equal(roRpc.result.isError, true);
  assert.ok(roRpc.result.content[0].text.includes("Insufficient scope"));

  // 3. Authenticated WRITE key + INCOMPLETE BYOK header (missing secret) -> 400 INVALID_INPUT
  const partialByok = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AURA_API_KEY}`,
      "x-steadfast-api-key": "only_api_key_no_secret",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_balance", arguments: { courier: "steadfast" } },
    }),
  });
  assert.equal(partialByok.status, 400);

  // 4. Unauthenticated GET /sse -> 401
  const unauthSse = await fetch(`${baseUrl}/sse`, { headers: { Accept: "text/event-stream" } });
  assert.equal(unauthSse.status, 401);
});

test("P1-01: SSRF Carrier Base URL Allowlist rejects private IPs, HTTP, non-443 ports, and unlisted domains", async () => {
  const maliciousUrls = [
    "http://127.0.0.1:8080",
    "http://10.0.1.1:8000",
    "http://169.254.169.254/latest/meta-data",
    "http://portal.packzy.com/api/v1",
    "https://evil.attacker.example/api",
    "https://user:pass@portal.packzy.com/api/v1",
    "https://portal.packzy.com:8443/api/v1",
  ];
  for (const bad of maliciousUrls) {
    assert.throws(() => validateCarrierBaseUrl("steadfast", bad, "https://portal.packzy.com/api/v1"));
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AURA_API_KEY}`,
        "x-steadfast-base-url": bad,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(res.status, 400, `SSRF URL ${bad} must be blocked with 400`);
  }

  // Official HTTPS allowlisted host passes
  assert.equal(
    validateCarrierBaseUrl("steadfast", "https://portal.packzy.com/api/v1/", "https://portal.packzy.com/api/v1"),
    "https://portal.packzy.com/api/v1"
  );
  assert.equal(
    validateCarrierBaseUrl("pathao", "https://courier-api-sandbox.pathao.com", "https://api-hermes.pathao.com"),
    "https://courier-api-sandbox.pathao.com"
  );
});

test("P1-02: Public tracker strips raw_response, phone, customer name, street address & COD value for non-owners", async () => {
  const origTrack = SteadfastAdapter.prototype.trackParcel;
  SteadfastAdapter.prototype.trackParcel = async function (code) {
    return {
      success: true,
      courier: "steadfast",
      tracking_code: code,
      status: "In Transit",
      updated_at: "2026-11-27T01:00:00Z",
      recipient_phone: "01799887766",
      recipient_address: "Flat 4B, House 99, Road 12, Dhanmondi, Dhaka",
      raw_response: {
        consignment: {
          recipient_name: "Private Buyer Name",
          recipient_phone: "01799887766",
          recipient_address: "Flat 4B, House 99, Road 12, Dhanmondi, Dhaka",
          cod_amount: 4850,
        },
        cod_amount: 4850,
        recipient_name: "Private Buyer Name",
      },
    };
  };

  try {
    // Unauthenticated JSON -> strictly minimal DTO
    const pubJsonRes = await fetch(`${baseUrl}/track/SF_PII_AUDIT_1?format=json`);
    assert.equal(pubJsonRes.status, 200);
    const pubJson = await pubJsonRes.json();
    const pubText = JSON.stringify(pubJson);
    assert.equal(pubJson.raw_response, undefined);
    assert.equal(pubJson.recipient_phone, undefined);
    assert.equal(pubJson.privacy_mode, "public_masked");
    assert.ok(!pubText.includes("01799887766"));
    assert.ok(!pubText.includes("Private Buyer Name"));
    assert.ok(!pubText.includes("Flat 4B"));
    assert.ok(!pubText.includes("4850"));

    // Unauthenticated HTML -> hides COD & real customer name
    const pubHtmlRes = await fetch(`${baseUrl}/track/SF_PII_AUDIT_1`, { headers: { Accept: "text/html" } });
    assert.equal(pubHtmlRes.status, 200);
    const pubHtml = await pubHtmlRes.text();
    assert.ok(!pubHtml.includes("01799887766"));
    assert.ok(!pubHtml.includes("Private Buyer Name"));
    assert.ok(!pubHtml.includes("4,850"));
    assert.ok(pubHtml.includes("Protected (Merchant Only)"));

    // Authenticated owner (master) -> retains full owner tracking details
    const ownerRes = await fetch(`${baseUrl}/track/SF_PII_AUDIT_1?format=json`, {
      headers: { Authorization: `Bearer ${process.env.AURA_API_KEY}` },
    });
    assert.equal(ownerRes.status, 200);
    const ownerJson = await ownerRes.json();
    assert.equal(ownerJson.recipient_phone, "01799887766");
    assert.ok(ownerJson.raw_response);
  } finally {
    SteadfastAdapter.prototype.trackParcel = origTrack;
  }
});

test("P1-03: Concurrent parallel booking coalesces to 1 carrier call & PostgreSQL durable store recovers across restart", async () => {
  clearIdempotencyStore();
  const origSfCreate = SteadfastAdapter.prototype.createParcel;
  let sfCalls = 0;

  SteadfastAdapter.prototype.createParcel = async function (req) {
    sfCalls++;
    await new Promise((r) => setTimeout(r, 60));
    return {
      success: true,
      courier: "steadfast",
      tracking_code: `SF-CONC-${sfCalls}`,
      consignment_id: 77000 + sfCalls,
      invoice: req.invoice,
      status: "in_review",
      cod_amount: req.cod_amount,
    };
  };

  // Mock durable PostgreSQL pool
  const dbRows = [];
  const fakePool = {
    async query(sql, params) {
      if (sql.includes("SELECT courier, tracking_code")) {
        const [tenant, invoice] = params;
        const found = dbRows.find((r) => r.tenant === tenant && r.raw?.invoice === invoice);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes("INSERT INTO courier_parcels")) {
        dbRows.push({
          tenant: params[0],
          courier: params[1],
          tracking_code: params[2],
          cod_amount: params[6],
          status: params[8],
          raw: JSON.parse(params[9]),
        });
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    },
  };
  setRegistryDbPool(fakePool);

  try {
    const callCreate = () =>
      fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AURA_API_KEY}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Math.floor(Math.random() * 1000),
          method: "tools/call",
          params: {
            name: "create_parcel",
            arguments: {
              courier: "steadfast",
              invoice: "INV-PARALLEL-2026",
              recipient_name: "Parallel Buyer",
              recipient_phone: "01711112222",
              recipient_address: "House 5, Road 2, Banani, Dhaka",
              cod_amount: 1200,
            },
          },
        }),
      }).then((r) => r.json());

    // Fire 5 concurrent identical bookings simultaneously
    const results = await Promise.all([callCreate(), callCreate(), callCreate(), callCreate(), callCreate()]);
    assert.equal(sfCalls, 1, "5 concurrent bookings for same invoice MUST trigger strictly 1 upstream call");
    const codes = results.map((r) => JSON.parse(r.result.content[0].text).tracking_code);
    assert.ok(codes.every((c) => c === "SF-CONC-1"));

    // Simulate process restart by wiping RAM idempotency store -> PostgreSQL ledger must prevent duplicate!
    clearIdempotencyStore();
    const afterRestart = await callCreate();
    const afterEnv = JSON.parse(afterRestart.result.content[0].text);
    assert.equal(sfCalls, 1, "Post-restart replay must recover from PostgreSQL without calling courier again");
    assert.equal(afterEnv.tracking_code, "SF-CONC-1");
    assert.equal(afterEnv.idempotent_replay, true);
  } finally {
    SteadfastAdapter.prototype.createParcel = origSfCreate;
    setRegistryDbPool(null);
  }
});

test("P1-04: Ambiguous non-timeout carrier failure (HTTP 502 or malformed 2xx) halts cascade without calling 2nd courier", async () => {
  clearIdempotencyStore();
  const origSfCreate = SteadfastAdapter.prototype.createParcel;
  const origPathaoCreate = PathaoAdapter.prototype.createParcel;
  let sfCalls = 0;
  let pathaoCalls = 0;

  // Case A: Dhaka 'auto' picks Pathao first -> Pathao returns non-timeout HTTP 502 -> Steadfast MUST NOT be called
  SteadfastAdapter.prototype.createParcel = async function () {
    sfCalls++;
    return { success: true, courier: "steadfast", tracking_code: "SF-DUP-BAD", status: "in_review" };
  };
  PathaoAdapter.prototype.createParcel = async function () {
    pathaoCalls++;
    const err = new Error("Bad Gateway");
    err.response = { status: 502, data: "<html>502</html>" };
    throw err;
  };

  try {
    const res502 = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AURA_API_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "create_parcel",
          arguments: {
            courier: "auto",
            priority: "fastest",
            invoice: "INV-AMBIGUOUS-502",
            recipient_name: "Ambiguous Buyer",
            recipient_phone: "01711113333",
            recipient_address: "House 8, Road 4, Uttara, Dhaka",
            cod_amount: 950,
          },
        },
      }),
    }).then((r) => r.json());

    const env502 = JSON.parse(res502.result.content[0].text);
    assert.equal(env502.ok, false);
    assert.equal(env502.status, "UNKNOWN_PENDING_RECONCILIATION");
    assert.equal(sfCalls, 0, "2nd courier (Steadfast) MUST NOT be called after ambiguous Pathao HTTP 502");

    // Blind immediate retry of the same unresolved invoice also stays halted without touching either carrier
    const prevPathaoCalls = pathaoCalls;
    const retryRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AURA_API_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "create_parcel",
          arguments: {
            courier: "auto",
            priority: "fastest",
            invoice: "INV-AMBIGUOUS-502",
            recipient_name: "Ambiguous Buyer",
            recipient_phone: "01711113333",
            recipient_address: "House 8, Road 4, Uttara, Dhaka",
            cod_amount: 950,
          },
        },
      }),
    }).then((r) => r.json());
    const retryEnv = JSON.parse(retryRes.result.content[0].text);
    assert.equal(retryEnv.ok, false);
    assert.equal(retryEnv.status, "UNKNOWN_PENDING_RECONCILIATION");
    assert.equal(sfCalls, 0);
    assert.equal(pathaoCalls, prevPathaoCalls);

    // Case B: Malformed 2xx response missing tracking_code/consignment_id -> halts cascade without calling 2nd courier
    PathaoAdapter.prototype.createParcel = async function () {
      pathaoCalls++;
      return { success: true, courier: "pathao", status: "accepted_no_id" };
    };
    const resMalformed = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AURA_API_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "create_parcel",
          arguments: {
            courier: "auto",
            priority: "fastest",
            invoice: "INV-AMBIGUOUS-MALFORMED",
            recipient_name: "Ambiguous Buyer 2",
            recipient_phone: "01711114444",
            recipient_address: "House 9, Road 4, Uttara, Dhaka",
            cod_amount: 1100,
          },
        },
      }),
    }).then((r) => r.json());
    const envMal = JSON.parse(resMalformed.result.content[0].text);
    assert.equal(envMal.ok, false);
    assert.equal(envMal.status, "UNKNOWN_PENDING_RECONCILIATION");
    assert.equal(sfCalls, 0, "2nd courier MUST NOT be called after malformed 2xx response");
  } finally {
    SteadfastAdapter.prototype.createParcel = origSfCreate;
    PathaoAdapter.prototype.createParcel = origPathaoCreate;
  }
});
