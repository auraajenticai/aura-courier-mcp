import type { Express, Request, Response } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveAuthContextAsync, type AuthScope } from "./auth.js";

const ACCESS_TOKEN_TTL_SEC = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SEC = 180 * 24 * 3600; // 180 days (non-rotating for Gemini stability)
const AUTH_CODE_TTL_SEC = 300; // 5 minutes
const CSRF_TTL_SEC = 900; // 15 minutes
const VALID_SCOPES: AuthScope[] = ["read", "write"];

// In-memory replay & revocation guards (with periodic TTL pruning)
const usedAuthCodes = new Map<string, number>(); // jti -> expiresAtMs
const revokedTokenIds = new Map<string, number>(); // jti -> expiresAtMs

setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of usedAuthCodes.entries()) {
    if (now > exp) usedAuthCodes.delete(k);
  }
  for (const [k, exp] of revokedTokenIds.entries()) {
    if (now > exp) revokedTokenIds.delete(k);
  }
}, 5 * 60 * 1000).unref();

export interface OAuthAccessClaims {
  iss: string;
  aud: string;
  sub: string;
  adm: boolean;
  scp: AuthScope[];
  cid: string;
  typ: "at";
  iat: number;
  exp: number;
  jti: string;
}

interface OAuthRefreshClaims {
  iss: string;
  aud: string;
  sub: string;
  adm: boolean;
  scp: AuthScope[];
  cid: string;
  typ: "rt";
  iat: number;
  exp: number;
  jti: string;
}

interface OAuthCodeClaims {
  cid: string;
  ru: string;
  cc: string;
  ccm: "S256";
  scp: AuthScope[];
  sub: string;
  adm: boolean;
  res: string;
  typ: "code";
  iat: number;
  exp: number;
  jti: string;
}

interface DcrClientPayload {
  n: string;
  r: string[];
  m: "none" | "client_secret_post" | "client_secret_basic";
  iat: number;
}

function getRootSecret(): string {
  return (
    process.env.AURA_OAUTH_SECRET ||
    process.env.AURA_API_KEY ||
    process.env.COURIER_AUTH_TOKEN ||
    "aura_live_mcp_master_key_2026"
  );
}

