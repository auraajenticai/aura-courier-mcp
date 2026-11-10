# Changelog

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
