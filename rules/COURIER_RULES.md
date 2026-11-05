# Aura Courier MCP — Master Operational Rules & Logistics Policies

These operational guidelines govern all automated and interactive parcel dispatches, fraud checks, tracking lookups, and customer communications executed by Antigravity agents across Bangladesh logistics networks.

---

## 1. Zero Mock Data Mandate (Absolute Standard)

1. **No Pseudo-Data or Hardcoded Metrics**:
   - Never fabricate delivery success rates, return risk scores, carrier balances, or tracking milestones.
   - All responses returned to the user or stored in system state must derive directly from authentic carrier APIs (Steadfast, Pathao, RedX, Paperfly) or Google Maps Platform.
2. **Transparent Error Reporting**:
   - If a carrier endpoint returns an error, timeout, or authentication failure, report the exact authentic error code and message. Never suppress carrier errors with fabricated successful payloads.

---

## 2. Multi-Carrier Fallback & Smart Auto-Routing Hierarchy

When `courier: "auto"` is selected or when automatic order dispatch is triggered, agents and routing services MUST adhere to the following geographical and SLA priority matrix:

### Zone 1: Dhaka Metro
* **Primary Carrier**: `Pathao Express` (Fastest intraday SLA: 12–24h, ৳60 base fee).
* **First Failover**: `RedX Delivery` (Reliable metro coverage: ৳60 base fee).
* **Second Failover**: `Steadfast Courier` (Standard metro SLA).
* **Tertiary Failover**: `Paperfly Go`.

### Zone 2: Sub-Dhaka / Suburban Belt
*(Savar, Ashulia, Keraniganj, Gazipur, Tongi, Narayanganj)*
* **Primary Carriers**: `Paperfly Go` (৳90) / `Steadfast Courier` (৳100, 24–48h SLA).
* **First Failover**: `Pathao Express`.
* **Second Failover**: `RedX Delivery`.

### Zone 3: Outside Dhaka (Nationwide 64 Districts & Rural Upazilas)
* **Primary Carrier**: `Steadfast Courier` (Deepest nationwide door-to-door network covering all 495 upazilas with 99% fulfillment rate).
* **First Failover**: `Paperfly Go` (Strong union-level pickup network, ৳110).
* **Second Failover**: `Pathao Express`.
* **Third Failover**: `RedX Delivery`.

---

## 3. Address Geocoding & Validation Policies

1. **Hierarchy Extraction**:
   - Every delivery address must be parsed into the standard Bangladeshi administrative hierarchy:
     $$\text{Division} \longrightarrow \text{District} \longrightarrow \text{Thana / Upazila} \longrightarrow \text{Sublocality / Area} \longrightarrow \text{Street / House}$$
2. **Zero Dummy IDs Rule**:
   - Never inject arbitrary or placeholder IDs (such as `recipient_city: 1, recipient_zone: 1` into Pathao's API), as this causes immediate HTTP 422 Unprocessable Entity errors.
   - If zone or area cannot be unambiguously resolved via Google Maps Geocoding API (`gmp_git_agentskills_v1`), omit those specific fields so that Pathao or RedX server-side auto-populators resolve them from `recipient_address`.
3. **Bangladeshi Mobile Phone Validation**:
   - Every recipient phone number MUST be validated against the official Bangladeshi mobile format:
     ```regex
     ^01[3-9]\d{8}$
     ```
   - Strip leading country codes (`+880`, `880`, `00880`) and trim spaces or dashes before submitting to courier APIs.

---

## 4. Multi-Tenant Data & Credential Security

1. **Credential Isolation**:
   - Merchant credentials (Steadfast API Key/Secret, Pathao OAuth client tokens, RedX bearer tokens, Paperfly credentials) are strictly client-scoped and stored encrypted via AES-256-GCM.
   - An agent handling merchant A must NEVER read, reuse, or leak credentials belonging to merchant B.
2. **Consignment Scoping**:
   - All parcel queries, balance checks, and CSV exports must enforce `tenant` and `clientId` filters. No cross-tenant order visibility is permitted.

---

## 5. Customer NDR Resolution & Communication Protocol

1. **Concise & Direct Copy**:
   - When drafting WhatsApp or SMS recovery messages for failed delivery attempts (Non-Delivery Reports), limit the message to **2–3 sentences max**.
   - State the issue clearly (e.g. rider could not reach by phone) and ask for a convenient reschedule date or alternate phone number.
2. **Polite Bengali Honorifics**:
   - Always use respectful Bengali honorifics based on the merchant persona:
     - For tech/service brands (e.g. Applix BD): address the customer respectfully as **"স্যার"** (never "আপু").
     - For lifestyle/skincare brands (e.g. Glamour's Touch): address the customer warmly as **"আপু/ভাইয়া"**.
3. **Zero Raw Markdown Links**:
   - In WhatsApp and SMS communications, never output raw markdown link syntax (`[text](url)`). Provide plain text URLs or clean formatted instructions.