function deriveKey(purpose: string): Buffer {
  return createHash("sha256")
    .update(`aura-courier-mcp-oauth-v1:${purpose}:${getRootSecret()}`)
    .digest();
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function signJwt(payload: Record<string, any>, purpose: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${body}`;
  const sig = createHmac("sha256", deriveKey(purpose)).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

function verifyJwt<T extends { exp?: number; jti?: string; typ?: string }>(
  token: string,
  purpose: string,
  expectedTyp: string
): T | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;
  if (!headerB64 || !bodyB64 || !sigB64) return null;

  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    if (header?.alg !== "HS256") return null;

    const expectedSig = createHmac("sha256", deriveKey(purpose))
      .update(`${headerB64}.${bodyB64}`)
      .digest("base64url");
    if (!safeEqualStr(sigB64, expectedSig)) return null;

    const payload = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8")) as T;
    if (!payload || payload.typ !== expectedTyp) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;

    if (payload.jti && revokedTokenIds.has(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyOAuthAccessToken(token: string): OAuthAccessClaims | null {
  return verifyJwt<OAuthAccessClaims>(token, "access", "at");
}

function verifyOAuthRefreshToken(token: string): OAuthRefreshClaims | null {
  return verifyJwt<OAuthRefreshClaims>(token, "refresh", "rt");
}

export function getPublicOrigin(req: Request): string {
  if (process.env.NODE_ENV !== "test" && process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const fwdHost = req.headers["x-forwarded-host"];
  const rawHost =
    (Array.isArray(fwdHost) ? fwdHost[0] : fwdHost) ||
    req.headers.host ||
    "courier.auraajenticai.cloud";
  const host = String(rawHost).split(",")[0].trim();

  const fwdProto = req.headers["x-forwarded-proto"];
  let proto = (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto) || req.protocol || "https";
  proto = String(proto).split(",")[0].trim().toLowerCase();

  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  if (!isLocal && proto === "http") {
    proto = "https";
  }
  return `${proto}://${host}`;
}

export function buildWwwAuthenticateHeader(req: Request, invalidToken = false): string {
  const origin = getPublicOrigin(req);
  const metaUrl = `${origin}/.well-known/oauth-protected-resource`;
  if (invalidToken) {
    return `Bearer realm="Aura Courier MCP", error="invalid_token", error_description="The access token is invalid or expired.", resource_metadata="${metaUrl}", scope="read write"`;
  }
  return `Bearer realm="Aura Courier MCP", resource_metadata="${metaUrl}", scope="read write"`;
}

export function isAllowedRedirectUri(uri: string): boolean {
  if (!uri || typeof uri !== "string" || uri.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.hash || parsed.username || parsed.password) return false;

  const proto = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();

  // Desktop IDE & native MCP app custom URI schemes
  if (
    proto === "cursor:" ||
    proto === "vscode:" ||
    proto === "vscode-insiders:" ||
    proto === "windsurf:" ||
    proto === "antigravity:" ||
    proto === "claude:" ||
    proto === "cline:"
  ) {
    return true;
  }

  // RFC 8252 loopback redirect URIs for local CLIs & MCP Inspector
  if (
    (proto === "http:" || proto === "https:") &&
    (host === "localhost" || host === "127.0.0.1" || host === "[::1]")
  ) {
    return true;
  }

  if (proto !== "https:") return false;

  const trustedHostPatterns = [
    // Google / Gemini / AI Studio / Antigravity
    /^(?:.+\.)?googleusercontent\.com$/,
    /^(?:.+\.)?google\.com$/,
    /^(?:.+\.)?googleapis\.com$/,
    /^(?:.+\.)?google\.dev$/,
    /^(?:.+\.)?antigravity\.google$/,
    // Claude / Anthropic
    /^(?:.+\.)?claude\.ai$/,
    /^(?:.+\.)?anthropic\.com$/,
    // OpenAI / ChatGPT
    /^(?:.+\.)?chatgpt\.com$/,
    /^(?:.+\.)?openai\.com$/,
    // Aura & Snehalata Ecosystem
    /^(?:.+\.)?auraajenticai\.cloud$/,
    /^(?:.+\.)?snehalata\.com$/,
    // MCP Directories & API Clients
    /^(?:.+\.)?glama\.ai$/,
    /^(?:.+\.)?smithery\.ai$/,
    /^(?:.+\.)?modelcontextprotocol\.io$/,
    /^(?:.+\.)?postman\.com$/,
    /^(?:.+\.)?pstmn\.io$/,
    /^(?:.+\.)?insomnia\.rest$/,
  ];

  return trustedHostPatterns.some((re) => re.test(host));
}

function encodeDcrClientId(payload: DcrClientPayload): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", deriveKey("client")).update(b64).digest("base64url").slice(0, 22);
  return `aura_dcr_${b64}.${sig}`;
}

