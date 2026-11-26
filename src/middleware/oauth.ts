import type { Express, Request, Response } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveAuthContextAsync, type AuthScope } from "./auth.js";

const ACCESS_TOKEN_TTL_SEC = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SEC = 180 * 24 * 3600; // 180 days (non-rotating for Gemini stability)
const AUTH_CODE_TTL_SEC = 300; // 5 minutes
const CSRF_TTL_SEC = 900; // 15 minutes
const VALID_SCOPES: AuthScope[] = ["read", "write"];

const AURA_AUTH_BASE = (process.env.AURA_AUTH_URL || "https://auth.auraajenticai.cloud").replace(/\/+$/, "");

// Official inline vector SVG brand mark (from assets/logo.svg — instant render, zero broken-image risk)
const INLINE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="44" height="44" role="img" aria-label="Aura Courier MCP"><defs><linearGradient id="ac-bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#04143e"/><stop offset=".6" stop-color="#0456cc"/><stop offset="1" stop-color="#03bb85"/></linearGradient><linearGradient id="ac-box" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#09bdfc"/><stop offset="1" stop-color="#0451de"/></linearGradient><linearGradient id="ac-spd" x1="0" x2="1"><stop stop-color="#34ee60"/><stop offset="1" stop-color="#04cbe8"/></linearGradient></defs><rect x="16" y="16" width="992" height="992" rx="215" fill="url(#ac-bg)"/><g transform="translate(95 155)"><path d="M35 230h265M90 300h205M65 370h230" fill="none" stroke="url(#ac-spd)" stroke-width="36" stroke-linecap="round"/><path d="m300 220 225-115 236 111-227 118Z" fill="#139cff"/><path d="M300 220v266l234 132V334Z" fill="url(#ac-box)"/><path d="M534 334v284l227-130V216Z" fill="#0750ce"/><path d="m393 174 234 119v137l40-23V270L436 152Z" fill="#fff"/><path d="M265 570c160 122 411 83 532-125" fill="none" stroke="url(#ac-spd)" stroke-width="39" stroke-linecap="round"/></g></svg>`;

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

interface AuraSsoUser {
  sub: string;
  email: string;
  role: "owner" | "admin" | "client" | "team_member";
}

const OAUTH_FORBIDDEN_DEFAULTS = new Set([
  "aura_live_mcp_master_key_2026",
  "aura_ro_public_inspector_2026",
  "aura_webhook_secret_2026",
  "change_me",
  "changeme",
  "secret",
]);

function getRootSecret(): string {
  const raw = (
    process.env.AURA_OAUTH_SECRET ||
    process.env.AURA_API_KEY ||
    process.env.COURIER_AUTH_TOKEN ||
    ""
  ).trim();
  if (raw.length < 20 || OAUTH_FORBIDDEN_DEFAULTS.has(raw.toLowerCase())) {
    throw new Error("AURA_OAUTH_SECRET (or strong AURA_API_KEY >=20 chars) must be configured; predictable defaults are forbidden.");
  }
  return raw;
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

function parseCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie || "";
  if (!raw) return null;
  const parts = raw.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      const v = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

/**
 * Verifies the shared `.auraajenticai.cloud` SSO cookie (`aura_access`) signed with HS256 by `auth.auraajenticai.cloud`.
 * Enables zero-friction 1-click consent for signed-in Aura Cloud users (just like GitHub, Vercel, Linear, Notion).
 */
function verifyAuraSsoCookie(req: Request): AuraSsoUser | null {
  const secret = process.env.AURA_SSO_JWT_SECRET || process.env.JWT_SECRET || "";
  if (!secret) return null;
  const token = parseCookie(req, "aura_access");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;
  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    if (header?.alg !== "HS256") return null;
    const expectedSig = createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(`${headerB64}.${bodyB64}`)
      .digest("base64url");
    if (!safeEqualStr(sigB64, expectedSig)) return null;

    const payload = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8"));
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload?.exp === "number" && payload.exp <= nowSec) return null;
    if (typeof payload?.sub !== "string" || typeof payload?.email !== "string") return null;
    const role = String(payload.role || "client").toLowerCase();
    const normalizedRole: AuraSsoUser["role"] =
      role === "owner" || role === "admin" || role === "team_member" ? role : "client";
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase().trim(),
      role: normalizedRole,
    };
  } catch {
    return null;
  }
}

