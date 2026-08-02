#!/usr/bin/env node
/**
 * One-off check that the Resend key in .env actually sends from this checkout.
 *
 * Usage:
 *   TEST_EMAIL_TO=you@example.com node scripts/send-test-email.mjs
 *   # or set TEST_EMAIL_TO in .env
 *
 * This posts to the same Resend endpoint as the API's EmailService
 * (apps/api-java/.../common/mail/EmailService.java) with the same From format, so a
 * success here means the key and sending domain are good for the API too. It is a
 * standalone script rather than a call into the API because verifying a key should not
 * require booting Spring, Postgres and Redis.
 *
 * Node 20+ only (uses the built-in fetch) — no npm dependency.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env reader — real env vars win, so CI can override without a file. */
function loadEnv() {
  let raw;
  try {
    raw = readFileSync(resolve(repoRoot, ".env"), "utf8");
  } catch {
    return; // No .env is fine as long as the vars are exported.
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM;
const fromName = process.env.EMAIL_FROM_NAME || "Checkup Pharmacy";
const to = process.env.TEST_EMAIL_TO;

const missing = [
  ["RESEND_API_KEY", apiKey],
  ["EMAIL_FROM", from],
  ["TEST_EMAIL_TO", to],
].filter(([, value]) => !value);

if (missing.length > 0) {
  console.error(`[Email] missing: ${missing.map(([name]) => name).join(", ")}`);
  console.error("[Email] set them in .env or the environment, then re-run.");
  process.exit(1);
}

console.log(`[Email] sending from "${fromName}" <${from}> to ${to} …`);

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: `"${fromName}" <${from}>`,
    to,
    subject: "Checkup Pharmacy — test email",
    html: "<p>This is a test send from the checkup-care-pharmacy repo. If you're reading it, Resend is wired up correctly.</p>",
    text: "This is a test send from the checkup-care-pharmacy repo. If you're reading it, Resend is wired up correctly.",
  }),
});

const body = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(`[Email] FAILED (HTTP ${response.status}): ${body.message ?? JSON.stringify(body)}`);
  if (String(body.message ?? "").toLowerCase().includes("domain")) {
    console.error(
      `[Email] EMAIL_FROM (${from}) is not on a domain verified for this key. ` +
        "Verify the domain in the Resend dashboard — do not switch to an unverified sender.",
    );
  }
  process.exit(1);
}

console.log(`[Email] sent — id=${body.id}`);
