---
name: courier-ops
description: >-
  Universal Bangladesh Courier Operations & Logistics Automation. Use this skill when
  booking parcels, tracking consignments, checking merchant COD balances, scanning customer
  fraud/return risk, validating Bangladeshi street addresses, computing zone fees, comparing
  carrier rates, or resolving NDR delivery issues across Steadfast, Pathao, RedX, and Paperfly.
---

# Bangladesh Courier Operations & Zero-Risk COD Hub (v2.4.2)

This skill provides complete operational runbooks, tool execution patterns, and domain intelligence for managing nationwide e-commerce logistics across Bangladesh via the **Aura Courier MCP** remote server (`https://courier.auraajenticai.cloud/mcp`).

---

## 1. Tool Catalog & Capabilities (9 Live Production Tools)

The remote MCP server exposes 9 specialized logistics tools:

### 1. `list_couriers`
* **Purpose**: Inspect currently configured carrier credentials (Steadfast, Pathao, RedX, Paperfly) and verify Google Maps Platform spatial routing readiness.
* **Input Schema**:
  ```json
  {}
  ```
* **Sample Prompts**:
  - "List all active couriers and check if Steadfast and Pathao APIs are connected."
  - "Check carrier integration status and Google Maps Platform quota readiness."

---

### 2. `create_parcel`
* **Purpose**: Universal parcel booking engine with dynamic cascading fallback or explicit target carrier. Automatically injects merchant pickup warehouse IDs and resolves spatial parameters.
* **Input Schema**:
  - `invoice` *(string, required)*: Unique order invoice identifier (e.g. `INV-1002`).
  - `recipient_name` *(string, required)*: Customer's full name.
  - `recipient_phone` *(string, required)*: 11-digit Bangladeshi mobile number (regex: `^01[3-9]\d{8}$`).
  - `recipient_address` *(string, required)*: Complete delivery address including house, road, thana, and district.
  - `cod_amount` *(number, required)*: Cash on delivery amount in BDT (pass `0` for prepaid orders).
  - `courier` *(string, optional, enum: `["steadfast", "pathao", "redx", "paperfly", "auto"]`)*: Target carrier. Defaults to `"auto"` (AI zone and SLA routing).
  - `note` *(string, optional)*: Rider delivery instructions (e.g. "হাতে পাওয়ার পর চেক করে নিবে").
  - `item_weight` *(number, optional)*: Parcel weight in KG (default: `0.5`).
  - `item_type` *(string, optional)*: Description of parcel contents (required by RedX).
  - `value` *(number, optional)*: Declared value in BDT (defaults to `cod_amount`).
  - `delivery_area_id` *(number, optional)*: RedX numeric delivery-area ID (auto-resolved if omitted).
  - `pickup_store_id` *(number, optional)*: Merchant pickup store ID.
* **Sample Prompts**:
  - "Book an auto-routed parcel for Tania Akter, phone 01711223344, address 'House 12, Road 4, Dhanmondi, Dhaka', COD ৳1,450, invoice 'GT-9081'."
  - "Dispatch invoice 'APP-402' via Steadfast to 'Motaleb Plaza, Hatirpool, Dhaka', phone 01846548010, COD ৳3,500."

---

### 3. `track_parcel`
* **Purpose**: Real-time consignment, invoice, or tracking code lookup across all carrier networks. Normalizes milestones into a single chronological timeline: `Booked` ➔ `Picked Up` ➔ `In Transit` ➔ `Delivered` / `Returned`.
* **Input Schema**:
  - `tracking_code` *(string, required)*: Consignment ID, consignment code, or merchant invoice number (e.g. `DS190926QZNGJT`, `SF12345678`, `REDX123`).
  - `courier` *(string, optional, enum: `["steadfast", "pathao", "redx", "paperfly"]`)*: Carrier name. Auto-detected from prefix if omitted.
* **Sample Prompts**:
  - "Track consignment DS190926QZNGJT and report current delivery status."
  - "Check the latest tracking updates for Steadfast parcel SF987654."

---

### 4. `get_balance`
* **Purpose**: Retrieve merchant current COD balance, pending disbursement amounts, and payout ledger status directly from carrier accounts.
* **Input Schema**:
  - `courier` *(string, required, enum: `["steadfast", "pathao"]`)*: Target carrier to inspect.
* **Sample Prompts**:
  - "What is our current available COD balance in Steadfast?"
  - "Check pending COD payouts on our Pathao merchant account."

---

### 5. `check_fraud_risk`
* **Purpose**: Query nationwide delivery history for any Bangladeshi mobile number across carrier databases. Returns total orders placed, delivered count, canceled/returned count, delivery success rate, and risk tier (`LOW`, `MEDIUM`, `HIGH`). **Zero Mock Data**.
* **Input Schema**:
  - `phone` *(string, required)*: 11-digit Bangladeshi mobile number (e.g. `01712345678`).
* **Sample Prompts**:
  - "Check delivery risk and cancel rate for customer phone 01911877091."
  - "Scan fraud risk for 01606047055 before booking a ৳4,000 COD shipment."

---

### 6. `validate_and_geocode_address`
* **Purpose**: Parse unstructured Bangladeshi addresses into verified administrative divisions, districts, thanas/upazilas, and exact lat/lng coordinates using Google Maps Platform Geocoding API (`gmp_git_agentskills_v1`).
* **Input Schema**:
  - `address` *(string, required)*: Full street or local address (e.g. "Road 11, House 24, Dhanmondi, Dhaka").
  - `thana` *(string, optional)*: Thana or Upazila name.
  - `district` *(string, optional)*: District name.
