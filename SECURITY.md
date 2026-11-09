# Security Policy & Zero-Knowledge Vault Architecture

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.5.x   | :white_check_mark: |
| 2.4.x   | :white_check_mark: |
| < 2.4.0 | :x:                |

## Zero-Knowledge AES-256 Credential Vault Guarantee

**Aura Courier MCP** enforces strict **Zero-Knowledge Cryptographic Isolation** for all merchant courier and e-commerce store credentials:
1. **AES-256-CBC Encryption at Rest**: Whenever a merchant connects Steadfast, Pathao, RedX, Paperfly, WooCommerce, or Shopify API keys, credentials are immediately encrypted using AES-256-CBC before being stored in the isolated tenant vault.
2. **Zero Admin Visibility**: Platform administrators and engineers cannot view, inspect, or export any client's raw courier API keys.
3. **Transient In-Memory Execution**: Direct MCP header credentials (`x-steadfast-api-key`, `x-pathao-client-id`, etc.) exist strictly in isolated request memory for the duration of the tool call and are never written to disk or application logs.

## Reporting a Vulnerability

If you discover a security issue, please report it privately to **ceo@auraajenticai.cloud** or **khondokartowsif171@gmail.com**. We respond to all security reports within 24 hours.
