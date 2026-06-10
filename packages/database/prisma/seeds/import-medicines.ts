/**
 * Medicine bulk import script
 *
 * Usage (from workspace root):
 *   pnpm --filter @pharmacy/database import:medicines
 *   pnpm --filter @pharmacy/database import:medicines -- /absolute/path/to/file.csv
 *
 * Expects CSV columns (order does not matter):
 *   name, price(₹), Is_discontinued, manufacturer_name, type,
 *   pack_size_label, short_composition1, short_composition2
 *
 * What it does:
 *   1. Skips medicines whose name already exists (case-insensitive)
 *   2. Parses genericName + strength from short_composition1
 *   3. Parses form + packSize + unit from pack_size_label
 *   4. Stores price(₹) as catalogMrp (reference only — never used for billing)
 *   5. Defaults gstRate to 12 (pharmacist corrects at first GRN)
 *   6. Syncs full catalogue to Meilisearch after DB insert
 *   7. Writes scripts/data/import-report.txt with skipped names
 */

import * as path from "path";
import * as fs from "fs";

// Resolve workspace root from this file's location
// __dirname = packages/database/prisma/seeds  →  ../../../../ = workspace root
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");

// Load .env before any other imports that need process.env
import { config } from "dotenv";
config({ path: path.join(WORKSPACE_ROOT, ".env") });

import { PrismaClient } from "@prisma/client";
import { MeiliSearch } from "meilisearch";
import { Redis } from "ioredis";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

const DB_CHUNK  = 500;   // rows per createMany call
const MEILI_CHUNK = 1000; // docs per Meilisearch addDocuments call
const INDEX     = "medicines";

// ── Composition parser ────────────────────────────────────────────────────────
// "Amoxicillin (500mg)"       → genericName: "Amoxicillin",   strength: "500mg"
// "Vitamin D3 (600000IU)"     → genericName: "Vitamin D3",    strength: "600000IU"
// "Salbutamol (2mg/5ml)"      → genericName: "Salbutamol",    strength: "2mg/5ml"
// "Paracetamol"               → genericName: "Paracetamol",   strength: null

function parseComposition(raw: string | null | undefined): {
  genericName: string | null;
  strength: string | null;
} {
  if (!raw?.trim()) return { genericName: null, strength: null };
  const s = raw.trim();
  const match = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (match) {
    return { genericName: match[1]!.trim(), strength: match[2]!.trim() };
  }
  return { genericName: s, strength: null };
}

// ── Pack-size parser ──────────────────────────────────────────────────────────
// "strip of 10 tablets"       → { form: "tablet",    packSize: "10 tablets",  unit: "strip" }
// "bottle of 100 ml Syrup"    → { form: "syrup",     packSize: "100 ml Syrup",unit: "bottle" }
// "packet of 200 MDI Inhaler" → { form: "inhaler",   packSize: "200 MDI Inhaler",unit:"packet" }
// "tube of 20 gm Cream"       → { form: "cream",     packSize: "20 gm Cream", unit: "tube" }

const FORM_PATTERNS: Array<[RegExp, string]> = [
  [/\btablets?\b/i,      "tablet"],
  [/\bcapsules?\b/i,     "capsule"],
  [/\bsyrup\b/i,         "syrup"],
  [/\bsuspension\b/i,    "suspension"],
  [/\binjections?\b/i,   "injection"],
  [/\bcream\b/i,         "cream"],
  [/\bointment\b/i,      "ointment"],
  [/\bgel\b/i,           "gel"],
  [/\bdrops?\b/i,        "drops"],
  [/\b(?:inhaler|mdi)\b/i, "inhaler"],
  [/\bsolution\b/i,      "solution"],
  [/\blozenges?\b/i,     "lozenge"],
  [/\bpowder\b/i,        "powder"],
  [/\bspray\b/i,         "spray"],
  [/\bpatch\b/i,         "patch"],
  [/\bliquid\b/i,        "liquid"],
  [/\bexpectorant\b/i,   "syrup"],
  [/\bsachets?\b/i,      "sachet"],
  [/\blotion\b/i,        "lotion"],
  [/\bserum\b/i,         "serum"],
  [/\bsuppositories?\b/i,"suppository"],
];

const UNIT_WORDS = new Set([
  "strip", "bottle", "packet", "tube", "box", "vial",
  "jar", "sachet", "ampoule", "can", "container", "pouch", "blister",
]);