* **Sample Prompts**:
  - "Geocode and validate this address: 'মিরপুর ১০, ব্লক সি, রোড ৪, বাসা ১২, ঢাকা'."
  - "Parse administrative hierarchy for 'Agrabad C/A, Double Mooring, Chittagong'."

---

### 7. `calculate_delivery_zone_and_fee`
* **Purpose**: Classify delivery destination into standard logistics zones, calculate real driving distance via Google Maps Routes API v2, and determine customer delivery fees:
  - **Inside Dhaka Metro**: ৳80 (12–24h SLA)
  - **Sub-Dhaka / Suburban**: ৳100 (24–48h SLA)
  - **Outside Dhaka (Nationwide)**: ৳150 (48–72h SLA)
* **Input Schema**:
  - `recipient_address` *(string, required)*: Delivery destination address.
  - `origin_address` *(string, optional)*: Merchant warehouse address (defaults to Dhaka Central Hub).
  - `weight_kg` *(number, optional)*: Parcel weight in KG (default: `0.5`).
* **Sample Prompts**:
  - "Calculate delivery zone, fee, and driving distance for 'Chasara, Narayanganj'."
  - "What is the delivery fee and SLA for a 2.5kg parcel to Bogura Sadar?"

---

### 8. `compare_courier_rates`
* **Purpose**: Side-by-side multi-carrier tariff and SLA comparison engine. Compares base delivery fees, COD commission percentages, and transit times across Steadfast, Pathao, RedX, and Paperfly.
* **Input Schema**:
  - `recipient_address` *(string, required)*: Delivery destination address anywhere in Bangladesh.
  - `weight_kg` *(number, optional)*: Parcel weight in KG (default: `0.5`).
  - `cod_amount` *(number, optional)*: Cash on delivery amount in BDT (default: `0`).
  - `priority` *(string, optional, enum: `["cheapest", "fastest", "balanced"]`)*: Optimization goal.
* **Sample Prompts**:
  - "Compare courier rates for a 1kg parcel of ৳2,000 COD going to Sylhet Zindabazar with 'cheapest' priority."
  - "Show fastest vs cheapest courier options for Uttara Sector 3, Dhaka."

---

### 9. `resolve_ndr_issue`
* **Purpose**: Non-Delivery Report (NDR) automated triage. Diagnoses delivery exceptions (fake attempt by rider, customer phone off, wrong address, customer requested reschedule) and generates tailored Bengali customer WhatsApp recovery messages and carrier hold instructions.
* **Input Schema**:
  - `consignment_id` *(string, required)*: Consignment tracking ID.
  - `courier` *(string, required, enum: `["steadfast", "pathao", "redx", "paperfly"]`)*: Courier provider.
  - `issue_type` *(string, required, enum: `["customer_phone_off", "reschedule_requested", "wrong_address", "customer_refused", "fake_attempt"]`)*: Reason for failed delivery.
  - `customer_phone` *(string, optional)*: Customer mobile number.
  - `customer_name` *(string, optional)*: Customer full name.
  - `reschedule_date` *(string, optional)*: Preferred new delivery date.
  - `corrected_address` *(string, optional)*: Updated delivery address.
* **Sample Prompts**:
  - "Rider reported customer phone off for consignment SF88291. Generate NDR recovery WhatsApp copy and dispute instructions for Steadfast."
  - "Customer requested Sunday delivery for Pathao consignment DS99120. Triage NDR issue with reschedule date 2026-11-08."

---

## 2. Progressive Disclosure & Order Lifecycle Workflow

When executing parcel fulfillment, follow this 4-step progressive lifecycle:

```
[Customer Address + Phone]
           │
           ▼
 Step 1: Pre-Dispatch Verification
   ├── check_fraud_risk(phone) ➔ Alert if return rate > 30%
   └── validate_and_geocode_address(address) ➔ Resolve Thana & District
           │
           ▼
 Step 2: Rate & Route Optimization
   ├── calculate_delivery_zone_and_fee(address) ➔ Determine standard tariff
   └── compare_courier_rates(address, weight, cod) ➔ Select best carrier
           │
           ▼
 Step 3: Order Booking
   └── create_parcel(courier: 'auto' or target, invoice, details...)
           │
           ▼
 Step 4: Post-Dispatch Tracking & NDR
   ├── track_parcel(tracking_code) ➔ Monitor milestones
   └── resolve_ndr_issue(...) ➔ Triggered on delivery exception
```

---

## 3. Best Practices & Operational Rules

1. **Zero Mock Data Mandate**:
   - Never fabricate delivery stats or pseudo-random metrics.
   - Always return authentic data from live carrier endpoints.
2. **Phone Number Sanitization**:
   - Normalize Bangladeshi mobile numbers to 11 digits starting with `01` (e.g. `+88017...` ➔ `017...`).
3. **Address Quality**:
   - Always verify that the address specifies at minimum: (1) District, (2) Thana/Upazila, and (3) Local area or street.
4. **Polite Bengali Communication**:
   - When generating NDR recovery messages, keep them concise (2–3 sentences max), empathetic, and professional, using respectful honorifics ("স্যার" / "আপু/ভাইয়া").