function decodeDcrClientId(clientId: string): DcrClientPayload | null {
  if (!clientId || !clientId.startsWith("aura_dcr_")) return null;
  const raw = clientId.slice("aura_dcr_".length);
  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx <= 0) return null;
  const b64 = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const expected = createHmac("sha256", deriveKey("client")).update(b64).digest("base64url").slice(0, 22);
  if (!safeEqualStr(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as DcrClientPayload;
    if (!parsed || !Array.isArray(parsed.r) || parsed.r.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function deriveDcrClientSecret(clientId: string): string {
  const digest = createHmac("sha256", deriveKey("client_secret")).update(clientId).digest("base64url");
  return `aura_cs_${digest.slice(0, 40)}`;
}

function normalizeScopes(rawScope: string | undefined, allowedScopes: AuthScope[]): AuthScope[] {
  const allowed = allowedScopes.length ? allowedScopes : (["read"] as AuthScope[]);
  if (!rawScope || !rawScope.trim()) {
    return [...allowed];
  }
  const requested = rawScope
    .trim()
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase().replace(/^mcp:/, ""))
    .filter((s): s is AuthScope => VALID_SCOPES.includes(s as AuthScope));

  if (requested.length === 0) {
    return [...allowed];
  }
  const granted = requested.filter((s) => allowed.includes(s));
  return granted.length > 0 ? Array.from(new Set(granted)) : [allowed[0]];
}

function verifyPkceS256(codeVerifier: string, expectedChallenge: string): boolean {
  if (!codeVerifier || typeof codeVerifier !== "string" || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return safeEqualStr(computed, expectedChallenge);
}

function signCsrfToken(fields: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const exp = Math.floor(Date.now() / 1000) + CSRF_TTL_SEC;
  const data = `${fields.clientId}|${fields.redirectUri}|${fields.codeChallenge}|${fields.state}|${exp}`;
  const sig = createHmac("sha256", deriveKey("csrf")).update(data).digest("base64url").slice(0, 24);
  return `${exp}.${sig}`;
}

function verifyCsrfToken(
  token: string,
  fields: { clientId: string; redirectUri: string; codeChallenge: string; state: string }
): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const data = `${fields.clientId}|${fields.redirectUri}|${fields.codeChallenge}|${fields.state}|${exp}`;
  const expected = createHmac("sha256", deriveKey("csrf")).update(data).digest("base64url").slice(0, 24);
  return safeEqualStr(parts[1], expected);
}

function escapeHtml(str: any): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function redirectWithOAuthError(
  res: Response,
  redirectUri: string,
  error: string,
  description: string,
  state?: string
): void {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (description) u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  res.redirect(302, u.toString());
}

function extractClientCredentials(req: Request): { clientId?: string; clientSecret?: string } {
  const body = (req.body || {}) as Record<string, any>;
  let clientId = typeof body.client_id === "string" ? body.client_id.trim() : undefined;
  let clientSecret = typeof body.client_secret === "string" ? body.client_secret.trim() : undefined;

  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (typeof authHeader === "string" && authHeader.trim().toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authHeader.trim().slice(6).trim(), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep >= 0) {
        const rawId = decoded.slice(0, sep);
        const rawSec = decoded.slice(sep + 1);
        try {
          clientId = decodeURIComponent(rawId);
        } catch {
          clientId = rawId;
        }
        try {
          clientSecret = decodeURIComponent(rawSec);
        } catch {
          clientSecret = rawSec;
        }
      }
    } catch {
      // Ignore malformed Basic header; fall back to body params
    }
  }

  return { clientId, clientSecret };
}