function parsePackSize(label: string | null | undefined): {
  form: string | null;
  packSize: string | null;
  unit: string | null;
} {
  if (!label?.trim()) return { form: null, packSize: null, unit: null };
  const s = label.trim();

  // Extract leading unit word: "strip of ...", "bottle of ..."
  const unitMatch = s.match(/^(\w+)\s+of\s+/i);
  const unit = unitMatch && UNIT_WORDS.has(unitMatch[1]!.toLowerCase())
    ? unitMatch[1]!.toLowerCase()
    : null;

  // Detect form keyword
  let form: string | null = null;
  for (const [regex, formVal] of FORM_PATTERNS) {
    if (regex.test(s)) { form = formVal; break; }
  }

  // Clean pack size: strip "X of " prefix
  const packSize = s.replace(/^(\w+)\s+of\s+/i, "").trim() || s;

  return { form, packSize, unit };
}

// ── Price column detection ────────────────────────────────────────────────────
// The ₹ symbol may be encoded differently across CSV exports.

function findPriceKey(headers: string[]): string | null {
  return (
    headers.find((h) => /price/i.test(h)) ??
    headers.find((h) => /mrp/i.test(h)) ??
    null
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const csvArg     = process.argv[2];
  const defaultCsv = path.join(WORKSPACE_ROOT, "scripts", "data", "medicines.csv");
  // Resolve relative paths from workspace root, not packages/database
  const csvPath    = csvArg
    ? (path.isAbsolute(csvArg) ? csvArg : path.join(WORKSPACE_ROOT, csvArg))
    : defaultCsv;

  // ── Validate CSV exists ──────────────────────────────────────────────────
  if (!fs.existsSync(csvPath)) {
    console.error(`\n❌  CSV not found at:\n    ${csvPath}`);
    console.error(`\n   Drop your medicines.csv here:\n    ${defaultCsv}\n`);
    process.exit(1);
  }

  console.log(`\n📂  Reading ${csvPath}`);
  const raw = fs.readFileSync(csvPath, "utf-8").replace(/^﻿/, ""); // strip BOM

  const rows = parse(raw, {
    columns:             true,
    skip_empty_lines:    true,
    trim:                true,
    relax_column_count:  true,
  }) as Record<string, string>[];

  if (rows.length === 0) {
    console.error("❌  CSV is empty or could not be parsed\n");
    process.exit(1);
  }

  const headers  = Object.keys(rows[0]!);
  const priceKey = findPriceKey(headers);
  console.log(`📊  Rows found:          ${rows.length.toLocaleString()}`);
  console.log(`🔑  Price column:        ${priceKey ?? "not found (catalogMrp will be null)"}`);

  // ── Load existing names ──────────────────────────────────────────────────
  console.log("\n🔍  Checking existing medicines in DB...");
  const existing     = await prisma.medicine.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((m) => m.name.toLowerCase()));
  console.log(`    Existing medicines:  ${existingNames.size.toLocaleString()}`);

  // ── Prepare insert payload ───────────────────────────────────────────────
  type MedicineRow = {
    name: string;
    genericName: string | null;
    strength: string | null;
    form: string | null;
    packSize: string | null;
    unit: string | null;
    manufacturer: string | null;
    composition: string | null;
    category: string | null;
    isActive: boolean;
    gstRate: number;
    catalogMrp: number | null;
  };

  const toInsert: MedicineRow[] = [];
  const skipped:  string[]       = [];

  for (const row of rows) {
    const name = row["name"]?.trim();
    if (!name) continue;

    if (existingNames.has(name.toLowerCase())) {
      skipped.push(name);
      continue;
    }

    const { genericName, strength } = parseComposition(row["short_composition1"]);
    const { form, packSize, unit }  = parsePackSize(row["pack_size_label"]);

    const comp1 = row["short_composition1"]?.trim();
    const comp2 = row["short_composition2"]?.trim();
    const composition = [comp1, comp2].filter(Boolean).join(" + ") || null;

    const isActive   = row["Is_discontinued"]?.trim().toUpperCase() !== "TRUE";
    const rawPrice   = priceKey ? row[priceKey]?.trim() : null;
    const catalogMrp = rawPrice ? (parseFloat(rawPrice) || null) : null;

    toInsert.push({
      name,
      genericName,
      strength,
      form,
      packSize,
      unit,
      manufacturer: row["manufacturer_name"]?.trim() || null,
      composition,
      category:     row["type"]?.trim() || null,
      isActive,
      gstRate:      12,
      catalogMrp,
    });
  }

  console.log(`\n📦  New medicines to insert: ${toInsert.length.toLocaleString()}`);
  console.log(`⏭️   Duplicates skipped:       ${skipped.length.toLocaleString()}`);

  if (toInsert.length === 0) {
    console.log("\n✅  Nothing new to import — all medicines already exist in DB\n");
    await writeReport(0, skipped);
    await prisma.$disconnect();
    return;
  }

  // ── DB insert in chunks ──────────────────────────────────────────────────
  const t0 = Date.now();
  let inserted = 0;

  for (let i = 0; i < toInsert.length; i += DB_CHUNK) {
    const chunk = toInsert.slice(i, i + DB_CHUNK);
    await prisma.medicine.createMany({ data: chunk });
    inserted += chunk.length;

    const pct     = Math.round((inserted / toInsert.length) * 100);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(
      `\r💾  Inserting... ${inserted.toLocaleString()} / ${toInsert.length.toLocaleString()} (${pct}%) — ${elapsed}s   `,
    );
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅  Inserted ${inserted.toLocaleString()} medicines in ${elapsed}s`);

  // ── Meilisearch full re-sync ─────────────────────────────────────────────
  const meiliHost = process.env["MEILISEARCH_HOST"];
  const meiliKey  = process.env["MEILISEARCH_API_KEY"];

  if (meiliHost && meiliKey) {
    console.log("\n🔎  Syncing full catalogue to Meilisearch...");
    try {
      const meili = new MeiliSearch({ host: meiliHost, apiKey: meiliKey });
      const index = meili.index(INDEX);

      // Ensure index settings match what the API expects
      await index.updateSettings({
        searchableAttributes: ["name", "genericName", "manufacturer", "composition"],
        filterableAttributes: ["category", "schedule", "gstRate", "isActive"],
        sortableAttributes:   ["name"],
        typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
      });

      const all    = await prisma.medicine.findMany({ orderBy: { name: "asc" } });
      let   synced = 0;
      const mt0    = Date.now();

      for (let i = 0; i < all.length; i += MEILI_CHUNK) {
        await index.addDocuments(all.slice(i, i + MEILI_CHUNK));
        synced += Math.min(MEILI_CHUNK, all.length - i);
        const pct = Math.round((synced / all.length) * 100);
        process.stdout.write(`\r🔎  Indexed ${synced.toLocaleString()} / ${all.length.toLocaleString()} (${pct}%)   `);
      }

      const melapsed = ((Date.now() - mt0) / 1000).toFixed(1);
      console.log(`\n✅  Meilisearch synced ${all.length.toLocaleString()} medicines in ${melapsed}s`);

      // Set the Redis cursor so the API's onReady hook skips a redundant full re-sync
      const redisUrl = process.env["REDIS_URL"] ?? process.env["REDIS_URI"];
      if (redisUrl) {
        try {
          const redis     = new Redis(redisUrl);
          const cursorKey = `meilisearch:medicines:lastSyncedAt:${process.env["NODE_ENV"] ?? "development"}`;
          await redis.set(cursorKey, new Date().toISOString());
          await redis.quit();
          console.log("✅  Redis cursor updated — API restart will skip full re-sync");
        } catch {
          // Non-fatal — API will just do a delta sync on next restart
        }
      }
    } catch (err: any) {
      console.warn(`\n⚠️   Meilisearch sync failed: ${err.message}`);
      console.warn("    Restart the API to trigger the incremental sync automatically");
    }
  } else {
    console.log("\n⚠️   MEILISEARCH_HOST or MEILISEARCH_API_KEY not in .env");
    console.log("    Restart the API to sync the search index");
  }

  await writeReport(inserted, skipped);
  console.log("\n🎉  Import complete!\n");
  await prisma.$disconnect();
}

async function writeReport(inserted: number, skipped: string[]) {
  const dir = path.join(WORKSPACE_ROOT, "scripts", "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const lines = [
    `Import completed: ${new Date().toISOString()}`,
    `Inserted:  ${inserted.toLocaleString()}`,
    `Skipped:   ${skipped.length.toLocaleString()} (name already exists in DB)`,
    "",
    ...(skipped.length > 0
      ? ["--- Skipped (duplicates) ---", ...skipped]
      : ["No duplicates found."]),
  ];

  fs.writeFileSync(path.join(dir, "import-report.txt"), lines.join("\n"));
  console.log(`\n📄  Report → scripts/data/import-report.txt`);
}

main().catch((err) => {
  console.error("\n❌  Import failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
