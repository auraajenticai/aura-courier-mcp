# Changelog

## [2.6.0] - 2026-11-10

### Added
- **Global Response Envelope (`src/envelope.ts`)**: All 12 MCP tools now return a normalized `{ ok, data, error, meta: { request_id, source, as_of } }` envelope alongside existing top-level backward-compatible fields. Raw Axios error strings (`"Request failed with status code ..."`) are strictly sanitized and replaced with typed `EnvelopeErrorCode` entries (`UNAUTHORIZED`, `INVALID_INPUT`, `CONSIGNMENT_NOT_FOUND`, `COURIER_NOT_CONFIGURED`, `COURIER_UPSTREAM_ERROR`, `UNSUPPORTED_BY_PROVIDER`, `DUPLICATE_INVOICE`).
- **Task T1 — Authentication, Scopes, Per-Key Rate Limits & Webhook Verification (`src/middleware/auth.ts`)**:
  - `POST /mcp` now strictly requires `Authorization: Bearer <key>` (`HTTP 401` + `UNAUTHORIZED` envelope when missing/invalid).
  - Supports `read` (`aura_ro_*`) and `write` (`aura_rw_*` / master) scopes, per-key sliding-window rate limits, tenant credential isolation (`keysFromRequest`), and privacy-safe audit logs (`maskPhone` as `017****1234`, `[REDACTED_ADDRESS]`).
  - `/webhooks/{steadfast,pathao,redx,paperfly}` verify inbound webhook signatures/tokens (`HTTP 401` on unsigned requests).
- **Task T2 — Verified Draft-Only `resolve_ndr_issue`**: Verifies `consignment_id` via `track_parcel` first (returning `CONSIGNMENT_NOT_FOUND` on bogus IDs), and returns `status: "DRAFT_GENERATED"`, `actions_executed: []`, `requires_manual_execution: true`, and conditional Bengali copy prefixed with `"প্রস্তাবিত মেসেজ:"`.
- **Task T3 — Honest `get_balance` Semantics**: `Steadfast` returns live `amount_bdt` and `status: "OK"`; `Pathao`, `RedX`, and `Paperfly` return `amount_bdt: null, pending_bdt: null, status: "UNSUPPORTED_BY_PROVIDER"` with merchant portal hints (never a misleading numeric `0`).
- **Task T4 — Single Tariff Source of Truth (`src/tariffs.ts`)**: Unified `ZONE_DEFINITIONS` and `CARRIER_TARIFF_TABLE` (`meta.source: "static_tariff"`) across `calculate_delivery_zone_and_fee` and `compare_courier_rates` with structured `sla_hours: { min, max }` and route-specific `coverage_notes`.
- **Task T5 — Geocoding Accuracy & Thana Verification (`src/adapters/google_maps.ts`)**: `validate_and_geocode_address` derives `thana_resolved` strictly from geocoder components (never echoing `thana_input`), caps `confidence_score` at `60` when `location_type !== "ROOFTOP"`, and returns `match_quality: { road, house, area }`, `needs_review`, and `warnings[]`.
- **Task T6 — Honest `check_fraud_risk` Taxonomy (`src/adapters/fraud_engine.ts`)**: Returns `risk_level: "INVALID_NUMBER"` with `delivery_success_rate: null` for invalid prefixes (`01000000000`), `risk_level: "NO_HISTORY"` with `null` rates when `sample_size === 0`, and `data_sources`, `sample_size`, and `coverage_note`.
- **Task T7 — Multi-Courier `track_parcel` & Bounded GET Retry**: Auto-detects prefix, checks all configured couriers (`couriers_checked`), retries transient `429/5xx/timeout` GETs via `withGetRetry`, and returns `CONSIGNMENT_NOT_FOUND` without raw Axios strings.
- **Task T8 — `create_parcel` Dry-Run, Invoice Idempotency & 3 New Tools (12 Total Tools)**:
  - `create_parcel` supports `dry_run: true` (zero upstream calls, returns `would_book_with` and `estimated_cost_bdt`) and per-tenant `invoice` idempotency (`idempotent_replay: true/false`).
  - Added `cancel_parcel(courier, consignment_id)`, `bulk_create_parcels(items[], dry_run?)`, and `get_webhook_events(consignment_id?, since?)`.
- **Task T9 — Hardened `/health` Endpoint**: Unauthenticated `GET /health` returns `{ ok: true, version: "2.6.0" }` only; full telemetry requires an admin Bearer token.
- **Automated CI Acceptance Suite (`test/v260.test.mjs`)**: Added 12 mocked unit & acceptance tests covering all `AGENTS.md` criteria (`npm test`).

## [2.5.5] - 2026-11-10