function mapSsoUserToAuth(user: AuraSsoUser): { tenantId: string; isAdmin: boolean; scopes: AuthScope[] } {
  const isOwnerOrAdmin = user.role === "owner" || user.role === "admin";
  if (isOwnerOrAdmin) {
    return { tenantId: "master", isAdmin: true, scopes: ["read", "write"] };
  }
  return { tenantId: `aura_${user.sub}`, isAdmin: false, scopes: ["read", "write"] };
}

async function authenticateWithAuraPassword(
  email: string,
  password: string
): Promise<{ ok: boolean; user?: AuraSsoUser; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const resp = await fetch(`${AURA_AUTH_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      signal: ctrl.signal,
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.user?.id || !data?.user?.email) {
      return { ok: false, error: data?.error || "Invalid email or password." };
    }
    const role = String(data.user.role || "client").toLowerCase();
    const normalizedRole: AuraSsoUser["role"] =
      role === "owner" || role === "admin" || role === "team_member" ? role : "client";
    return {
      ok: true,
      user: {
        sub: String(data.user.id),
        email: String(data.user.email).toLowerCase().trim(),
        role: normalizedRole,
      },
    };
  } catch {
    return { ok: false, error: "Aura Sign-In service is temporarily unreachable. Please try Google Sign-In or an API key." };
  } finally {
    clearTimeout(timer);
  }
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

  if (
    proto === "cursor:" ||
    proto === "vscode:" ||
    proto === "vscode-insiders:" ||
    proto === "windsurf:" ||
    proto === "antigravity:" ||
    proto === "claude:" ||
    proto === "cline:" ||
    proto === "raycast:"
  ) {
    return true;
  }

  if (
    (proto === "http:" || proto === "https:") &&
    (host === "localhost" || host === "127.0.0.1" || host === "[::1]")
  ) {
    return true;
  }

  if (proto !== "https:") return false;

  const trustedHostPatterns = [
    // Google / Gemini / Antigravity / AI Studio
    /^(?:.+\.)?googleusercontent\.com$/,
    /^(?:.+\.)?google\.com$/,
    /^(?:.+\.)?googleapis\.com$/,
    /^(?:.+\.)?google\.dev$/,
    /^(?:.+\.)?antigravity\.google$/,
    // Anthropic / Claude Connectors Directory (claude.ai + claude.com)
    /^(?:.+\.)?claude\.ai$/,
    /^(?:.+\.)?claude\.com$/,
    /^(?:.+\.)?anthropic\.com$/,
    // OpenAI / ChatGPT Apps & Connectors Directory
    /^(?:.+\.)?chatgpt\.com$/,
    /^(?:.+\.)?openai\.com$/,
    // Global AI IDEs, Assistants & Agent Marketplaces
    /^(?:.+\.)?cursor\.com$/,
    /^(?:.+\.)?cursor\.sh$/,
    /^(?:.+\.)?windsurf\.com$/,
    /^(?:.+\.)?codeium\.com$/,
    /^(?:.+\.)?perplexity\.ai$/,
    /^(?:.+\.)?mistral\.ai$/,
    /^(?:.+\.)?poe\.com$/,
    /^(?:.+\.)?huggingface\.co$/,
    /^(?:.+\.)?github\.com$/,
    /^(?:.+\.)?vscode\.dev$/,
    /^(?:.+\.)?raycast\.com$/,
    // Automation & Workflow Connectors
    /^(?:.+\.)?zapier\.com$/,
    /^(?:.+\.)?make\.com$/,
    /^(?:.+\.)?integromat\.com$/,
    /^(?:.+\.)?n8n\.io$/,
    /^(?:.+\.)?n8n\.cloud$/,
    /^(?:.+\.)?pipedream\.com$/,
    /^(?:.+\.)?activepieces\.com$/,
    // Aura & Partner Ecosystem
    /^(?:.+\.)?auraajenticai\.cloud$/,
    /^(?:.+\.)?snehalata\.com$/,
    // Official MCP Registries, Directories & API Clients
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
      // Ignore malformed Basic header
    }
  }

  return { clientId, clientSecret };
}

function buildAuthorizeReturnUrl(opts: {
  origin: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}): string {
  const u = new URL(`${opts.origin}/oauth/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  if (opts.state) u.searchParams.set("state", opts.state);
  if (opts.scope) u.searchParams.set("scope", opts.scope);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", opts.codeChallengeMethod || "S256");
  if (opts.resource) u.searchParams.set("resource", opts.resource);
  return u.toString();
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
  ssoUser: AuraSsoUser | null;
  activeTab?: "account" | "apikey";
  errorMessage?: string;
}): string {
  const scopes = opts.scope ? opts.scope.split(/[\s,]+/).filter(Boolean) : ["read", "write"];
  const hasWrite = scopes.some((s) => s.toLowerCase().includes("write"));
  const returnUrl = buildAuthorizeReturnUrl(opts);
  const googleSignInUrl = `${AURA_AUTH_BASE}/login/google?next=${encodeURIComponent(returnUrl)}`;
  const auraLoginUrl = `${AURA_AUTH_BASE}/login?next=${encodeURIComponent(returnUrl)}`;
  const auraRegisterUrl = `${AURA_AUTH_BASE}/register?next=${encodeURIComponent(returnUrl)}`;
  const tab = opts.activeTab === "apikey" ? "apikey" : "account";

  const hiddenFields = `
      <input type="hidden" name="client_id" value="${escapeHtml(opts.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(opts.redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(opts.state)}" />
      <input type="hidden" name="scope" value="${escapeHtml(opts.scope)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(opts.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(opts.codeChallengeMethod)}" />
      <input type="hidden" name="resource" value="${escapeHtml(opts.resource)}" />
      <input type="hidden" name="csrf_token" value="${escapeHtml(opts.csrfToken)}" />`;

  const roleLabel = opts.ssoUser
    ? opts.ssoUser.role === "owner" || opts.ssoUser.role === "admin"
      ? "Workspace Owner"
      : "Aura Merchant"
    : "";

  const authSectionHtml = opts.ssoUser
    ? `
    <div class="sso-identity">
      <div class="avatar">${escapeHtml(opts.ssoUser.email.charAt(0).toUpperCase())}</div>
      <div class="id-meta">
        <div class="id-email" title="${escapeHtml(opts.ssoUser.email)}">${escapeHtml(opts.ssoUser.email)}</div>
        <div class="id-sub"><span class="role-chip">${escapeHtml(roleLabel)}</span> · <a href="${escapeHtml(auraLoginUrl)}">Switch account</a></div>
      </div>
    </div>

    <form method="POST" action="/oauth/authorize" autocomplete="off">
      ${hiddenFields}
      <input type="hidden" name="auth_mode" value="sso" />
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="btn btn-secondary" formnovalidate>Cancel</button>
        <button type="submit" name="decision" value="approve" class="btn btn-primary">Allow Access</button>
      </div>
    </form>`
    : `
    <a href="${escapeHtml(googleSignInUrl)}" class="btn-google">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82z"/>
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.28v3.1A12 12 0 0 0 12 24z"/>
        <path fill="#FBBC05" d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6v-3.1H1.28a12 12 0 0 0 0 10.8z"/>
        <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z"/>
      </svg>
      <span>Continue with Google</span>
    </a>

    <div class="divider"><span>or continue with</span></div>

    <div class="tabs" role="tablist">
      <button type="button" id="tab-account" class="tab ${tab === "account" ? "active" : ""}" onclick="switchTab('account')">Aura Account</button>
      <button type="button" id="tab-apikey" class="tab ${tab === "apikey" ? "active" : ""}" onclick="switchTab('apikey')">API Key</button>
    </div>

    <form id="form-account" method="POST" action="/oauth/authorize" style="display:${tab === "account" ? "block" : "none"}" autocomplete="on">
      ${hiddenFields}
      <input type="hidden" name="auth_mode" value="password" />
      <div class="field">
        <label for="email">Work Email</label>
        <input id="email" name="email" type="email" placeholder="you@company.com" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <div class="input-wrap">
          <input id="password" name="password" type="password" placeholder="Enter your password" autocomplete="current-password" required />
          <button type="button" class="toggle-btn" onclick="toggleVis('password', this)">Show</button>
        </div>
      </div>
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="btn btn-secondary" formnovalidate>Cancel</button>
        <button type="submit" name="decision" value="approve" class="btn btn-primary">Sign In &amp; Allow</button>
      </div>
      <div class="sub-link">New to Aura Courier? <a href="${escapeHtml(auraRegisterUrl)}">Create a free account</a></div>
    </form>

    <form id="form-apikey" method="POST" action="/oauth/authorize" style="display:${tab === "apikey" ? "block" : "none"}" autocomplete="off">
      ${hiddenFields}
      <input type="hidden" name="auth_mode" value="apikey" />
      <div class="field">
        <label for="api_key">Merchant API Key</label>
        <div class="input-wrap">
          <input id="api_key" name="api_key" type="password" placeholder="Paste your Aura Courier API key" required />
          <button type="button" class="toggle-btn" onclick="toggleVis('api_key', this)">Show</button>
        </div>
        <div class="hint">Generate or manage API keys anytime from your <a href="https://client.auraajenticai.cloud" target="_blank" rel="noopener">Aura Cloud Console</a>.</div>
      </div>
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="btn btn-secondary" formnovalidate>Cancel</button>
        <button type="submit" name="decision" value="approve" class="btn btn-primary">Authorize &amp; Connect</button>
      </div>
    </form>

    <form method="POST" action="/oauth/authorize" class="sandbox-row">
      ${hiddenFields}
      <input type="hidden" name="auth_mode" value="sandbox" />
      <button type="submit" name="decision" value="sandbox" class="sandbox-btn">
        Evaluating the integration? <span>Continue in Read-Only Sandbox &rarr;</span>
      </button>
    </form>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize ${escapeHtml(opts.clientName)} — Aura Courier</title>
  <link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />
  <style>
    :root {
      --bg: #070b14;
      --surface: #0e1525;
      --surface-2: rgba(255, 255, 255, 0.035);
      --border: rgba(148, 163, 184, 0.16);
      --border-strong: rgba(56, 189, 248, 0.34);
      --accent: #06b6d4;
      --emerald: #10b981;
      --rose: #fb7185;
      --text: #f8fafc;
      --muted: #94a3b8;
      --dim: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background:
        radial-gradient(900px 520px at 50% -12%, rgba(6, 182, 212, 0.14), transparent 62%),
        radial-gradient(640px 420px at 85% 95%, rgba(16, 185, 129, 0.09), transparent 55%),
        var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 100%;
      max-width: 448px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 13px;
      margin-bottom: 20px;
    }
    .logo-wrap {
      width: 44px;
      height: 44px;
      border-radius: 11px;
      overflow: hidden;
      flex-shrink: 0;
      box-shadow: 0 6px 20px rgba(6, 182, 212, 0.22);
    }
    .logo-wrap svg { display: block; width: 44px; height: 44px; }
    .header-text h1 { font-size: 17px; font-weight: 700; letter-spacing: -0.02em; color: #fff; }
    .header-text p { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
    .client-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: rgba(6, 182, 212, 0.07);
      border: 1px solid rgba(6, 182, 212, 0.22);
      border-radius: 13px;
      padding: 11px 14px;
      margin-bottom: 16px;
    }
    .client-info { min-width: 0; flex: 1; }
    .client-title { font-size: 13.5px; font-weight: 650; color: #fff; }
    .client-host {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      color: #67e8f9;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 10.5px;
      font-weight: 600;
      color: #34d399;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 4px 9px;
      border-radius: 999px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .perms {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 13px;
      padding: 13px 15px;
      margin-bottom: 18px;
    }
    .perms-label {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 9px;
    }
    .perms ul { list-style: none; display: grid; gap: 8px; font-size: 12.5px; color: #cbd5e1; }
    .perms li { display: flex; align-items: flex-start; gap: 9px; line-height: 1.45; }
    .perms svg { flex-shrink: 0; margin-top: 2px; color: var(--emerald); }
    .err {
      background: rgba(244, 63, 94, 0.11);
      border: 1px solid rgba(244, 63, 94, 0.38);
      color: #fecdd3;
      border-radius: 11px;
      padding: 10px 13px;
      font-size: 12.5px;
      margin-bottom: 15px;
      line-height: 1.45;
    }
    .sso-identity {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 13px;
      padding: 12px 14px;
      margin-bottom: 18px;
    }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .id-meta { min-width: 0; flex: 1; }
    .id-email { font-size: 13.5px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .id-sub { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
    .id-sub a { color: #67e8f9; text-decoration: none; }
    .id-sub a:hover { text-decoration: underline; }
    .role-chip { color: #34d399; font-weight: 600; }
    .btn-google {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: #ffffff;
      color: #0f172a;
      font-size: 13.5px;
      font-weight: 650;
      text-decoration: none;
      padding: 11px 14px;
      border-radius: 11px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      transition: background 0.15s, transform 0.1s;
    }
    .btn-google:hover { background: #f1f5f9; }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 15px 0 13px;
      color: var(--dim);
      font-size: 11.5px;
    }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
    .tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      background: rgba(2, 6, 17, 0.7);
      border: 1px solid var(--border);
      border-radius: 11px;
      padding: 3px;
      margin-bottom: 14px;
    }
    .tab {
      background: transparent;
      border: none;
      color: var(--muted);
      font-size: 12.5px;
      font-weight: 600;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .tab.active { background: rgba(56, 189, 248, 0.14); color: #fff; }
    .field { margin-bottom: 12px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
    .input-wrap { position: relative; }
    input[type="email"], input[type="password"], input[type="text"] {
      width: 100%;
      background: #060a14;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 10px;
      padding: 10.5px 13px;
      color: #fff;
      font-size: 13.5px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .input-wrap input { padding-right: 54px; }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.15); }
    .toggle-btn {
      position: absolute;
      right: 9px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      color: var(--muted);
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
    }
    .hint { font-size: 11.5px; color: var(--muted); margin-top: 6px; line-height: 1.45; }
    .hint a { color: #67e8f9; text-decoration: none; }
    .hint a:hover { text-decoration: underline; }
    .actions { display: grid; grid-template-columns: 1fr 1.65fr; gap: 10px; margin-top: 14px; }
    .btn {
      border-radius: 11px;
      padding: 11.5px 14px;
      font-size: 13.5px;
      font-weight: 650;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s, transform 0.1s;
    }
    .btn:active { transform: scale(0.99); }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #cbd5e1;
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.09); }
    .btn-primary {
      background: linear-gradient(135deg, #06b6d4, #10b981);
      color: #03111a;
      font-weight: 750;
    }
    .btn-primary:hover { opacity: 0.94; }
    .sub-link { text-align: center; font-size: 12px; color: var(--muted); margin-top: 12px; }
    .sub-link a { color: #67e8f9; text-decoration: none; font-weight: 500; }
    .sub-link a:hover { text-decoration: underline; }
    .sandbox-row {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
      text-align: center;
    }
    .sandbox-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      font-size: 12px;
      cursor: pointer;
      padding: 4px 6px;
    }
    .sandbox-btn span { color: #67e8f9; font-weight: 600; }
    .sandbox-btn:hover span { text-decoration: underline; }
    .foot {
      margin-top: 16px;
      text-align: center;
      font-size: 11px;
      color: var(--dim);
    }
    .foot a { color: var(--muted); text-decoration: none; }
    .foot a:hover { color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo-wrap">${INLINE_LOGO_SVG}</div>
      <div class="header-text">
        <h1>Authorize ${escapeHtml(opts.clientName)}</h1>
        <p>Aura Courier MCP · Enterprise Logistics Hub</p>
      </div>
    </div>

    <div class="client-bar">
      <div class="client-info">
        <div class="client-title">${escapeHtml(opts.clientName)}</div>
        <div class="client-host" title="${escapeHtml(opts.redirectHost)}">${escapeHtml(opts.redirectHost)}</div>
      </div>
      <span class="badge">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        OAuth 2.1
      </span>
    </div>

    <div class="perms">
      <div class="perms-label">Permissions Requested</div>
      <ul>
        <li>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <span><strong>Read logistics data:</strong> Track consignments, check COD balances, assess fraud risk, geocode addresses, and compare carrier rates.</span>
        </li>
        ${
          hasWrite
            ? `<li>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <span><strong>Manage parcels:</strong> Create, update, and cancel shipments across connected carriers (within your workspace permissions).</span>
        </li>`
            : ""
        }
      </ul>
    </div>

    ${opts.errorMessage ? `<div class="err">${escapeHtml(opts.errorMessage)}</div>` : ""}

    ${authSectionHtml}

    <div class="foot">
      Protected by <a href="https://auraajenticai.cloud" target="_blank" rel="noopener">Aura Ajentic AI</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a> · <a href="/guide" target="_blank" rel="noopener">Docs</a>
    </div>
  </div>
  <script>
    function switchTab(mode) {
      var isAcc = mode === 'account';
      document.getElementById('tab-account').className = 'tab' + (isAcc ? ' active' : '');
      document.getElementById('tab-apikey').className = 'tab' + (!isAcc ? ' active' : '');
      document.getElementById('form-account').style.display = isAcc ? 'block' : 'none';
      document.getElementById('form-apikey').style.display = !isAcc ? 'block' : 'none';
    }
    function toggleVis(id, btn) {
      var el = document.getElementById(id);
      if (!el) return;
      el.type = el.type === 'password' ? 'text' : 'password';
      btn.textContent = el.type === 'password' ? 'Show' : 'Hide';
    }
  </script>
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

  let inferredName = clientId.slice(0, 48);
  try {
    const h = new URL(redirectUri).hostname.toLowerCase();
    if (h.includes("googleusercontent.com") || h.includes("google.com")) inferredName = "Google Gemini";
    else if (h.includes("claude.ai") || h.includes("claude.com") || h.includes("anthropic.com")) inferredName = "Claude";
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

  // 4. OAuth 2.1 Authorization Endpoint (GET Consent UI — 1-Click SSO, Google Sign-In, Email/Password, API Key, Sandbox)
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

    const ssoUser = verifyAuraSsoCookie(req);

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
        ssoUser,
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
    const authMode = String(b.auth_mode || (b.api_key ? "apikey" : "sso")).trim().toLowerCase();

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

    const ssoUser = verifyAuraSsoCookie(req);

    const renderFailure = (errorMessage: string, activeTab: "account" | "apikey" = "account") => {
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
          ssoUser,
          activeTab,
          errorMessage,
        })
      );
    };

    let resolvedTenantId = "";
    let resolvedAdmin = false;
    let resolvedScopes: AuthScope[] = [];

    if (decision === "sandbox" || authMode === "sandbox") {
      // Strictly Read-Only Sandbox mode for evaluators / Antigravity Marketplace / Gemini reviewers
      resolvedTenantId = "public_ro";
      resolvedAdmin = false;
      resolvedScopes = ["read"];
    } else if (authMode === "sso") {
      if (!ssoUser) {
        return renderFailure("Your Aura session has expired. Please sign in again to continue.", "account");
      }
      const mapped = mapSsoUserToAuth(ssoUser);
      resolvedTenantId = mapped.tenantId;
      resolvedAdmin = mapped.isAdmin;
      resolvedScopes = mapped.scopes;
    } else if (authMode === "password") {
      const email = String(b.email || "").trim();
      const password = String(b.password || "");
      if (!email || !password) {
        return renderFailure("Please enter both your email address and password.", "account");
      }
      const loginRes = await authenticateWithAuraPassword(email, password);
      if (!loginRes.ok || !loginRes.user) {
        return renderFailure(loginRes.error || "Invalid email or password.", "account");
      }
      const mapped = mapSsoUserToAuth(loginRes.user);
      resolvedTenantId = mapped.tenantId;
      resolvedAdmin = mapped.isAdmin;
      resolvedScopes = mapped.scopes;
    } else {
      // Developer / Merchant API Key authentication (Master, Dynamic PG, Env, or Partner keys)
      const apiKey = String(b.api_key || "").trim();
      if (!apiKey) {
        return renderFailure("Please enter a valid Aura Courier API key.", "apikey");
      }
      const syntheticReq = {
        headers: { authorization: `Bearer ${apiKey}` },
        query: {},
      } as unknown as Request;
      const authCtx = await resolveAuthContextAsync(syntheticReq);
      if (!authCtx.authenticated) {
        return renderFailure(
          authCtx.deniedReason || "Invalid API key. Please verify your key in Aura Cloud Console and try again.",
          "apikey"
        );
      }
      resolvedTenantId = authCtx.tenantId;
      resolvedAdmin = authCtx.isAdmin;
      resolvedScopes = authCtx.scopes;
    }

    const grantedScopes = normalizeScopes(scope, resolvedScopes);
    const nowSec = Math.floor(Date.now() / 1000);
    const codeClaims: OAuthCodeClaims = {
      cid: clientId,
      ru: redirectUri,
      cc: codeChallenge,
      ccm: "S256",
      scp: grantedScopes,
      sub: resolvedTenantId,
      adm: resolvedAdmin,
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

      // Non-rotating refresh_token preserves long-lived Google Gemini MCP connections
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
