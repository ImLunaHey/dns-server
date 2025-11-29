#!/usr/bin/env node

/**
 * Quick script to enable DoT via API
 * Usage: node enable-dot.js
 *
 * Note: You need to be logged in to the web UI first to get a session cookie.
 * Or use the API with an API key.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "server");
const certPath = join(serverDir, "certs", "dot.crt");
const keyPath = join(serverDir, "certs", "dot.key");

// Check if certificates exist
if (!existsSync(certPath) || !existsSync(keyPath)) {
  console.error("✗ Certificates not found!");
  console.error("  Run: node generate-dot-certs.js");
  process.exit(1);
}

const apiUrl = process.env.API_URL || "http://localhost:3001";
const apiKey = process.env.API_KEY || "";

console.log("Enabling DoT via API...");
console.log("");

const response = await fetch(`${apiUrl}/api/settings`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  },
  credentials: "include",
  body: JSON.stringify({
    dotEnabled: true,
    dotPort: 853,
    dotCertPath: certPath,
    dotKeyPath: keyPath,
  }),
});

if (!response.ok) {
  const text = await response.text();
  console.error(
    "✗ Failed to enable DoT:",
    response.status,
    response.statusText
  );
  console.error("  Response:", text);
  console.error("");
  console.error("Make sure:");
  console.error("  1. The API server is running");
  console.error("  2. You are logged in (or set API_KEY env var)");
  console.error("  3. The API is accessible");
  process.exit(1);
}

console.log("✓ DoT enabled via API!");
console.log(`  dotEnabled: true`);
console.log(`  dotPort: 853`);
console.log(`  dotCertPath: ${certPath}`);
console.log(`  dotKeyPath: ${keyPath}`);
console.log("");
console.log("⚠️  You need to restart the DNS server for DoT to start.");
console.log(
  '   After restart, you should see: "🔒 DNS server (DoT) running on port 853"'
);
console.log("");
console.log("To test DoT after restart:");
console.log("  node test-dot.js example.com A");
