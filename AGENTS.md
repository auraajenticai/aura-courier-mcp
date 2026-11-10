# AGENTS.md — aura-courier-mcp v2.5.4 → v2.6.0 hardening

> Works for any coding agent (Claude Code, Codex, Antigravity/Gemini, Cursor).
> Save as `AGENTS.md` in the repo root (Claude Code: also copy/symlink to `CLAUDE.md`; Antigravity/Gemini: `GEMINI.md` if it does not read `AGENTS.md`). Then prompt: **"Read AGENTS.md and execute it end to end."**

Repo: https://github.com/auraajenticai/aura-courier-mcp (Apache-2.0, Node, Streamable-HTTP MCP, protocol 2024-11-05)

---

## 0. Ground rules (read first, obey always)

1. **Discover before editing.** Read the repo (entrypoint, tool registry, courier adapters, webhook handlers, config, existing tests, package.json) and write a 10-line "repo map" at the start of your report. Do not assume file names; the ones used below are placeholders.
2. **Never invent facts.** Anything marked `OBSERVED` below was seen in live behavior. Anything marked `UNVERIFIED` you must confirm from code or by running it, then state the result. If you cannot confirm, say so; do not guess.
3. **Never create real shipments or move money.** Do not call real courier booking, cancel, or payout endpoints. Use mocks/nock/fixtures for upstream APIs. No real customer phone numbers in tests; use `01700000000`-style synthetic values only.
4. **No secrets in code, logs, tests, or the report.** Redact API keys, tokens, and merchant IDs.
5. **Backward compatibility.** Do not rename or remove existing tools or existing response fields. Add new fields. Deprecate loudly in descriptions.
6. **Small, reviewable commits** (one per task ID). Run the full test suite before each commit.
7. **Stop and ask** (end your turn with a question) only if a decision cannot be derived from code or this file, e.g. choosing a hosting secret store. Otherwise decide, document in the report, and continue.
8. **Honest reporting.** If a task is partly done, say exactly which acceptance tests pass and which fail.

---

