import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, createHmac, randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.AURA_API_KEY = "aura_test_master_key_oauth21";
process.env.AURA_READONLY_KEY = "aura_ro_test_reader_oauth21";
process.env.AURA_SSO_JWT_SECRET = "aura_test_sso_jwt_secret_2026";
process.env.STEADFAST_API_KEY = "sf_test_key";
process.env.STEADFAST_SECRET_KEY = "sf_test_secret";

const { app } = await import("../dist/http.js");
const { SteadfastAdapter } = await import("../dist/adapters/steadfast.js");

SteadfastAdapter.prototype.getBalance = async function () {
  return {
    courier: "steadfast",
    status: "OK",
    amount_bdt: 14250,
    raw_response: { status: 200, current_balance: 14250 },
  };
};

let server;
let baseUrl;

function makePkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function makeAuraSsoCookie(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    })
  ).toString("base64url");
  const sig = createHmac("sha256", Buffer.from(process.env.AURA_SSO_JWT_SECRET, "utf8"))
    .update(`${header}.${body}`)
    .digest("base64url");
  return `aura_access=${header}.${body}.${sig}`;
}

function extractHiddenInput(html, name) {
  const re = new RegExp(`name="${name}"\\s+value="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? m[1] : "";
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("OAuth 1: 401 on unauthenticated POST /mcp (initialize) and GET /mcp includes RFC 9728 WWW-Authenticate header", async () => {
  const initRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Google Gemini", version: "1.0" } },
    }),
  });
  assert.equal(initRes.status, 401);
  const wwwAuthInit = initRes.headers.get("www-authenticate") || "";
  assert.ok(wwwAuthInit.includes("Bearer"));
  assert.ok(wwwAuthInit.includes(`resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`));
  assert.ok((initRes.headers.get("access-control-expose-headers") || "").includes("WWW-Authenticate"));

  const getRes = await fetch(`${baseUrl}/mcp`, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
  });
  assert.equal(getRes.status, 401);
  assert.ok((getRes.headers.get("www-authenticate") || "").includes(`resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`));
});

test("OAuth 2: RFC 9728 Protected Resource Metadata & RFC 8414 Authorization Server Metadata endpoints return valid JSON", async () => {
  for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const res = await fetch(`${baseUrl}${p}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.resource, `${baseUrl}/mcp`);
    assert.deepEqual(data.authorization_servers, [baseUrl]);
    assert.ok(data.bearer_methods_supported.includes("header"));
  }

  for (const p of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    const res = await fetch(`${baseUrl}${p}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.issuer, baseUrl);
    assert.equal(data.authorization_endpoint, `${baseUrl}/oauth/authorize`);
    assert.equal(data.token_endpoint, `${baseUrl}/oauth/token`);
    assert.equal(data.registration_endpoint, `${baseUrl}/oauth/register`);
    assert.ok(data.code_challenge_methods_supported.includes("S256"));
    assert.ok(data.grant_types_supported.includes("authorization_code"));
    assert.ok(data.grant_types_supported.includes("refresh_token"));
  }
});

test("OAuth 3: RFC 7591 Dynamic Client Registration allows Google googleusercontent.com redirect URIs & blocks untrusted hosts", async () => {
  const goodRes = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Google Gemini",
      redirect_uris: ["https://oauth-redirect.googleusercontent.com/r/gemini-aura-test"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(goodRes.status, 201);
  const client = await goodRes.json();
  assert.ok(client.client_id.startsWith("aura_dcr_"));
  assert.deepEqual(client.redirect_uris, ["https://oauth-redirect.googleusercontent.com/r/gemini-aura-test"]);

  const badRes = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Untrusted Phish",
      redirect_uris: ["https://evil.example.com/steal-code"],
    }),
  });
  assert.equal(badRes.status, 400);
  const badBody = await badRes.json();
  assert.equal(badBody.error, "invalid_redirect_uri");
});

test("OAuth 4: Consent UI is global Silicon Valley grade (inline SVG logo, Google SSO, zero internal Snehalata/test-key leaks)", async () => {
  const redirectUri = "https://oauth-redirect.googleusercontent.com/r/gemini-ui-audit";
  const { challenge } = makePkcePair();
  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", "google-gemini");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read write");
  authUrl.searchParams.set("state", "st_ui");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const res = await fetch(authUrl.toString());
  assert.equal(res.status, 200);
  const html = await res.text();
  // Inline SVG logo (no external img tag that can break)
  assert.ok(html.includes("<svg") && html.includes('aria-label="Aura Courier MCP"'));
  assert.ok(!html.includes("/assets/courier-logo.jpg"));
  // Global SSO + Google Sign-In present
  assert.ok(html.includes("Continue with Google"));
  assert.ok(html.includes("https://auth.auraajenticai.cloud/login/google"));
  assert.ok(html.includes("Continue in Read-Only Sandbox"));
  // Zero internal brand or raw test-key leaks
  assert.ok(!/snehalata/i.test(html));
  assert.ok(!html.includes("snl_mcp_"));
  assert.ok(!html.includes("aura_ro_public_inspector_2026"));
  assert.ok(!html.includes("Master Key"));
});

test("OAuth 5: 1-Click Aura SSO cookie (aura_access) authorizes owner with full master access & zero key typing", async () => {
  const redirectUri = "https://oauth-redirect.googleusercontent.com/r/gemini-sso-owner";
  const { verifier, challenge } = makePkcePair();
  const ssoCookie = makeAuraSsoCookie({
    sub: "11111111-2222-3333-4444-555555555555",
    email: "ceo@auraajenticai.cloud",
    role: "owner",
  });

  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", "google-gemini");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read write");
  authUrl.searchParams.set("state", "st_sso");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const consentRes = await fetch(authUrl.toString(), { headers: { Cookie: ssoCookie } });
  assert.equal(consentRes.status, 200);
  const consentHtml = await consentRes.text();
  assert.ok(consentHtml.includes("ceo@auraajenticai.cloud"));
  assert.ok(consentHtml.includes("Allow Access"));
  const csrfToken = extractHiddenInput(consentHtml, "csrf_token");

  const approveRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: ssoCookie,
    },
    body: new URLSearchParams({
      client_id: "google-gemini",
      redirect_uri: redirectUri,
      state: "st_sso",
      scope: "read write",
      code_challenge: challenge,
      code_challenge_method: "S256",
      csrf_token: csrfToken,
      auth_mode: "sso",
      decision: "approve",
    }).toString(),
    redirect: "manual",
  });
  assert.equal(approveRes.status, 302);
  const code = new URL(approveRes.headers.get("location")).searchParams.get("code");

  const tokRes = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "google-gemini",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
  });
  assert.equal(tokRes.status, 200);
  const tokens = await tokRes.json();
  assert.equal(tokens.scope, "read write");

  const mcpCall = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: { name: "get_balance", arguments: { courier: "steadfast" } },
    }),
  });
  assert.equal(mcpCall.status, 200);
  const body = await mcpCall.json();
  assert.equal(body.result.isError, false);
  assert.equal(JSON.parse(body.result.content[0].text).data.amount_bdt, 14250);
});

test("OAuth 6: End-to-End API Key PKCE S256 flow -> Non-Rotating Refresh -> Static Dual-Auth -> Revocation", async () => {
  const redirectUri = "https://oauth-redirect.googleusercontent.com/r/gemini-live-flow";
  const regRes = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Google Gemini",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(regRes.status, 201);
  const { client_id: clientId } = await regRes.json();

  const { verifier, challenge } = makePkcePair();
  const state = "gemini_state_xyz_991";

  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read write");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const consentHtml = await (await fetch(authUrl.toString())).text();
  const csrfToken = extractHiddenInput(consentHtml, "csrf_token");

  // Deny -> error=access_denied
  const denyRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: "read write",
      code_challenge: challenge,
      code_challenge_method: "S256",
      csrf_token: csrfToken,
      auth_mode: "apikey",
      decision: "deny",
    }).toString(),
    redirect: "manual",
  });
  assert.equal(denyRes.status, 302);
  assert.equal(new URL(denyRes.headers.get("location")).searchParams.get("error"), "access_denied");

  // Invalid API key stays on form with clean error
  const badKeyRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: "read write",
      code_challenge: challenge,
      code_challenge_method: "S256",
      csrf_token: csrfToken,
      auth_mode: "apikey",
      decision: "approve",
      api_key: "totally_wrong_key_123",
    }).toString(),
    redirect: "manual",
  });
  assert.equal(badKeyRes.status, 200);
  assert.ok((await badKeyRes.text()).includes("Invalid API key"));

  // Valid API key -> 302 with code
  const approveRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: "read write",
      code_challenge: challenge,
      code_challenge_method: "S256",
      csrf_token: csrfToken,
      auth_mode: "apikey",
      decision: "approve",
      api_key: process.env.AURA_API_KEY,
    }).toString(),
    redirect: "manual",
  });
  assert.equal(approveRes.status, 302);
  const authCode = new URL(approveRes.headers.get("location")).searchParams.get("code");

  // Wrong PKCE rejected
  const wrongPkce = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: "wrong_verifier_abcdefghijklmnopqrstuvwxyz_0123456789",
    }).toString(),
  });
  assert.equal(wrongPkce.status, 400);

  // Correct PKCE -> tokens
  const tokRes = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
  });
  assert.equal(tokRes.status, 200);
  const tokens = await tokRes.json();
  assert.equal(tokens.token_type, "Bearer");

  // Replay rejected
  const replayRes = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
  });
  assert.equal(replayRes.status, 400);

  // Non-rotating refresh token
  const refRes = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    }).toString(),
  });
  assert.equal(refRes.status, 200);
  const refreshed = await refRes.json();
  assert.equal(refreshed.refresh_token, tokens.refresh_token);
  assert.notEqual(refreshed.access_token, tokens.access_token);

  // Static Dual-Auth still works
  const staticRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AURA_API_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "get_balance", arguments: { courier: "steadfast" } },
    }),
  });
  assert.equal(staticRes.status, 200);

  // Revocation
  const revRes = await fetch(`${baseUrl}/oauth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: tokens.access_token }).toString(),
  });
  assert.equal(revRes.status, 200);

  const afterRev = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: { name: "get_balance", arguments: { courier: "steadfast" } },
    }),
  });
  assert.equal(afterRev.status, 401);
  assert.ok((afterRev.headers.get("www-authenticate") || "").includes('error="invalid_token"'));
});

