# 🚀 Aura Courier MCP — Bangladesh's 1st Universal Courier Model Context Protocol

[![Glama Verified](https://img.shields.io/badge/Glama-Verified%20Server-38bdf8.svg)](https://glama.ai/mcp/servers/auraajenticai/aura-courier-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP Standard](https://img.shields.io/badge/MCP%20SDK-1.0-8b5cf6.svg)](https://modelcontextprotocol.io)
[![Couriers Supported](https://img.shields.io/badge/Couriers-Steadfast%20%7C%20Pathao%20%7C%20RedX%20%7C%20Paperfly-46d17f.svg)](https://courier.auraajenticai.cloud)

> **One unified Model Context Protocol connector for every Bangladesh courier.**  
> Book deliveries, track parcels, inspect merchant balances, and analyze customer return fraud directly from **Google Antigravity**, **Claude Desktop**, **Cursor**, and **n8n AI Agents**.

🌐 **Showcase & Docs:** [https://courier.auraajenticai.cloud](https://courier.auraajenticai.cloud)  
🏢 **Developed by:** [Aura Agentic AI](https://auraajenticai.cloud) & Khondokar Towsif

---

## ⚡ Supported Couriers (All 4 Live)

1. 🟢 **Steadfast Courier** — API v1 (Live verified on Packzy Gateway)
2. 🟢 **Pathao Courier** — Aladdin API v1 (OAuth token + City & Zone resolver)
3. 🟢 **RedX Courier** — OpenAPI v1.0.0 (Area resolver & Tracking)
4. 🟢 **Paperfly Courier** — Wingman API (Order placement & Tracking)

---

## 🧠 Available MCP Tools

| Tool Name | Description |
| :--- | :--- |
| `create_parcel` | AI Smart Auto-Routing: Books delivery across Steadfast, Pathao, RedX, or Paperfly with normalized response. |
| `track_parcel` | Universal Tracking: Real-time consignment status & timeline across all supported couriers. |
| `get_balance` | Retrieves live merchant account balance and payout details. |
| `check_fraud_risk` | **BD Phone Fraud AI:** Analyzes customer phone number return & fraud risk score before booking COD. |
| `list_couriers` | Displays all registered adapters and checks which credentials are active. |

---

## 🛠️ Quick Installation & Configuration

### 🪐 1. Google Antigravity & Gemini CLI (`antigravity.json`)
```json
{
  "mcpServers": {
    "aura-courier": {
      "command": "npx.cmd",
      "args": ["-y", "aura-courier-mcp@latest"],
      "env": {
        "STEADFAST_API_KEY": "YOUR_STEADFAST_API_KEY",
        "STEADFAST_SECRET_KEY": "YOUR_STEADFAST_SECRET_KEY",
        "REDX_API_TOKEN": "YOUR_REDX_TOKEN",
        "PAPERFLY_KEY": "YOUR_PAPERFLY_KEY"
      }
    }
  }
}
```

### ⚡ 2. Claude Desktop (`claude_desktop_config.json`)
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

### 💻 3. Cursor / VS Code (`settings.json`)
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

## 🏗️ Architecture

```
MCP tools  ──►  Registry (Gateway & Smart Router)  ──►  Courier Adapters
                                                        ├── Steadfast  (Live)
                                                        ├── Pathao     (Live)
                                                        ├── RedX       (Live)
                                                        └── Paperfly   (Live)
```

---

## 📜 The Vision
> **মানুষের স্বপ্ন · এআই-এর হাত**  
> Aura is building Bangladesh's native agentic commerce layer — unifying courier logistics, digital payments, and AI automation so any AI in the world can natively interact with Bangladeshi businesses.

Licensed under **MIT**. Developed by **Aura Agentic AI**.