### Added
- **Live 4-Courier Balance, Settlement & Store Verification (`get_balance`)**: Upgraded `get_balance` to support `steadfast`, `pathao`, `redx`, `paperfly`, and `all` simultaneously—querying live Packzy wallet balances (`Steadfast`), live OAuth 2.0 order/COD settlement ledgers & active stores (`Pathao`), live OpenAPI pickup stores (`RedX`), and live Basic Auth + `paperflykey` merchant status (`Paperfly`).
- **Dual-Carrier Nationwide Fraud Shield (`check_fraud_risk`)**: Integrated Pathao's live `/aladdin/api/v1/user/success` nationwide customer delivery history API alongside Steadfast's `/fraud_check/{phone}` API for 100% live `total_parcels`, `total_delivered`, `total_cancelled`, and `delivery_success_rate` telemetry.
- **Stateless + Stateful Dual-Mode `POST /mcp` Gateway**: Added direct single-request JSON-RPC 2.0 execution for `tools/call` and `tools/list` on `POST /mcp` without requiring a prior `mcp-session-id` handshake, while preserving full stateful `StreamableHTTPServerTransport` sessions for MCP clients.
- **Dual Subscription & Per-Message Pricing Architecture (`/guide#pricing`)**: Structured two distinct Google Cloud Startup–aligned subscription tracks: **Track A (`Aura Courier MCP Only` — Free Trial `$0`, Starter `$9 / ৳499`, Pro `$19 / ৳999`)** and **Track B (`Aura Main Omnichannel AI + WhatsApp/Messenger + Per-Message Quota` — Starter `$19 / ৳1,999`, Growth `$49 / ৳4,999`, Enterprise `$149 / ৳14,999` + Meta WABA Per-Message Rate Card)**.

## [2.5.4] - 2026-11-10

### Added
- **Standalone Courier MCP vs. Full Aura Client Dashboard Architecture Guide (`/guide#architecture`)**: Added a comprehensive bilingual comparison and module breakdown explaining how merchants can use **Aura Courier MCP Standalone** inside WooCommerce/Shopify/Custom stores or upgrade to the full **Aura Client Dashboard Suite** (`client.auraajenticai.cloud`) with 6-Pillar WhatsApp/Messenger AI Bots, 3-Column Omnichannel Inbox (`#view-inbox`), and Logistics Profit Guard (`#view-risk`).
- **4-Platform Interactive Simulator (`/guide#simulator`)**: Upgraded the live simulator with a 4th interactive tab (**🌐 Aura Client Dashboard**) and dynamic **Delivery Zone Switcher** (`Inside Dhaka`, `Sub-Dhaka`, `Outside Dhaka`).
- **Bangladesh (`৳ BDT`) & Global (`$ USD`) Pricing Structure + 15-Day Free Trial (`/guide#pricing`)**: Bound transparent 4-tier pricing (**15-Day Free Trial `৳0`**, **Courier MCP Starter `৳499/mo`**, **Courier MCP Pro `৳999/mo`**, and **Aura Ecosystem Suite `৳2,499/mo`**) with interactive BDT/USD and Monthly/Yearly toggles.
- **Clean Single-Line Navigation UI**: Removed cluttering diagonal arrows (`↗`) across the landing page and guide navigation bars.

## [2.5.3] - 2026-11-10

### Added
- **Interactive In-Dashboard Store Simulator (`/guide`)**: Added a full interactive store admin simulator directly inside `https://courier.auraajenticai.cloud/guide` allowing merchants to switch between **WooCommerce (WP Admin)**, **Shopify Admin**, and **Custom Website (Supabase)**, toggle **Safe vs. High-Risk Fraud Customer** telemetry, select any of the **4 Couriers (Steadfast, Pathao, RedX, Paperfly)**, book parcels with 1 click, and preview **4x6 Thermal Barcode Shipping Labels**.
- **Official High-Res Brand Icon (`/assets/courier-logo.jpg`)**: Integrated the official Aura Courier MCP brand icon across `/guide` and static assets.
- **GitHub Linguist Configuration (`.gitattributes`)**: Marked static HTML documentation pages as `linguist-documentation` so GitHub and Glama AI classify the repository language accurately as `TypeScript`.

All notable changes to **Aura Courier MCP** are documented in this file.

## [2.5.2] - 2026-11-10
### Added
- **Bilingual User Guide & Business Benefits Hub (`GET /guide`)**: Interactive Bengali & English guide (`https://courier.auraajenticai.cloud/guide`) covering 3-in-1 WooCommerce/Shopify integration, 6-Pillar WhatsApp/Messenger AI Bot harmony, Multi-Tenant Isolation, and MCP AI Agent setup.
- **Bilingual Real-Time Fraud Risk Output (`🇧🇩 বাংলা | 🇬🇧 English`)**: Upgraded `FraudRiskEngine.evaluateRisk` and In-Dashboard Quick-Ship widget (`/api/courier/quick-ship`) with bilingual recommendations and 1-click language switching.
- **Repository Governance & Security Documentation**: Added `SECURITY.md`, `CONTRIBUTING.md`, and `CHANGELOG.md`.

## [2.5.1] - 2026-11-10
### Added
- **Zero-Knowledge AES-256 Cryptographic Vault Policy (`/privacy`)**: Documented strict Zero Admin Visibility guarantee for client courier API keys.
- **3-in-1 Store Connection & In-Dashboard Quick-Ship Bridge**: Added support for 1-Click WooCommerce Auto-Connect, Pre-Connected `.zip` Plugin, and Shopify/Custom Store widgets.

## [2.5.0] - 2026-11-09
### Changed
- **Glama TDQS 5.0 Compliance**: Enhanced all 9 MCP tool descriptions with explicit side-effect declarations, disambiguation rules, and parameter constraints.
- **Credential Isolation**: Removed all fallback merchant credentials from source files in favor of runtime environment and header injection.