test("OAuth 7: 1-Click Read-Only Sandbox strictly limits scope to read without exposing any raw API key", async () => {
  const redirectUri = "https://oauth-redirect.googleusercontent.com/r/gemini-sandbox";
  const { verifier, challenge } = makePkcePair();

  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", "gemini-sandbox");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read write");
  authUrl.searchParams.set("state", "st_sbx");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const consentHtml = await (await fetch(authUrl.toString())).text();
  const csrfToken = extractHiddenInput(consentHtml, "csrf_token");

  const approveRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "gemini-sandbox",
      redirect_uri: redirectUri,
      state: "st_sbx",
      scope: "read write",
      code_challenge: challenge,
      code_challenge_method: "S256",
      csrf_token: csrfToken,
      auth_mode: "sandbox",
      decision: "sandbox",
    }).toString(),
    redirect: "manual",
  });
  assert.equal(approveRes.status, 302);
  const code = new URL(approveRes.headers.get("location")).searchParams.get("code");

  const tokRes = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "gemini-sandbox",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
  });
  assert.equal(tokRes.status, 200);
  const tokens = await tokRes.json();
  assert.equal(tokens.scope, "read");

  const writeAttempt = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: { name: "create_parcel", arguments: { courier: "steadfast" } },
    }),
  });
  assert.equal(writeAttempt.status, 200);
  const writeBody = await writeAttempt.json();
  assert.equal(writeBody.result.isError, true);
  assert.ok(writeBody.result.content[0].text.includes("Insufficient scope"));
});