## 1. Global response envelope (all tools)

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "request_id": "uuid",
    "source": "live_api | static_tariff | cache | validator",
    "as_of": "ISO-8601"
  }
}
```

On failure: `ok:false`, `data:null`, `error:{code,message,retryable,courier?}`.

Error codes: `UNAUTHORIZED`, `INVALID_INPUT`, `CONSIGNMENT_NOT_FOUND`, `COURIER_NOT_CONFIGURED`, `COURIER_UPSTREAM_ERROR`, `UNSUPPORTED_BY_PROVIDER`, `DUPLICATE_INVOICE`.

Never leak raw axios/HTTP error text. Existing top-level fields (e.g. `success`) stay in place alongside the envelope.

---

## 2. Tasks

### T1 — Authentication on `/mcp` and webhooks (P0)

- **Status:** `UNVERIFIED`. The published client config contains only a URL with no credential. First determine from code whether `/mcp` enforces auth. Write the answer into your report.
- **Required:**
  - `Authorization: Bearer <key>` required on `/mcp`. Missing/invalid → HTTP 401 + `UNAUTHORIZED`.
  - Key → tenant → that tenant's courier credentials (no shared global credentials across tenants).
  - Scopes: `read` (track, compare, fraud, geocode, zone, list, balance), `write` (create_parcel, resolve_ndr_issue, and any new write tool).
  - Per-key rate limiting and an audit log (tool, tenant, hash of args, outcome). Do not log raw phone numbers or addresses; hash or mask them.
  - Webhooks `/webhooks/{steadfast,pathao,redx,paperfly}`: verify each courier's secret/signature per its documented scheme; reject unsigned/invalid with 401/403. If a courier does not offer signatures, require a per-tenant secret token in the URL or header and document the limitation.
  - Update README, homepage config snippet, and `/guide` to show the header.
- **Acceptance:** unauthenticated `POST /mcp tools/list` → 401; valid key → tool list; unsigned webhook → rejected.

### T2 — `resolve_ndr_issue` must not claim actions it did not take (P0)

- **OBSERVED:** the tool is documented as generation-only (sends nothing). For input `{consignment_id:"TEST-0000", courier:"steadfast", issue_type:"customer_phone_off"}` it returned `resolution_status:"CUSTOMER_REENGAGED"`, an action text saying a WhatsApp message "has been sent" (`পাঠানো হয়েছে`), and `carrier_instruction:"HOLD_FOR_CONTACT: Reached customer via messaging… on hold at local hub. Do not RTO."` Nothing was sent, and the consignment does not exist (no validation).
- **Required:** verify the consignment exists using the same logic as `track_parcel` (`CONSIGNMENT_NOT_FOUND` if not). Response `data`:

```json
{
  "status": "DRAFT_GENERATED",
  "consignment_verified": true,
  "actions_executed": [],
  "whatsapp_draft": { "language": "bn", "text": "..." },
  "courier_ticket_draft": { "subject": "...", "body": "..." },
  "recommended_carrier_action": "HOLD | RESCHEDULE | CORRECT_ADDRESS | RETURN",
  "requires_manual_execution": true
}
```

- Remove `CUSTOMER_REENGAGED` and any past-tense claims ("sent", "reached", "on hold"). Use suggestive wording only ("প্রস্তাবিত" / "Suggested"). `actions_executed` is non-empty only if a real upstream API call was actually made.
- **Acceptance:** unknown ID → `CONSIGNMENT_NOT_FOUND`; valid ID → `actions_executed == []`, no `CUSTOMER_REENGAGED` anywhere in output.

### T3 — `get_balance` must not return fake zero (P0)

- **OBSERVED:** `get_balance(courier:"pathao")` → `success:true, current_balance:0, raw_response.message:"Pathao payout balance managed via merchant portal"`.
- **Required:** if the provider has no balance API, return:

```json
{ "courier": "pathao", "amount_bdt": null, "pending_bdt": null,
  "status": "UNSUPPORTED_BY_PROVIDER", "hint": "Use Pathao merchant portal" }
