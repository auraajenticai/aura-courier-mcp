import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.AURA_API_KEY = "aura_test_master_key_oauth21";
process.env.AURA_READONLY_KEY = "aura_ro_test_reader_oauth21";
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

test("OAuth 1: 401 on unauthenticated POST /mcp (initialize & tools/call) and GET /mcp includes RFC 9728 WWW-Authenticate header", async () => {
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
      client_name: "Google Gemini MCP",
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

test("OAuth 4: End-to-End Gemini PKCE S256 flow -> OAuth Bearer /mcp -> Non-Rotating Refresh -> Static Dual-Auth -> Revocation", async () => {
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

  // Step 4a: GET /oauth/authorize consent screen
  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read write");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const consentRes = await fetch(authUrl.toString());
  assert.equal(consentRes.status, 200);
  const consentHtml = await consentRes.text();
  assert.ok(consentHtml.includes("Google Gemini"));
  assert.ok(consentHtml.includes("oauth-redirect.googleusercontent.com"));
  const csrfToken = extractHiddenInput(consentHtml, "csrf_token");
  assert.ok(csrfToken.length > 10);

  // Step 4b: Deny redirects with error=access_denied
  const denyForm = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "read write",
    code_challenge: challenge,
    code_challenge_method: "S256",
    csrf_token: csrfToken,
    decision: "deny",
  });
  const denyRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: denyForm.toString(),
    redirect: "manual",
  });
  assert.equal(denyRes.status, 302);
  const denyLoc = new URL(denyRes.headers.get("location"));
  assert.equal(denyLoc.searchParams.get("error"), "access_denied");
  assert.equal(denyLoc.searchParams.get("state"), state);

  // Step 4c: Invalid API key stays on consent form with error message
  const badKeyForm = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "read write",
    code_challenge: challenge,
    code_challenge_method: "S256",
    csrf_token: csrfToken,
    decision: "approve",
    api_key: "totally_wrong_key_123",
  });
  const badKeyRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: badKeyForm.toString(),
    redirect: "manual",
  });
  assert.equal(badKeyRes.status, 200);
  const badKeyHtml = await badKeyRes.text();
  assert.ok(badKeyHtml.includes("Invalid API Key"));

  // Step 4d: Valid Master Key redirects 302 with single-use authorization code
  const okForm = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "read write",
    code_challenge: challenge,
    code_challenge_method: "S256",
    csrf_token: csrfToken,
    decision: "approve",
    api_key: process.env.AURA_API_KEY,
  });
  const approveRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: okForm.toString(),
    redirect: "manual",
  });
  assert.equal(approveRes.status, 302);
  const cbUrl = new URL(approveRes.headers.get("location"));
  assert.equal(cbUrl.origin + cbUrl.pathname, redirectUri);
  assert.equal(cbUrl.searchParams.get("state"), state);
  const authCode = cbUrl.searchParams.get("code");
  assert.ok(authCode && authCode.split(".").length === 3);

  // Step 4e: Wrong PKCE code_verifier is rejected
  const wrongPkceRes = await fetch(`${baseUrl}/oauth/token`, {
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
  assert.equal(wrongPkceRes.status, 400);
  assert.equal((await wrongPkceRes.json()).error, "invalid_grant");

  // Step 4f: Correct PKCE code_verifier issues access_token + refresh_token
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
  assert.equal(tokens.expires_in, 3600);
  assert.ok(tokens.access_token && tokens.access_token.startsWith("eyJ"));
  assert.ok(tokens.refresh_token && tokens.refresh_token.startsWith("eyJ"));
  assert.equal(tokens.scope, "read write");

  // Step 4g: Authorization code replay is rejected
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
  assert.equal((await replayRes.json()).error, "invalid_grant");

  // Step 4h: Call /mcp initialize & tools/call with OAuth Bearer token
  const mcpInit = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Google Gemini", version: "1.0" } },
    }),
  });
  assert.equal(mcpInit.status, 200);
  assert.ok(mcpInit.headers.get("mcp-session-id"));

  const mcpCall = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "get_balance", arguments: { courier: "steadfast" } },
    }),
  });
  assert.equal(mcpCall.status, 200);
  const mcpBody = await mcpCall.json();
  assert.equal(mcpBody.result.isError, false);
  const env = JSON.parse(mcpBody.result.content[0].text);
  assert.equal(env.data.amount_bdt, 14250);

  // Step 4i: Refresh token returns fresh access_token AND keeps refresh_token NON-ROTATING for Gemini
  const refreshRes = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    }).toString(),
  });
  assert.equal(refreshRes.status, 200);
  const refreshed = await refreshRes.json();
  assert.ok(refreshed.access_token && refreshed.access_token !== tokens.access_token);
  assert.equal(refreshed.refresh_token, tokens.refresh_token);

  // Step 4j: Existing static Bearer API Key still works identically (Dual-Auth)
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

  // Step 4k: Revoke OAuth access_token -> subsequent /mcp returns 401 with error="invalid_token"
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

test("OAuth 5: Read-Only key authorization strictly limits OAuth JWT to read scope", async () => {
  const redirectUri = "https://oauth-redirect.googleusercontent.com/r/gemini-ro-check";
  const { verifier, challenge } = makePkcePair();

  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", "gemini-ro-client");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read write");
  authUrl.searchParams.set("state", "st_ro");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const consentHtml = await (await fetch(authUrl.toString())).text();
  const csrfToken = extractHiddenInput(consentHtml, "csrf_token");

  const approveRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "gemini-ro-client",
      redirect_uri: redirectUri,
      state: "st_ro",
      scope: "read write",
      code_challenge: challenge,
      code_challenge_method: "S256",
      csrf_token: csrfToken,
      decision: "approve",
      api_key: process.env.AURA_READONLY_KEY,
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
      client_id: "gemini-ro-client",
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
