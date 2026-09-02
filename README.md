# Aura Courier MCP

Universal Bangladesh courier MCP server — **Steadfast, Pathao, RedX & Paperfly** with a built-in **fraud-risk engine** — for Claude, Antigravity, Cursor, n8n and any MCP-compatible AI agent. Book and track parcels across Bangladesh by just telling your AI.

By **Aura Ajentic AI** · [auraajenticai.cloud](https://auraajenticai.cloud) · ✓ Verified on Glama

## Tools

| Tool | What it does |
|------|--------------|
| `list_couriers` | Show supported couriers and which credentials are active |
| `create_parcel` | Book a parcel (Steadfast / Pathao / RedX / Paperfly, or `auto`) |
| `track_parcel` | Track a shipment by tracking / consignment / reference id |
| `get_balance` | Merchant account balance (Steadfast / Pathao) |
| `check_fraud_risk` | Delivery/return-risk score for a Bangladeshi phone number |

## Two ways to connect

### 1) Remote URL — claude.ai web, n8n, any remote client

Add this as a custom MCP connector and pass your courier keys as headers (or query params):

```
https://courier.auraajenticai.cloud/mcp
```

Headers: `x-steadfast-api-key`, `x-steadfast-secret-key`, `x-pathao-client-id` …, `x-redx-api-token`, `x-paperfly-api-key`, `x-paperfly-store-name`, `x-paperfly-username`, `x-paperfly-password`.

### 2) Local (npx) — Claude Desktop, Cursor, Antigravity

```json
{
  "mcpServers": {
    "aura-courier": {
      "command": "npx",
      "args": ["-y", "aura-courier-mcp@latest"],
      "env": {
        "STEADFAST_API_KEY": "…",
        "STEADFAST_SECRET_KEY": "…",
        "REDX_API_TOKEN": "…",
        "PAPERFLY_API_KEY": "…",
        "PAPERFLY_STORE_NAME": "…",
        "PAPERFLY_USERNAME": "…",
        "PAPERFLY_PASSWORD": "…"
      }
    }
  }
}
```

Add only the couriers you use — each is independent. Your keys stay on your side (env vars or request headers); they are never stored by Aura.

## Courier notes

- **Steadfast / Pathao** — API key + secret (Pathao also needs client id/secret + username/password).
- **RedX** — API access token (`REDX_API_TOKEN`). Delivery area is auto-resolved from the address, or pass `delivery_area_id`.
- **Paperfly** — needs **both** the `paperflykey` **and** your merchant username/password on create *and* track, plus your store name.
- `get_balance` is available for Steadfast & Pathao (RedX/Paperfly don't expose a balance API).

## Then just ask

> "Book a Steadfast parcel for invoice A-1001, COD 1500 to 017XXXXXXXX."
> "Create a RedX parcel to Dhanmondi, COD 900."
> "Track consignment 20A316MOG0DI."

## License

MIT © Aura Ajentic AI