```

  Keep `current_balance` only when it is a real number (otherwise `null`). Steadfast returns real numbers plus `as_of`.
- **Acceptance:** Pathao → `amount_bdt: null` and `status: UNSUPPORTED_BY_PROVIDER`.

### T4 — Single pricing source of truth (P1)

- **OBSERVED:**
  - `calculate_delivery_zone_and_fee` uses flat zone fees (Dhaka ≤22 km ৳80, 22–45 km ৳100, >45 km ৳150).
  - `compare_courier_rates` returns per-courier fees (Dhanmondi 0.5 kg: Steadfast 70, Pathao 60, RedX 80, Paperfly 80 + COD 15/15/15/23).
  - SLA inconsistencies: homepage "24–48h"; tool description "24–72h"; Sylhet (236 km) and Chattogram (255 km) return "৭২–৯৬ ঘণ্টা"; Savar returns "৪৮–৭২ ঘণ্টা".
  - Weight surcharges (+20 at 2 kg etc.) match the homepage static table; Chattogram Pathao quote carries a Dhaka-only coverage note.
- **UNVERIFIED (inference):** rates come from a hardcoded table, not live courier rate APIs. Confirm in code.
- **Required:**
  - Create one tariff module (courier × zone × weight slab × COD% × SLA hours). Both tools read it. Generate homepage tables and tool descriptions from it.
  - `meta.source = "static_tariff"` unless a live courier rate API is genuinely called. Remove "real-time rate" wording where false.
  - Use consistent, realistic SLA ranges per zone/courier (propose: inside Dhaka 12–48h, sub-Dhaka 24–72h, outside 48–96h; adjust if courier docs say otherwise and cite the source).
  - `coverage_notes` must be route-specific.
  - `calculate_delivery_zone_and_fee` data: `{zone, distance_km, standard_fee_bdt, cod_percent, sla_hours:{min,max}, route_summary}` (keep old fields too).
- **Acceptance:** for the same address, both tools report the same `zone` and `sla_hours`; Chattogram quote has no Dhaka-only note.

### T5 — `validate_and_geocode_address` quality flags (P1)

- **OBSERVED:**
  - Input `"Road 11, House 24, Dhanmondi, Dhaka"` → `formatted_address:"11, house, 24 Dhanmondi Bridge, Dhaka 1209"`, `location_type:"RANGE_INTERPOLATED"`, `thana:""`, `confidence_score:85`, `is_deliverable:true`.
  - Input with `thana:"Uttara"` returned `thana:"Uttara"` (echo of the input), `ROOFTOP`, confidence 98.
  - So `thana` appears to be echoed, not resolved.
- **Required** response data:

```json
{
  "formatted_address": "...",
  "thana_input": "Uttara|null",
  "thana_resolved": "string|null",
  "district": "...", "division": "...",
  "coordinates": {"lat": 0, "lng": 0},
  "location_type": "ROOFTOP|RANGE_INTERPOLATED|GEOMETRIC_CENTER|APPROXIMATE",
  "confidence_score": 0,
  "match_quality": {"road": true, "house": true, "area": true},
  "needs_review": false,
  "warnings": []
}
```

  - Derive `thana_resolved` from Google `address_components` (sublocality / administrative_area_level_3 or equivalent); `null` if absent. Never copy `thana_input` into `thana_resolved`.
  - Cap `confidence_score` at 60 when `location_type != ROOFTOP`.
  - `needs_review = true` when confidence < 70, `thana_resolved` is null, or road/house tokens from the input are missing in `formatted_address`; add a human-readable `warnings` entry.
  - Keep legacy `thana` field but populate it from `thana_resolved` (or `thana_input` marked in `warnings` as unverified).
- **Acceptance:** the Dhanmondi example → `needs_review:true`, `confidence_score <= 60`; thana never equals input unless Google also resolved it.

### T6 — `check_fraud_risk` semantics (P1)

- **OBSERVED:** `check_fraud_risk("01000000000")` → `risk_level:"CRITICAL"`, `delivery_success_rate:"0% (অবৈধ নম্বর / Invalid BD Number)"`, `cancellation_rate:"100%"`, `carrier_source:"operator_prefix_validator"`. `/health` reports `fraud_engine: "Steadfast Nationwide API + BD Prefix Validator"` while the tool description claims "millions of historical consignments nationwide".
- **Required:**
  - `risk_level` enum: `INVALID_NUMBER | NO_HISTORY | LOW | MEDIUM | HIGH | CRITICAL`.
  - Invalid prefix/length → `INVALID_NUMBER`, `delivery_success_rate: null`, `cancellation_rate: null` (not 0%/100%).
  - Add `data_sources: ["steadfast_nationwide","prefix_validator"]` (reflecting what was actually queried), `sample_size`, `coverage_note`.
  - Correct the tool description to match the real data sources (confirm in code which providers are queried).
  - Never log the full phone number; mask as `017****1234` in logs.
- **Acceptance:** invalid number → `INVALID_NUMBER` with null rates; valid number with no history → `NO_HISTORY`.

### T7 — `track_parcel` and uniform error mapping (P1)

- **OBSERVED:** `track_parcel("SF00000000")` → `Aura Courier MCP Error: Request failed with status code 404`.
- **Required:** if `courier` omitted, auto-detect by prefix, then try all configured couriers. If none match → `ok:false`, `error.code:"CONSIGNMENT_NOT_FOUND"`, plus `couriers_checked:[...]`. Map upstream 401 → `COURIER_UPSTREAM_ERROR` (credential issue, non-retryable), 429/5xx/timeout → `COURIER_UPSTREAM_ERROR` with `retryable:true`. Add timeouts and bounded retry with backoff for GETs only (never auto-retry `create_parcel`).
- **Acceptance:** no raw axios text in any tool output.

### T8 — `create_parcel` safety + missing tools (P2)

- **Required:**
  - `dry_run` (default false) returns `{would_book_with, estimated_cost_bdt, validation:{phone_ok,address_ok,needs_review}}` without any upstream booking call.
  - Idempotency by `invoice` (per tenant): repeat call returns the existing consignment with `idempotent_replay:true`; never books twice. Persist the mapping.
  - Real response data: `{consignment_id, tracking_code, courier, routing_reason, cost_estimate_bdt, cancellable_via_api}`.
  - Auto routing (`courier:"auto"`) must record why a courier was chosen.
  - New tools (additive): `cancel_parcel(courier, consignment_id)` where the provider API supports it, else `UNSUPPORTED_BY_PROVIDER`; `bulk_create_parcels(items[], dry_run)` with per-item results; `get_webhook_events(consignment_id?, since?)` over stored webhook events.
  - Update the tool count in `/health`, homepage and README.
- **Acceptance (mocked upstream only):** two identical invoices → one upstream call, second returns `idempotent_replay:true`; `dry_run` makes zero upstream booking calls.

### T9 — `/health` exposure (P2)

- **OBSERVED:** `/health` publicly returns heap/rss/uptime, active sessions, engine names, webhook paths.
- **Required:** public `GET /health` → `{ok, version}` only. Detailed telemetry only with an admin key.
- **Acceptance:** unauthenticated `/health` has no heap/session/engine fields.

---

## 3. Test plan (all must pass in CI; mock every upstream)

| # | Test |
|---|---|
| 1 | No/invalid bearer → 401 on `/mcp`; unsigned webhook rejected |
| 2 | `resolve_ndr_issue` unknown id → `CONSIGNMENT_NOT_FOUND`; valid id → `actions_executed == []` and no `CUSTOMER_REENGAGED` |
| 3 | `get_balance` pathao → `amount_bdt:null`, `UNSUPPORTED_BY_PROVIDER` |
| 4 | Same address: zone-fee tool and compare tool agree on `zone` and `sla_hours` |
| 5 | Geocode Dhanmondi example → `needs_review:true`, confidence ≤ 60 when not ROOFTOP; thana not echoed as resolved |
| 6 | `check_fraud_risk("01000000000")` → `INVALID_NUMBER`, null rates |
| 7 | `track_parcel("SF00000000")` → `CONSIGNMENT_NOT_FOUND`, no raw axios text |
| 8 | `create_parcel` same invoice twice → one upstream call; second `idempotent_replay:true` |
| 9 | Chattogram 2 kg quote has no Dhaka-only coverage note |
| 10 | Public `/health` exposes only `ok` and `version` |
| 11 | Snapshot test: every tool response validates against the envelope schema |

---

## 4. Order of work

T1 → T2 → T3 → (T4, T5, T6, T7 in any order) → T8 → T9 → tests green → bump to **v2.6.0** → CHANGELOG.md → update README, homepage, `/guide`, tool descriptions.

---

## 5. Out of scope

- Adding new couriers or changing business pricing numbers (only unify and cite them).
- Touching production credentials or running anything against live courier production APIs.
- Rewriting the project in another language/framework.

---

## 6. Final report format (required)

1. **Repo map** (≤10 lines).
2. **Per task:** status (done / partial / blocked), files changed, commit hash, which acceptance tests pass.
3. **Resolved UNVERIFIED items:** T1 auth status before your change (enforced or not), whether rates were static or live, which providers the fraud engine really queries.
4. **Breaking or behavioral changes** a client must know about.
5. **Manual follow-ups** for the owner (key rotation, secret store, courier webhook reconfiguration).
6. **Test output summary** (counts, failures).

If any of the above could not be done, state it plainly instead of omitting it.
