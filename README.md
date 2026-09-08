# 🚀 Aura Courier MCP — Bangladesh's First Universal Courier Model Context Protocol

[![Glama Verified](https://img.shields.io/badge/Glama-Verified%20Server-38bdf8.svg)](https://glama.ai/mcp/servers/auraajenticai/aura-courier-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.x-8b5cf6.svg)](https://modelcontextprotocol.io)
[![Couriers](https://img.shields.io/badge/Couriers-Steadfast%20%7C%20Pathao%20%7C%20RedX%20%7C%20Paperfly-46d17f.svg)](https://courier.auraajenticai.cloud)

> **One unified Model Context Protocol connector for every Bangladesh courier.**
> Book deliveries, track parcels, check merchant balances, and screen customer COD/return-fraud risk — straight from **Google Antigravity**, **Claude Desktop**, **Cursor**, **n8n AI Agents**, or any MCP-compatible client. Just tell your AI what to ship.

🌐 **Showcase & live docs:** [courier.auraajenticai.cloud](https://courier.auraajenticai.cloud)
🏢 **Built by:** [Aura Ajentic AI](https://auraajenticai.cloud) · Khondokar Towsif (Amirul Islam Redwan)

---

## ⚡ Supported couriers — four networks, one interface (all proven)

| Courier | API | Status |
|---|---|---|
| **Steadfast** | Packzy API v1 | ✅ Proven |
| **Pathao** | Aladdin API v1 (OAuth + city/zone resolver) | ✅ Proven |
| **RedX** | OpenAPI v1 (area auto-resolver + tracking) | ✅ Proven |
| **Paperfly** | Wingman API (order + tracking) | ✅ Proven |

> You bring each courier's own merchant credentials (env vars or request headers); Aura routes the request and normalizes the response.

---

## 🧠 MCP tools

| Tool | What it does |
|---|---|
| `create_parcel` | Book a parcel on Steadfast / Pathao / RedX / Paperfly (or `auto`), with one normalized response. |
| `track_parcel` | Universal tracking by tracking / consignment / reference id, across every supported courier. |
| `get_balance` | Live merchant account balance & payout info (Steadfast & Pathao). |
| `check_fraud_risk` | **BD phone COD/return-risk score** — screen a customer's number *before* you ship cash-on-delivery. Works with no courier keys. |
| `list_couriers` | Show supported couriers and which credentials are currently active. |

---

## 🔌 Two ways to connect

### 1) Remote URL — claude.ai web, n8n, any remote client
Add a custom MCP connector and pass your courier keys as headers (or query params):

```
https://courier.auraajenticai.cloud/mcp
```

Headers: `x-steadfast-api-key`, `x-steadfast-secret-key`, `x-pathao-client-id`, `x-pathao-client-secret`, `x-pathao-username`, `x-pathao-password`, `x-redx-api-token`, `x-paperfly-api-key`, `x-paperfly-store-name`, `x-paperfly-username`, `x-paperfly-password`.

### 2) Local (npx / STDIO) — Antigravity, Claude Desktop, Cursor
Add only the couriers you use — each is independent. Your keys stay on your side (env vars or request headers); **Aura never stores them**.

#### 🪐 Google Antigravity / Gemini CLI — `antigravity.json`
```json
{
  "mcpServers": {
    "aura-courier": {
      "command": "npx",
      "args": ["-y", "aura-courier-mcp@latest"],
      "env": {
        "STEADFAST_API_KEY": "YOUR_STEADFAST_API_KEY",
        "STEADFAST_SECRET_KEY": "YOUR_STEADFAST_SECRET_KEY",
        "REDX_API_TOKEN": "YOUR_REDX_TOKEN",
        "PAPERFLY_API_KEY": "YOUR_PAPERFLY_KEY",
        "PAPERFLY_STORE_NAME": "YOUR_STORE_NAME",
        "PAPERFLY_USERNAME": "YOUR_PAPERFLY_USERNAME",
        "PAPERFLY_PASSWORD": "YOUR_PAPERFLY_PASSWORD"
      }
    }
  }
}
```

#### ⚡ Claude Desktop — `claude_desktop_config.json`  &  💻 Cursor / VS Code — `settings.json`
```json
{
  "mcpServers": {
    "aura-courier": {
      "command": "npx",
      "args": ["-y", "aura-courier-mcp@latest"],
      "env": {
        "STEADFAST_API_KEY": "YOUR_STEADFAST_API_KEY",
        "STEADFAST_SECRET_KEY": "YOUR_STEADFAST_SECRET_KEY"
      }
    }
  }
}
```

---

## 📋 Courier notes

- **Steadfast / Pathao** — API key + secret (Pathao also needs client id/secret + username/password). `get_balance` is available for these two.
- **RedX** — API access token (`REDX_API_TOKEN`); delivery area is auto-resolved from the address, or pass `delivery_area_id`.
- **Paperfly** — needs the `paperflykey` **and** your merchant username/password on both create *and* track, plus your store name.
- **`check_fraud_risk`** runs keyless — a COD gate you can call before booking anything.

---

## 💬 Then just ask your AI

> "Book a Steadfast parcel for invoice A-1001, COD 1500 to 017XXXXXXXX."
> "Create a RedX parcel to Dhanmondi, COD 900."
> "Track consignment 20A316MOG0DI."
> "Check the return risk for 018XXXXXXXX before I ship COD."

---

## 🏗️ Architecture

```
AI agent (Antigravity / Claude / Cursor / n8n)
        │   MCP (STDIO or Streamable-HTTP)
        ▼
  Aura Courier MCP  ──►  Registry (gateway + smart router)  ──►  Courier adapters
                                                                 ├── Steadfast  (Packzy API)
                                                                 ├── Pathao     (Aladdin API)
                                                                 ├── RedX       (OpenAPI)
                                                                 └── Paperfly   (Wingman API)
                                                        + built-in BD phone fraud-risk engine
```

Keys are read per-request (headers) or per-process (env) — never persisted.

---

## 🔒 Privacy Policy

Aura Courier MCP processes only what's needed to fulfil your request: your **courier credentials** (passed per-request as headers/env — **never stored** by Aura), the **order details** you send to book/track a parcel, and **phone numbers** you submit to `check_fraud_risk`. Order data is forwarded only to the courier you choose (Steadfast / Pathao / RedX / Paperfly) to complete the operation; nothing is sold or used for profiling, and credentials live only in memory for the active session. All traffic is over HTTPS.

**Full policy:** https://courier.auraajenticai.cloud/privacy · **Contact:** ceo@auraajenticai.cloud

## 📜 The vision

> **মানুষের স্বপ্ন · এআই-এর হাত**
> Aura is building Bangladesh's native agentic-commerce layer — unifying courier logistics, digital payments, and AI automation so any AI in the world can natively transact with Bangladeshi businesses. This MCP is the first brick.

---

Licensed under **MIT** © Aura Ajentic AI.
