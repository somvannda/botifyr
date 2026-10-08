#!/usr/bin/env node
/**
 * Pre-flight check for the billing / reminder go-live.
 *
 *   node apps/cloud/scripts/check-billing-env.mjs
 *
 * Reads apps/cloud/.env when present (falling back to the current environment)
 * and reports which provider keys are set, so the 0.01 validation isn't blocked
 * by a missing variable. Exits non-zero when a required group is incomplete.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env");

const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key)
      env[key] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
}

const groups = [
  { label: "Payment (ChmabaPay)", keys: ["CHMABA_BASE_URL", "CHMABA_API_KEY", "CHMABA_WEBHOOK_SECRET"] },
  { label: "Payment store id (one of)", keys: ["CHMABA_STORE", "CHMABA_MERCHANT"], oneOf: true },
  { label: "Email reminders (Resend)", keys: ["RESEND_API_KEY", "MAIL_FROM"] },
  { label: "Telegram reminders", keys: ["TELEGRAM_BOT_TOKEN"] },
];

let incomplete = 0;
for (const group of groups) {
  console.log(`\n${group.label}`);
  const present = group.keys.filter((key) => env[key]);
  for (const key of group.keys) console.log(`  ${env[key] ? "✓" : "✗"} ${key}`);
  const ok = group.oneOf ? present.length > 0 : present.length === group.keys.length;
  if (!ok) incomplete += 1;
}

if (incomplete === 0) {
  console.log("\nAll billing/reminder env vars are set — ready for the 0.01 validation.");
  process.exit(0);
}
console.log(`\n${incomplete} group(s) incomplete — add the keys to apps/cloud/.env.`);
process.exit(1);
