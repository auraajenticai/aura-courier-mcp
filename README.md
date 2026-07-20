# Aura Courier MCP

**One [Model Context Protocol](https://modelcontextprotocol.io) connector for every Bangladesh courier.**

Book deliveries and track parcels across Bangladeshi couriers — straight from Claude (or any MCP client) — through a single, consistent interface. Steadfast ships first; **Pathao, RedX, and Paperfly slot in as adapters** behind the same tools.

> Part of the **Aura BD Commerce MCP Suite** — courier + payments, the two things every Bangladeshi online shop needs.

---

## Why one connector, not one-per-courier

A merchant uses several couriers. They should not need a different tool for each. Aura Courier MCP exposes **one** toolset:

| Tool | What it does |
|------|--------------|
| `list_couriers` | Show supported couriers and which are configured |
| `create_parcel` | Book a delivery (`courier: "steadfast" \| "pathao" \| ...`) |
| `track_parcel`  | Get delivery status by consignment id / invoice / tracking code |
| `get_balance`   | Merchant account balance with a courier |

You pick the courier per parcel; the connector routes to the right adapter and returns a **normalized** result — same shape no matter which courier is underneath.

---

## Architecture (adapter / gateway)

```
MCP tools  ──►  Registry (gateway)  ──►  Courier adapters
                                          ├── Steadfast  (live)
                                          ├── Pathao     (next)
                                          ├── RedX        (planned)
                                          └── Paperfly    (planned)
```

- **Normalized domain model** (`src/types.ts`) — every adapter maps its own API into these types, so clients always see one consistent shape.
- **`CourierAdapter` interface** (`src/adapters/base.ts`) — add a courier = implement this and register it. Nothing else changes.
- **Bring-Your-Own credentials** (`src/config.ts`) — each merchant supplies their own courier API keys. Swapping to a hosted, multi-tenant SaaS later touches only this one module.

The moat is not obfuscation — it is **out-executing**: adding couriers fast, behind one stable interface, with reliable normalization.

---

## Install & run

```bash
npm install
npm run build

# configure your Steadfast merchant credentials
cp .env.example .env   # then fill STEADFAST_API_KEY + STEADFAST_SECRET_KEY
```

### Use with Claude Code / Claude Desktop

Add to your MCP config:

```json
{
  "mcpServers": {
    "aura-courier": {
      "command": "node",
      "args": ["/absolute/path/to/aura-courier-mcp/dist/index.js"],
      "env": {
        "STEADFAST_API_KEY": "your-key",
        "STEADFAST_SECRET_KEY": "your-secret"
      }
    }
  }
}
```

Then just ask: *"Book a Steadfast parcel for invoice A-1001, Karim, 01700000000, Mirpur Dhaka, COD 1500"* — and *"track parcel invoice A-1001."*

---

## Development

```bash
npm run dev        # run the server with tsx (no build)
npm run typecheck  # tsc --noEmit
npm run smoke      # offline logic tests (no credentials / no network)
```

---

## Steadfast API reference

Built to the documented Steadfast Courier Limited API v1: base `https://portal.packzy.com/api/v1`, auth via `Api-Key` + `Secret-Key` headers, endpoints `create_order`, `status_by_cid|invoice|trackingcode`, `get_balance`.

---

## Roadmap

- [x] Core gateway + normalized model
- [x] Steadfast adapter (`create_parcel`, `track_parcel`, `get_balance`)
- [ ] Pathao adapter
- [ ] Webhook status updates (delivery-status callbacks)
- [ ] RedX + Paperfly adapters
- [ ] Hosted multi-tenant SaaS (per-merchant credentials + usage billing)

---

Built by **Aura Agentic AI** · MIT License
