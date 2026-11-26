# Security Policy & Zero-Knowledge Vault Architecture

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.7.x   | :white_check_mark: |
| 2.6.x   | :white_check_mark: |
| < 2.6.0 | :x:                |

## Zero-Knowledge & Fail-Closed Security Architecture

**Aura Courier MCP** enforces strict cryptographic isolation, fail-closed startup validation, and defense-in-depth protections:
1. **Fail-Closed Secret Validation**: Production startup refuses weak, short, or placeholder secrets across `AURA_API_KEY`, `AURA_ADMIN_KEY`, `AURA_READONLY_KEY`, `AURA_WEBHOOK_SECRET`, and `AURA_OAUTH_SECRET`.
2. **AES-256-GCM / SHA-256 Tenant Vault Isolation**: Dynamic tenant credentials and API key hashes are isolated per tenant in PostgreSQL (`aura_courier_runtime` least-privilege DB role) with strict `AND tenant = $...` SQL enforcement.
3. **Transient Authenticated BYOK & Anti-SSRF Allowlist**: Direct MCP header credentials (`x-steadfast-api-key`, `x-pathao-client-id`, etc.) require prior Aura authentication, enforce complete credential bundles, exist strictly in isolated request memory, and restrict carrier base URLs to official HTTPS carrier hostnames (`maxRedirects: 0`).
4. **OAuth 2.1 + PKCE (`S256`) & Replay-Protected Webhooks**: Supports RFC 9728 / RFC 8414 / RFC 7591 OAuth 2.1 with PKCE `S256`, spoof-resistant IP rate limiting, and timing-safe webhook verification with `±10m` replay protection (`HTTP 409`).

## Reporting a Vulnerability

If you discover a security issue, please report it privately to **ceo@auraajenticai.cloud** or **khondokartowsif171@gmail.com**. We respond to all security reports within 24 hours.
