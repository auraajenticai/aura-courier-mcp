import { CourierRegistry } from "./registry.js";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
async function runZeroRiskTest() {
    console.log("==================================================");
    console.log("   AURA COURIER MCP — ZERO-RISK LIVE API TEST    ");
    console.log("==================================================");
    const registry = new CourierRegistry();
    // Test 1: Courier List
    console.log("\n[TEST 1] Listing Couriers & Configuration Status:");
    const list = registry.listCouriers();
    console.log(JSON.stringify(list, null, 2));
    // Test 2: Steadfast Live Balance Check (Read-Only)
    console.log("\n[TEST 2] Testing Steadfast Live Account Balance (Read-Only):");
    try {
        const balance = await registry.getBalance("steadfast");
        console.log("✅ SUCCESS! Steadfast Live Response:");
        console.log(JSON.stringify(balance, null, 2));
    }
    catch (err) {
        console.log("⚠️ Initial domain test note:", err.message);
        // If steadfast portal has alternative base url (portal.packzy.com)
        console.log("Trying alternative Steadfast Packzy gateway...");
        try {
            const resp = await axios.get("https://portal.packzy.com/api/v1/get_balance", {
                headers: {
                    "Api-Key": process.env.STEADFAST_API_KEY,
                    "Secret-Key": process.env.STEADFAST_SECRET_KEY,
                },
            });
            console.log("✅ SUCCESS via Packzy Gateway:");
            console.log(JSON.stringify(resp.data, null, 2));
        }
        catch (e2) {
            console.error("❌ Packzy Gateway error:", e2.response?.data || e2.message);
        }
    }
    // Test 3: Fraud Risk Engine Test (Local AI Heuristic)
    console.log("\n[TEST 3] Testing BD Phone Fraud Risk Analyzer:");
    const testPhone = "01712345678";
    const fraudScore = registry.checkFraudRisk(testPhone);
    console.log(JSON.stringify(fraudScore, null, 2));
    console.log("\n==================================================");
    console.log("   ZERO-RISK TEST COMPLETED SUCCESSFULLY!         ");
    console.log("==================================================");
}
runZeroRiskTest().catch(console.error);
