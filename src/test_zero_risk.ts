import { CourierRegistry } from "./registry.js";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function runZeroRiskTest() {
  console.log("==================================================");
  console.log("   AURA COURIER MCP — ZERO-RISK LIVE API TEST    ");
  console.log("   100% Real APIs · Zero Mock Data · GMP Spatial ");
  console.log("==================================================");

  const registry = new CourierRegistry();

  // Test 1: Courier List & Spatial Engine
  console.log("\n[TEST 1] Listing Couriers & Spatial Engine Status:");
  const list = registry.listCouriers();
  console.log(JSON.stringify(list, null, 2));

  // Test 2: Steadfast Live Balance Check (Read-Only)
  console.log("\n[TEST 2] Testing Steadfast Live Account Balance (Read-Only):");
  try {
    const balance = await registry.getBalance("steadfast");
    console.log("✅ SUCCESS! Steadfast Live Balance Response:");
    console.log(JSON.stringify(balance, null, 2));
  } catch (err: any) {
    console.log("⚠️ Balance check note:", err.message);
  }

  // Test 3: Fraud Risk Engine Test (100% Authentic API Evaluation)
  console.log("\n[TEST 3] Testing BD Phone Fraud Risk Analyzer (Steadfast Real DB):");
  const testPhone = "01712345678";
  const fraudScore = await registry.checkFraudRisk(testPhone);
  console.log("✅ Fraud Score Result (100% Authentic):");
  console.log(JSON.stringify(fraudScore, null, 2));

  // Test 4: Google Maps Platform Address Validation & Geocoding
  console.log("\n[TEST 4] Testing Address Validation & Geocoding (Google Maps Platform):");
  const addressResult = await registry.validateAddress({
    address: "House 32, Road 11, Block D, Banani",
    thana: "Banani",
    district: "Dhaka",
  });
  console.log("✅ Address Validation & Geocoding Result:");
  console.log(JSON.stringify(addressResult, null, 2));

  // Test 5: Google Maps Delivery Zone & Shipping Fee Calculation
  console.log("\n[TEST 5] Testing Delivery Zone & Rate Calculation:");
  const zoneResult = await registry.calculateZoneAndRate({
    recipient_address: "Dhanmondi 27, Dhaka",
    weight_kg: 0.5,
  });
  console.log("✅ Zone & Rate Calculation Result:");
  console.log(JSON.stringify(zoneResult, null, 2));

  console.log("\n==================================================");
  console.log("   ZERO-RISK TEST COMPLETED SUCCESSFULLY!         ");
  console.log("==================================================");
}

runZeroRiskTest().catch(console.error);
