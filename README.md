# Aura Courier MCP

Universal Bangladesh courier MCP server — **Steadfast** & **Pathao** with a built-in **fraud-risk engine** — for Claude, Antigravity, Cursor and any MCP-compatible AI agent. Book and track parcels across Bangladesh by just telling your AI.

By **Aura Ajentic AI** · [auraajenticai.cloud](https://auraajenticai.cloud) · ✓ Verified on Glama

## Tools

| Tool | What it does |
|------|--------------|
| `list_couriers` | Show supported couriers and which credentials are active |
| `create_parcel` | Book a parcel (Steadfast / Pathao / auto smart-routing) |
| `track_parcel` | Track a shipment by tracking / consignment ID |
| `get_balance` | Merchant account balance & payout details |
| `check_fraud_risk` | Delivery/return-risk score for a Bangladeshi phone number |

## Install (add to your AI's MCP config)

```json
{
  "mcpServers": {
    "aura-courier": {
      "command": "npx",
      "args": ["-y", "aura-courier-mcp@latest"],
      "env": {
        "STEADFAST_API_KEY": "your-steadfast-api-key",
        "STEADFAST_SECRET_KEY": "your-steadfast-secret-key",
        "PATHAO_CLIENT_ID": "optional",
        "PATHAO_CLIENT_SECRET": "optional",
        "PATHAO_USERNAME": "optional",
        "PATHAO_PASSWORD": "optional",
        "PATHAO_STORE_ID": "optional"
      }
    }
  }
}
```

Steadfast keys come from your Steadfast merchant panel → **Settings → API**. Pathao is optional — add it only if you use Pathao. Your keys stay on your own machine (passed as environment variables); they are never sent to Aura.

## Then just ask

> "Book a Steadfast parcel for invoice A-1001, COD 1500 to 017XXXXXXXX."
> "Track consignment 123456."

## License

MIT © Aura Ajentic AI