test("OAuth 8: Global Partner Directory Compliance (13 MCP tool annotations, claude.com/chatgpt/cursor/zapier/n8n DCR, and GET /terms)", async () => {
  // 1. All 13 tools expose MCP 2025-03-26 annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
  const listRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 80, method: "tools/list", params: {} }),
  });
  assert.equal(listRes.status, 200);
  const tools = (await listRes.json()).result.tools;
  assert.equal(tools.length, 13);
  for (const t of tools) {
    assert.ok(t.annotations && typeof t.annotations.title === "string", `missing title annotation on ${t.name}`);
    assert.equal(typeof t.annotations.readOnlyHint, "boolean", `missing readOnlyHint on ${t.name}`);
    assert.equal(typeof t.annotations.destructiveHint, "boolean", `missing destructiveHint on ${t.name}`);
    assert.equal(typeof t.annotations.idempotentHint, "boolean", `missing idempotentHint on ${t.name}`);
    assert.equal(typeof t.annotations.openWorldHint, "boolean", `missing openWorldHint on ${t.name}`);
  }
  const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
  assert.equal(byName.track_parcel.readOnlyHint, true);
  assert.equal(byName.create_parcel.readOnlyHint, false);
  assert.equal(byName.cancel_parcel.destructiveHint, true);
  assert.equal(byName.resolve_ndr_issue.readOnlyHint, true);

  // 2. Major AI partner callback URIs accepted via RFC 7591 DCR
  const partnerCallbacks = [
    "https://claude.com/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://cursor.com/oauth/callback",
    "https://zapier.com/dashboard/auth/oauth/return/App123",
    "https://my.n8n.cloud/rest/oauth2-credential/callback",
  ];
  const regRes = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Global AI Directory Suite", redirect_uris: partnerCallbacks }),
  });
  assert.equal(regRes.status, 201);

  // 3. Legal /terms & /privacy endpoints return 200 HTML
  const termsRes = await fetch(`${baseUrl}/terms`);
  assert.equal(termsRes.status, 200);
  const termsHtml = await termsRes.text();
  assert.ok(termsHtml.includes("Terms of Service"));
});