function renderConsentPage(opts: {
  origin: string;
  clientName: string;
  redirectHost: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  csrfToken: string;
  errorMessage?: string;
}): string {
  const scopes = opts.scope
    ? opts.scope.split(/[\s,]+/).filter(Boolean)
    : ["read", "write"];
  const hasWrite = scopes.some((s) => s.toLowerCase().includes("write"));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize ${escapeHtml(opts.clientName)} — Aura Courier MCP</title>
  <link rel="icon" type="image/jpeg" href="/assets/courier-logo.jpg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #060913;
      --card: rgba(13, 20, 38, 0.92);
      --border: rgba(56, 189, 248, 0.22);
      --cyan: #06b6d4;
      --emerald: #10b981;
      --rose: #f43f5e;
      --text: #f8fafc;
      --muted: #94a3b8;
      --dim: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background:
        radial-gradient(900px 540px at 50% -10%, rgba(6, 182, 212, 0.16), transparent 60%),
        radial-gradient(700px 440px at 85% 90%, rgba(16, 185, 129, 0.10), transparent 55%),
        var(--bg);
      color: var(--text);
      font-family: 'Inter', 'Hind Siliguri', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 470px;
      background: var(--card);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 28px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 20px;
    }
    .brand img {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      border: 1.5px solid rgba(6, 182, 212, 0.45);
      object-fit: cover;
    }
    .brand h1 { font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }
    .brand p { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .client-pill {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: rgba(6, 182, 212, 0.08);
      border: 1px solid rgba(6, 182, 212, 0.25);
      border-radius: 14px;
      padding: 12px 14px;
      margin-bottom: 18px;
    }
    .client-name { font-size: 14px; font-weight: 700; color: #fff; }
    .client-host {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--cyan);
      margin-top: 2px;
      word-break: break-all;
    }
    .oauth-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--emerald);
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 4px 8px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .perms {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 14px;
      padding: 13px 15px;
      margin-bottom: 18px;
    }
    .perms-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .perms ul { list-style: none; display: grid; gap: 7px; font-size: 12.5px; color: #cbd5e1; }
    .perms li { display: flex; align-items: flex-start; gap: 8px; line-height: 1.4; }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--emerald);
      margin-top: 5px;
      flex-shrink: 0;
    }
    .err {
      background: rgba(244, 63, 94, 0.12);
      border: 1px solid rgba(244, 63, 94, 0.4);
      color: #fda4af;
      border-radius: 12px;
      padding: 11px 13px;
      font-size: 12.5px;
      margin-bottom: 16px;
      line-height: 1.45;
    }
    label {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: #e2e8f0;
      margin-bottom: 7px;
    }
    .input-wrap { position: relative; margin-bottom: 8px; }
    input[type="password"], input[type="text"] {
      width: 100%;
      background: rgba(2, 6, 17, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 12px;
      padding: 12px 44px 12px 14px;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.15); }
    .toggle-btn {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
    }
    .hint {
      font-size: 11.5px;
      color: var(--muted);
      line-height: 1.45;
      margin-bottom: 20px;
    }
    .hint code {
      color: var(--cyan);
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
    }
    .actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 10px; }
    .btn {
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: transform 0.1s, opacity 0.15s;
    }
    .btn:active { transform: scale(0.99); }
    .btn-deny {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #cbd5e1;
    }
    .btn-deny:hover { background: rgba(255, 255, 255, 0.1); }
    .btn-allow {
      background: linear-gradient(135deg, #06b6d4, #10b981);
      color: #041019;
      font-weight: 800;
    }
    .btn-allow:hover { opacity: 0.94; }
    .foot {
      margin-top: 18px;
      text-align: center;
      font-size: 11px;
      color: var(--dim);
    }
    .foot a { color: var(--cyan); text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img src="/assets/courier-logo.jpg" alt="Aura Courier MCP" />
      <div>
        <h1>Aura Courier MCP</h1>
        <p>OAuth 2.1 + PKCE Merchant Authorization</p>
      </div>
    </div>

    <div class="client-pill">
      <div>
        <div class="client-name">${escapeHtml(opts.clientName)}</div>
        <div class="client-host">Redirect: ${escapeHtml(opts.redirectHost)}</div>
      </div>
      <span class="oauth-badge">PKCE S256</span>
    </div>

    <div class="perms">
      <div class="perms-title">Requested Permissions</div>
      <ul>
        <li><span class="dot"></span><span><strong>Read:</strong> Track parcels, check COD balance, verify fraud risk, geocode addresses &amp; compare courier rates.</span></li>
        ${hasWrite ? `<li><span class="dot"></span><span><strong>Write:</strong> Book, update, or cancel parcels across Steadfast, Pathao, RedX &amp; Paperfly (according to your key scope).</span></li>` : ""}
      </ul>
    </div>

    ${opts.errorMessage ? `<div class="err">${escapeHtml(opts.errorMessage)}</div>` : ""}

    <form method="POST" action="/oauth/authorize" autocomplete="off">
      <input type="hidden" name="client_id" value="${escapeHtml(opts.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(opts.redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(opts.state)}" />
      <input type="hidden" name="scope" value="${escapeHtml(opts.scope)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(opts.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(opts.codeChallengeMethod)}" />
      <input type="hidden" name="resource" value="${escapeHtml(opts.resource)}" />
      <input type="hidden" name="csrf_token" value="${escapeHtml(opts.csrfToken)}" />

      <label for="api_key">Aura API Key / Merchant MCP Key</label>
      <div class="input-wrap">
        <input id="api_key" name="api_key" type="password" placeholder="aura_live_... or snl_mcp_..." autofocus />
        <button type="button" class="toggle-btn" onclick="var i=document.getElementById('api_key');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'Show':'Hide';">Show</button>
      </div>
      <div class="hint">
        আপনার <strong>Aura Master Key</strong>, <strong>Tenant API Key</strong>, অথবা <strong>Snehalata <code>snl_mcp_...</code></strong> কী দিন। Read-only টেস্টের জন্য: <code>aura_ro_public_inspector_2026</code>
      </div>

      <div class="actions">
        <button type="submit" name="decision" value="deny" class="btn btn-deny" formnovalidate>Cancel</button>
        <button type="submit" name="decision" value="approve" class="btn btn-allow">Authorize &amp; Connect</button>
      </div>
    </form>

    <div class="foot">
      Secured by <a href="${escapeHtml(opts.origin)}">Aura Ajentic AI</a> · <a href="/privacy">Privacy Policy</a>
    </div>
  </div>
</body>
</html>`;
}

function resolveClientMeta(clientId: string, redirectUri: string): {
  valid: boolean;
  clientName: string;
  authMethod: "none" | "client_secret_post" | "client_secret_basic";
  error?: string;
} {
  if (!clientId) {
    return { valid: false, clientName: "Unknown Client", authMethod: "none", error: "Missing client_id." };
  }
  if (!isAllowedRedirectUri(redirectUri)) {
    return {
      valid: false,
      clientName: "Unknown Client",
      authMethod: "none",
      error: "redirect_uri is missing or not in the trusted OAuth redirect allowlist.",
    };
  }
  if (clientId.startsWith("aura_dcr_")) {
    const dcr = decodeDcrClientId(clientId);
    if (!dcr) {
      return {
        valid: false,
        clientName: "Unknown Client",
        authMethod: "none",
        error: "Invalid or tampered dynamically registered client_id.",
      };
    }
    if (!dcr.r.includes(redirectUri)) {
      return {
        valid: false,
        clientName: dcr.n || "MCP Client",
        authMethod: dcr.m,
        error: "redirect_uri does not match the client's registered redirect_uris.",
      };
    }
    return { valid: true, clientName: dcr.n || "MCP Client", authMethod: dcr.m };
  }

  // Allow non-DCR clients (e.g. Google Gemini / ChatGPT / Claude / local CLI) when redirect_uri is strictly allowlisted
  let inferredName = clientId.slice(0, 48);
  try {
    const h = new URL(redirectUri).hostname.toLowerCase();
    if (h.includes("googleusercontent.com") || h.includes("google.com")) inferredName = "Google Gemini";
    else if (h.includes("claude.ai") || h.includes("anthropic.com")) inferredName = "Claude";
    else if (h.includes("chatgpt.com") || h.includes("openai.com")) inferredName = "ChatGPT";
  } catch {}
  return { valid: true, clientName: inferredName, authMethod: "none" };
}

export function registerOAuthRoutes(app: Express): void {
  // 1. RFC 9728 — OAuth 2.0 Protected Resource Metadata (root + /mcp path-inserted variant)
  const protectedResourceHandler = (req: Request, res: Response) => {
    const origin = getPublicOrigin(req);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["read", "write"],
      resource_name: "Aura Courier MCP",
      resource_documentation: `${origin}/guide`,
    });
  };
  app.get("/.well-known/oauth-protected-resource", protectedResourceHandler);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceHandler);

  // 2. RFC 8414 — OAuth 2.0 Authorization Server Metadata (+ OIDC discovery fallback)
  const authServerMetadataHandler = (req: Request, res: Response) => {
    const origin = getPublicOrigin(req);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["read", "write"],
      service_documentation: `${origin}/guide`,
    });
  };
  app.get("/.well-known/oauth-authorization-server", authServerMetadataHandler);
  app.get("/.well-known/oauth-authorization-server/mcp", authServerMetadataHandler);
  app.get("/.well-known/openid-configuration", authServerMetadataHandler);

  // 3. RFC 7591 — Dynamic Client Registration (stateless HMAC-signed client_id, restart-proof)
  app.post("/oauth/register", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const body = (req.body || {}) as Record<string, any>;
    const rawUris = body.redirect_uris;
    if (!Array.isArray(rawUris) || rawUris.length === 0 || rawUris.length > 8) {
      return res.status(400).json({
        error: "invalid_client_metadata",
        error_description: "redirect_uris must be a non-empty array (max 8 URIs).",
      });
    }

    const redirectUris: string[] = [];
    for (const u of rawUris) {
      if (typeof u !== "string" || !isAllowedRedirectUri(u.trim())) {
        return res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: `Redirect URI is not permitted: ${String(u)}`,
        });
      }
      redirectUris.push(u.trim());
    }

    const clientName =
      typeof body.client_name === "string" && body.client_name.trim()
        ? body.client_name.trim().slice(0, 64)
        : "MCP Client";

    const requestedAuthMethod = String(body.token_endpoint_auth_method || "none").trim();
    const authMethod: "none" | "client_secret_post" | "client_secret_basic" =
      requestedAuthMethod === "client_secret_post" || requestedAuthMethod === "client_secret_basic"
        ? requestedAuthMethod
        : "none";

    const iat = Math.floor(Date.now() / 1000);
    const clientId = encodeDcrClientId({
      n: clientName,
      r: redirectUris,
      m: authMethod,
      iat,
    });

    const responsePayload: Record<string, any> = {
      client_id: clientId,
      client_id_issued_at: iat,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: authMethod,
    };

    if (authMethod !== "none") {
      responsePayload.client_secret = deriveDcrClientSecret(clientId);
      responsePayload.client_secret_expires_at = 0;
    }

    return res.status(201).json(responsePayload);
  });

  // 4. OAuth 2.1 Authorization Endpoint (GET Consent UI)
  app.get("/oauth/authorize", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");

    const q = (req.query || {}) as Record<string, any>;
    const responseType = String(q.response_type || "").trim();
    const clientId = String(q.client_id || "").trim();
    const redirectUri = String(q.redirect_uri || "").trim();
    const state = String(q.state || "").trim();
    const scope = String(q.scope || "read write").trim();
    const codeChallenge = String(q.code_challenge || "").trim();
    const codeChallengeMethod = String(q.code_challenge_method || "S256").trim();
    const resource = String(q.resource || "").trim();

    const clientCheck = resolveClientMeta(clientId, redirectUri);
    if (!clientCheck.valid) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: clientCheck.error || "Invalid client_id or redirect_uri.",
      });
    }

    if (responseType !== "code") {
      return redirectWithOAuthError(
        res,
        redirectUri,
        "unsupported_response_type",
        "Only response_type=code is supported.",
        state
      );
    }

    if (!codeChallenge || codeChallenge.length < 43 || codeChallenge.length > 128) {
      return redirectWithOAuthError(
        res,
        redirectUri,
        "invalid_request",
        "PKCE code_challenge (S256) is required by OAuth 2.1.",
        state
      );
    }

    if (codeChallengeMethod !== "S256") {
      return redirectWithOAuthError(
        res,
        redirectUri,
        "invalid_request",
        "Only PKCE code_challenge_method=S256 is supported.",
        state
      );
    }

    const origin = getPublicOrigin(req);
    let redirectHost = redirectUri;
    try {
      redirectHost = new URL(redirectUri).host || redirectUri;
    } catch {}

    const csrfToken = signCsrfToken({
      clientId,
      redirectUri,
      codeChallenge,
      state,
    });

    return res.status(200).type("html").send(
      renderConsentPage({
        origin,
        clientName: clientCheck.clientName,
        redirectHost,
        clientId,
        redirectUri,
        state,
        scope,
        codeChallenge,
        codeChallengeMethod: "S256",
        resource: resource || `${origin}/mcp`,
        csrfToken,
      })
    );
  });

  // 5. OAuth 2.1 Authorization Endpoint (POST Consent Submission)
  app.post("/oauth/authorize", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");

    const b = (req.body || {}) as Record<string, any>;
    const clientId = String(b.client_id || "").trim();
    const redirectUri = String(b.redirect_uri || "").trim();
    const state = String(b.state || "").trim();
    const scope = String(b.scope || "read write").trim();
    const codeChallenge = String(b.code_challenge || "").trim();
    const codeChallengeMethod = String(b.code_challenge_method || "S256").trim();
    const resource = String(b.resource || "").trim();
    const csrfToken = String(b.csrf_token || "").trim();
    const decision = String(b.decision || "approve").trim().toLowerCase();
    const apiKey = String(b.api_key || "").trim();

    const clientCheck = resolveClientMeta(clientId, redirectUri);
    if (!clientCheck.valid) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: clientCheck.error || "Invalid client_id or redirect_uri.",
      });
    }

    if (
      !codeChallenge ||
      codeChallengeMethod !== "S256" ||
      !verifyCsrfToken(csrfToken, { clientId, redirectUri, codeChallenge, state })
    ) {
      return redirectWithOAuthError(
        res,
        redirectUri,
        "invalid_request",
        "Authorization session expired or invalid. Please retry connecting.",
        state
      );
    }

    if (decision === "deny") {
      return redirectWithOAuthError(
        res,
        redirectUri,
        "access_denied",
        "The user denied the authorization request.",
        state
      );
    }

    const origin = getPublicOrigin(req);
    let redirectHost = redirectUri;
    try {
      redirectHost = new URL(redirectUri).host || redirectUri;
    } catch {}

    const renderFailure = (errorMessage: string) => {
      const freshCsrf = signCsrfToken({ clientId, redirectUri, codeChallenge, state });
      return res.status(200).type("html").send(
        renderConsentPage({
          origin,
          clientName: clientCheck.clientName,
          redirectHost,
          clientId,
          redirectUri,
          state,
          scope,
          codeChallenge,
          codeChallengeMethod: "S256",
          resource: resource || `${origin}/mcp`,
          csrfToken: freshCsrf,
          errorMessage,
        })
      );
    };

    if (!apiKey) {
      return renderFailure("Please enter your Aura API Key, Tenant Key, or Snehalata snl_mcp_... key.");
    }

    // Validate submitted API key against ALL live auth backends (Master, Read-Only, Dynamic PG, Env, Snehalata)
    const syntheticReq = {
      headers: { authorization: `Bearer ${apiKey}` },
      query: {},
    } as unknown as Request;

    const authCtx = await resolveAuthContextAsync(syntheticReq);
    if (!authCtx.authenticated) {
      return renderFailure(
        authCtx.deniedReason || "Invalid API Key. Please check your Aura API Key or Snehalata MCP Key and try again."
      );
    }

    const grantedScopes = normalizeScopes(scope, authCtx.scopes);
    const nowSec = Math.floor(Date.now() / 1000);
    const codeClaims: OAuthCodeClaims = {
      cid: clientId,
      ru: redirectUri,
      cc: codeChallenge,
      ccm: "S256",
      scp: grantedScopes,
      sub: authCtx.tenantId,
      adm: authCtx.isAdmin,
      res: resource || `${origin}/mcp`,
      typ: "code",
      iat: nowSec,
      exp: nowSec + AUTH_CODE_TTL_SEC,
      jti: randomBytes(16).toString("base64url"),
    };

    const code = signJwt(codeClaims, "code");
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    if (state) callback.searchParams.set("state", state);

    return res.redirect(302, callback.toString());
  });

  // 6. OAuth 2.1 Token Endpoint (Authorization Code + PKCE S256 & Non-Rotating Refresh Token)
  app.post("/oauth/token", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");

    const b = (req.body || {}) as Record<string, any>;
    const grantType = String(b.grant_type || "").trim();
    const { clientId, clientSecret } = extractClientCredentials(req);

    // If DCR client registered as confidential (client_secret_*), verify secret
    if (clientId && clientId.startsWith("aura_dcr_")) {
      const dcr = decodeDcrClientId(clientId);
      if (!dcr) {
        return res.status(401).json({
          error: "invalid_client",
          error_description: "Unknown or invalid client_id.",
        });
      }
      if (dcr.m !== "none") {
        const expectedSecret = deriveDcrClientSecret(clientId);
        if (!clientSecret || !safeEqualStr(clientSecret, expectedSecret)) {
          return res.status(401).json({
            error: "invalid_client",
            error_description: "Invalid client_secret.",
          });
        }
      }
    }

    const origin = getPublicOrigin(req);

    if (grantType === "authorization_code") {
      const code = String(b.code || "").trim();
      const codeVerifier = String(b.code_verifier || "").trim();
      const redirectUri = typeof b.redirect_uri === "string" ? b.redirect_uri.trim() : "";

      if (!code || !codeVerifier) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "Both code and PKCE code_verifier are required.",
        });
      }

      const codeClaims = verifyJwt<OAuthCodeClaims>(code, "code", "code");
      if (!codeClaims) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Authorization code is invalid or expired.",
        });
      }

      if (usedAuthCodes.has(codeClaims.jti)) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Authorization code has already been used.",
        });
      }

      if (clientId && codeClaims.cid !== clientId) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "client_id does not match authorization code.",
        });
      }

      if (redirectUri && codeClaims.ru !== redirectUri) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "redirect_uri does not match authorization code.",
        });
      }

      if (!verifyPkceS256(codeVerifier, codeClaims.cc)) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "PKCE S256 code_verifier verification failed.",
        });
      }

      // Enforce single-use authorization code
      usedAuthCodes.set(codeClaims.jti, Date.now() + AUTH_CODE_TTL_SEC * 1000 * 2);

      const nowSec = Math.floor(Date.now() / 1000);
      const accessClaims: OAuthAccessClaims = {
        iss: origin,
        aud: codeClaims.res || `${origin}/mcp`,
        sub: codeClaims.sub,
        adm: codeClaims.adm,
        scp: codeClaims.scp,
        cid: codeClaims.cid,
        typ: "at",
        iat: nowSec,
        exp: nowSec + ACCESS_TOKEN_TTL_SEC,
        jti: randomBytes(16).toString("base64url"),
      };
      const refreshClaims: OAuthRefreshClaims = {
        iss: origin,
        aud: codeClaims.res || `${origin}/mcp`,
        sub: codeClaims.sub,
        adm: codeClaims.adm,
        scp: codeClaims.scp,
        cid: codeClaims.cid,
        typ: "rt",
        iat: nowSec,
        exp: nowSec + REFRESH_TOKEN_TTL_SEC,
        jti: randomBytes(16).toString("base64url"),
      };

      const accessToken = signJwt(accessClaims, "access");
      const refreshToken = signJwt(refreshClaims, "refresh");

      return res.status(200).json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SEC,
        refresh_token: refreshToken,
        scope: codeClaims.scp.join(" "),
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = String(b.refresh_token || "").trim();
      if (!refreshToken) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "refresh_token is required.",
        });
      }

      const rtClaims = verifyOAuthRefreshToken(refreshToken);
      if (!rtClaims) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Refresh token is invalid, expired, or revoked.",
        });
      }

      if (clientId && rtClaims.cid !== clientId) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "client_id does not match refresh token.",
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const accessClaims: OAuthAccessClaims = {
        iss: origin,
        aud: rtClaims.aud || `${origin}/mcp`,
        sub: rtClaims.sub,
        adm: rtClaims.adm,
        scp: rtClaims.scp,
        cid: rtClaims.cid,
        typ: "at",
        iat: nowSec,
        exp: nowSec + ACCESS_TOKEN_TTL_SEC,
        jti: randomBytes(16).toString("base64url"),
      };

      const accessToken = signJwt(accessClaims, "access");

      // IMPORTANT FOR GOOGLE GEMINI: Keep refresh_token NON-ROTATING so Gemini never unlinks!
      return res.status(200).json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SEC,
        refresh_token: refreshToken,
        scope: rtClaims.scp.join(" "),
      });
    }

    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Supported grant_types: authorization_code, refresh_token.",
    });
  });

  // 7. RFC 7009 — Token Revocation Endpoint
  app.post("/oauth/revoke", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const b = (req.body || {}) as Record<string, any>;
    const token = String(b.token || "").trim();
    if (token) {
      const at = verifyOAuthAccessToken(token);
      if (at?.jti) {
        revokedTokenIds.set(at.jti, at.exp * 1000 + 60_000);
      }
      const rt = verifyOAuthRefreshToken(token);
      if (rt?.jti) {
        revokedTokenIds.set(rt.jti, rt.exp * 1000 + 60_000);
      }
    }
    return res.status(200).json({ revoked: true });
  });
}
