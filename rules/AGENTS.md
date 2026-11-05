# Aura Courier Logistics Master Operational Guidelines

When interacting with Bangladesh courier services, parcel bookings, fraud checks, or address validation, you MUST follow these operational guidelines:

## 1. Zero Mock Data Mandate
- Never return fabricated delivery percentages, fake risk scores, dummy balances, or mock tracking updates.
- All metrics must originate from live carrier APIs (Steadfast, Pathao, RedX, Paperfly) via the `aura-courier` MCP tools.

## 2. Smart Auto-Routing Hierarchy
- **Dhaka Metro**: Prioritize Pathao Express (12–24h SLA, ৳60) ➔ RedX ➔ Steadfast ➔ Paperfly.
- **Sub-Dhaka (Savar, Gazipur, Narayanganj, Keraniganj)**: Prioritize Paperfly (৳90) / Steadfast (৳100) ➔ Pathao ➔ RedX.
- **Outside Dhaka (64 Districts & Nationwide)**: Prioritize Steadfast Courier (nationwide door-to-door network) ➔ Paperfly (৳110) ➔ Pathao ➔ RedX.

## 3. Address Geocoding & Phone Sanitization
- Validate recipient phone numbers against `^01[3-9]\d{8}$` before booking.
- Parse addresses through Division ➔ District ➔ Thana/Upazila ➔ Sublocality ➔ Street hierarchy using Google Maps Platform Geocoding API (`validate_and_geocode_address`).
- Never send dummy city/zone IDs.

## 4. Multi-Tenant Security
- Isolate merchant credentials and consignment queries strictly by `tenant` and `clientId`.

## 5. Customer NDR Recovery Protocol
- Keep customer WhatsApp/SMS messages concise (2–3 sentences max).
- Use respectful honorifics: "স্যার" for tech/hardware service brands, "আপু/ভাইয়া" for retail/skincare brands.
- Never output markdown link brackets in customer chat copy.
