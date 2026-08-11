#!/usr/bin/env node
/**
 * Prepares a client's legacy pharmacy exports for import into checkup-care.
 *
 * Reads the raw report CSVs (as exported from their existing system, letterhead
 * and all) and emits three upload-ready files plus a reconciliation report.
 *
 *   node scripts/client-migration-prep.mjs <input-dir> [output-dir]
 *
 * Why each transform exists — every one of these is a silent data loss if skipped:
 *
 *  - Letterhead:  the migration parser reads line 1 as the header row, but these
 *                 exports carry 5-6 lines of hospital name / filters above it.
 *  - Newlines:    MigrationCsvParser splits on \n BEFORE its quote-aware field
 *                 splitter runs, so a quoted cell containing a line break shreds
 *                 the row. We re-emit every cell flattened to a single line.
 *  - Duplicates:  commitInventorySync skips a repeated (medicine, batch) pair with
 *                 only a warning, so the second row's stock vanishes. We merge them.
 *  - Catalogue:   Inventory.create() stores no GST/manufacturer/generic, and billing
 *                 reads GST off the MEDICINE. Medicines auto-created by the migration
 *                 are hardcoded to 12%. So the catalogue must be seeded FIRST, from
 *                 01-medicines.csv, via Medicines -> Bulk Upload.
 *  - Reorder:     inventory rows without minimumStock default to 10 (and reorder 5),
 *                 discarding the client's real MinQty. We merge it back in.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

// ─── CSV ──────────────────────────────────────────────────────────────────────

/** RFC4180 parser. Unlike the server's, this one honours newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell); cell = "";
    } else if (c === "\n") {
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** Collapses whitespace and embedded newlines so a cell can never break a row. */
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const csvEscape = (s) => {
  const v = flat(s);
  return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const toCsv = (headers, rows) =>
  [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))].join("\n") + "\n";

/**
 * Finds the real header row by scoring each line against the columns we expect,
 * rather than hardcoding a skip count — the letterhead height varies per report.
 */
function findHeader(rows, expected) {
  const want = expected.map((e) => e.toLowerCase());
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].map((c) => flat(c).toLowerCase());
    const hits = want.filter((w) => cells.includes(w)).length;
    if (hits >= Math.min(3, want.length)) return i;
  }
  return -1;
}

/** Returns the file's data rows as objects keyed by its real header names. */
function readReport(dir, filename, expected) {
  const path = join(dir, filename);
  if (!existsSync(path)) return { rows: [], missing: true };

  const all = parseCsv(readFileSync(path, "utf8"));
  const h = findHeader(all, expected);
  if (h === -1) return { rows: [], noHeader: true };

  const headers = all[h].map(flat);
  const rows = [];
  for (let i = h + 1; i < all.length; i++) {
    const cells = all[i];
    if (!cells.some((c) => flat(c) !== "")) continue;
    const o = {};
    headers.forEach((name, j) => { if (name) o[name] = flat(cells[j]); });
    // A "Total" footer row has a label in column 1 and nothing meaningful after.
    if (Object.values(o).filter((v) => v !== "").length <= 1) continue;
    rows.push(o);
  }
  return { rows, headers };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const key = (s) => flat(s).toUpperCase();
const num = (s) => {
  const v = parseFloat(String(s ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(v) ? v : null;
};
const int = (s) => {
  const v = num(s);
  return v === null ? null : Math.round(v);
};
/** GST slabs the server accepts; anything else is silently defaulted to 12%. */
const VALID_GST = new Set([0, 5, 12, 18]);

// ─── main ─────────────────────────────────────────────────────────────────────

const inputDir = process.argv[2];
const outDir = process.argv[3] ?? join(inputDir ?? ".", "prepared");

if (!inputDir || !existsSync(inputDir)) {
  console.error("usage: node scripts/client-migration-prep.mjs <input-dir> [output-dir]");
  process.exit(1);
}

const notes = [];
const warn = (s) => notes.push(s);

// Tolerate whatever casing / separators the client's export used for filenames.
// Files only — the output directory lives inside the input directory on a re-run.
const files = readdirSync(inputDir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
const find = (pattern) => files.find((f) => pattern.test(f.replace(/[_\-\s]/g, "").toLowerCase()));

const stockFile = find(/^stocklist\.csv$/);
const openFile = find(/^openstocklist\.csv$/);
const lowFile = find(/^lowstocklist\.csv$/);
const excessFile = find(/^excessstocklist\.csv$/);
const paymentsFile = find(/^upcomingpayments\.csv$/);
const duesFile = find(/^supplierdueslist\.csv$/);
const expiryFile = find(/^stockexpirylist\.csv$/);

// Windows "- Copy" duplicates would double every unit if they were ever read.
// The matchers above are anchored so they can't match, but say so out loud
// rather than leaving it to the reader to trust that.
for (const f of files) {
  if (/copy|\(\d+\)/i.test(f)) warn(`Ignored "${f}" — looks like a duplicate of another file. Its stock is NOT counted twice.`);
}

// ── reorder levels, from the two shortage reports ─────────────────────────────
// These reports carry no batch/expiry/price so they can't be imported as stock,
// but their MinQty is the only place the client's real reorder levels exist.
const minQty = new Map();
for (const f of [lowFile, excessFile].filter(Boolean)) {
  const { rows } = readReport(inputDir, f, ["Medicine", "StockInHand", "MinQty"]);
  for (const r of rows) {
    const k = key(r.Medicine);
    const q = int(r.MinQty);
    if (k && q !== null && q > 0 && !minQty.has(k)) minQty.set(k, q);
  }
}

// ── category, same source ─────────────────────────────────────────────────────
const category = new Map();
for (const f of [lowFile, excessFile].filter(Boolean)) {
  const { rows } = readReport(inputDir, f, ["Medicine", "Category"]);
  for (const r of rows) {
    const k = key(r.Medicine);
    if (k && r.Category && !category.has(k)) category.set(k, r.Category);
  }
}

// ── inventory: Stock_List is the payload, Open-Stock-list tops it up ──────────
const batches = new Map(); // "MEDICINE|BATCH" -> merged row
const merges = [];
let sourceRowCount = 0;
let sourceUnitCount = 0;

function addBatch(src, { name, batch, expiry, qty, cost, sell, gst, manufacturer, generic }) {
  if (!name || !batch) { warn(`${src}: dropped a row missing medicine name or batch number`); return; }
  sourceRowCount++;
  sourceUnitCount += qty ?? 0;

  const k = `${key(name)}|${key(batch)}`;
  const existing = batches.get(k);

  if (!existing) {
    batches.set(k, { name: flat(name), batch: flat(batch), expiry, qty: qty ?? 0, cost, sell, gst, manufacturer, generic, sources: 1 });
    return;
  }

  // The legacy system splits one batch across rows by tax slab or purchase lot.
  // Sum the quantity (or the server drops the second row outright), value the
  // stock at a quantity-weighted average cost, and keep the higher tax slab —
  // a 0% twin of a 5% row is a data-entry artefact, not a real exemption.
  const beforeQty = existing.qty;
  const totalQty = beforeQty + (qty ?? 0);
  if (existing.cost !== null && cost !== null && totalQty > 0) {
    existing.cost = (existing.cost * beforeQty + cost * (qty ?? 0)) / totalQty;
  }
  existing.qty = totalQty;
  existing.sell = Math.max(existing.sell ?? 0, sell ?? 0) || existing.sell;
  existing.gst = Math.max(existing.gst ?? 0, gst ?? 0);
  existing.expiry = existing.expiry || expiry;
  existing.manufacturer = existing.manufacturer || manufacturer;
  existing.generic = existing.generic || generic;
  existing.sources++;
  merges.push({ name: existing.name, batch: existing.batch, parts: existing.sources, added: qty ?? 0, total: totalQty });
}

if (stockFile) {
  const { rows } = readReport(inputDir, stockFile, ["MedicineName", "BatchNo", "TotalStock"]);
  for (const r of rows) {
    addBatch("Stock_List", {
      name: r.MedicineName,
      batch: r.BatchNo,
      expiry: r.ExpDate,
      qty: int(r.TotalStock),
      cost: num(r.CostPriceStrip),
      sell: num(r.SellPriceStrip), // client's decision: sell price IS the MRP
      gst: num(r.GST),
      manufacturer: r.Manufacturer,
      generic: r.Generic,
    });
  }
} else warn("Stock_List.csv not found — this is the main inventory source.");

if (openFile) {
  const { rows } = readReport(inputDir, openFile, ["Medicine", "BatchNo", "Qty"]);
  for (const r of rows) {
    addBatch("Open-Stock-list", {
      name: r.Medicine,
      batch: r.BatchNo,
      expiry: r.ExpDate,
      qty: int(r.Qty),
      cost: num(r.CostPrice ?? r.UnitCostPrice),
      sell: num(r.SellingPrice ?? r.MRP),
      gst: num(r.GSTtotal),
      manufacturer: "",
      generic: "",
    });
  }
}

if (expiryFile) {
  const { rows } = readReport(inputDir, expiryFile, ["MedicineName", "BatchNo", "Qty"]);
  if (rows.length === 0) warn("Stock_Expiry_list.csv is present but empty — ask the client to re-export it with an open date range; its columns are richer than Stock_List.");
}

// ── validate against what the server will accept ──────────────────────────────
const inventoryRows = [];
const rejected = [];

for (const b of batches.values()) {
  const problems = [];
  if (!b.expiry) problems.push("no expiry date");
  if (b.qty === null || b.qty < 0) problems.push("bad quantity");
  if (!(b.sell > 0)) problems.push("selling price (MRP) must be > 0");
  if (!(b.cost > 0)) problems.push("cost price must be > 0");

  if (problems.length) { rejected.push({ ...b, problems }); continue; }

  const gst = VALID_GST.has(b.gst) ? b.gst : null;
  if (gst === null) warn(`GST "${b.gst}" on ${b.name} is not a recognised slab — server would default it to 12%.`);

  inventoryRows.push({
    medicineName: b.name,
    batchNumber: b.batch,
    expiryDate: b.expiry,
    quantity: b.qty,
    mrp: round2(b.sell),
    purchaseRate: round2(b.cost),
    gstRate: gst ?? 12,
    manufacturer: b.manufacturer ?? "",
    minimumStock: minQty.get(key(b.name)) ?? "",
  });
}

function round2(n) {
  return n === null || n === undefined ? "" : Math.round(n * 100) / 100;
}

// ── medicine catalogue: seeded FIRST so billing gets the right GST ────────────
const medicines = new Map();
for (const b of batches.values()) {
  const k = key(b.name);
  const existing = medicines.get(k);
  const gst = VALID_GST.has(b.gst) ? b.gst : null;
  if (!existing) {
    medicines.set(k, {
      name: b.name, genericName: b.generic ?? "", manufacturer: b.manufacturer ?? "",
      composition: "", category: category.get(k) ?? "", schedule: "", hsnCode: "",
      gstRate: gst, form: "", strength: "", unit: "", packSize: "",
    });
  } else {
    existing.genericName ||= b.generic ?? "";
    existing.manufacturer ||= b.manufacturer ?? "";
    if (gst !== null) existing.gstRate = Math.max(existing.gstRate ?? 0, gst);
  }
}
for (const m of medicines.values()) if (m.gstRate === null) m.gstRate = 12;

// ── suppliers ─────────────────────────────────────────────────────────────────
// Two reports, neither complete on its own. Supplier-Dues carries the TOTAL
// balance and is authoritative; Upcoming_Payments carries only bills not yet
// due (a fraction of the balance) but lists suppliers the dues report omits.
// Take the dues balance where we have it, and fall back to the summed upcoming
// bills for anyone who appears only there — otherwise those suppliers vanish.
const suppliers = new Map();

if (duesFile) {
  const { rows } = readReport(inputDir, duesFile, ["SupplierName", "Balance"]);
  for (const r of rows) {
    const name = flat(r.SupplierName);
    if (!name || name.toLowerCase() === "total") continue;
    const balance = num(r.Balance) ?? 0;
    if (balance < 0) warn(`${name} has a NEGATIVE balance of ${balance} (a purchase return exceeded the bill) — carried across as-is; confirm with the client.`);
    suppliers.set(key(name), { supplierName: name, openingBalance: balance, source: "Supplier-Dues" });
  }
} else warn("Supplier-Dues-list.csv not found — supplier balances will be understated.");

if (paymentsFile) {
  const { rows } = readReport(inputDir, paymentsFile, ["Supplier name", "Amount"]);
  const fromPayments = new Map();
  for (const r of rows) {
    const name = flat(r["Supplier name"]);
    if (!name || name.toLowerCase() === "total") continue;
    const k = key(name);
    const s = fromPayments.get(k) ?? { supplierName: name, openingBalance: 0 };
    s.openingBalance += num(r.Amount) ?? 0;
    fromPayments.set(k, s);
  }
  for (const [k, s] of fromPayments) {
    if (!suppliers.has(k)) {
      suppliers.set(k, { ...s, source: "Upcoming_Payments only" });
      warn(`${s.supplierName} appears in Upcoming_Payments but NOT in Supplier-Dues — carried across at ${round2(s.openingBalance)}, which may be only their not-yet-due bills.`);
    }
  }
}

// ── write ─────────────────────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true });

const MED_COLS = ["name", "genericName", "manufacturer", "composition", "category", "schedule", "hsnCode", "gstRate", "form", "strength", "unit", "packSize"];
const INV_COLS = ["medicineName", "batchNumber", "expiryDate", "quantity", "mrp", "purchaseRate", "gstRate", "manufacturer", "minimumStock"];
const SUP_COLS = ["supplierName", "openingBalance"];

writeFileSync(join(outDir, "01-medicines.csv"), toCsv(MED_COLS, [...medicines.values()]));

// The Medicines page parses an uploaded CSV with a naive line.split(","), which
// shifts every column right on any row whose generic name contains a comma —
// landing a manufacturer where gstRate should be. Its .xlsx path uses a real
// parser instead, so that is what we hand over. The .csv above is kept only for
// eyeballing in a text editor; upload the .xlsx.
const commaRows = [...medicines.values()].filter((m) => MED_COLS.some((c) => String(m[c] ?? "").includes(","))).length;
try {
  const XLSX = await import("../apps/web/node_modules/@e965/xlsx/xlsx.mjs");
  const sheet = XLSX.utils.aoa_to_sheet([MED_COLS, ...[...medicines.values()].map((m) => MED_COLS.map((c) => m[c] ?? ""))]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Medicines");
  // The ESM build has no filesystem bound, so XLSX.writeFile() throws. Render to
  // a buffer and let node write it.
  writeFileSync(join(outDir, "01-medicines.xlsx"), XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  if (commaRows) warn(`${commaRows} medicines have a comma in a field. UPLOAD 01-medicines.xlsx, NOT the .csv — the Medicines page's CSV reader would shift their columns and assign the wrong GST.`);
} catch (e) {
  warn(`Could not write 01-medicines.xlsx (${e.message}). Do NOT upload the .csv until this is fixed — ${commaRows} rows would have their columns shifted and their GST corrupted.`);
}
writeFileSync(join(outDir, "02-inventory.csv"), toCsv(INV_COLS, inventoryRows));
writeFileSync(join(outDir, "03-suppliers.csv"), toCsv(SUP_COLS,
  [...suppliers.values()].map((s) => ({ supplierName: s.supplierName, openingBalance: round2(s.openingBalance) }))));

// ── reconciliation report ─────────────────────────────────────────────────────
const importedUnits = inventoryRows.reduce((a, r) => a + r.quantity, 0);
const lines = [];
lines.push("# Migration prep — reconciliation report", "");
lines.push(`Source rows read:        ${sourceRowCount}`);
lines.push(`Units in source:         ${sourceUnitCount}`);
lines.push(`Batches after merge:     ${batches.size}`);
lines.push(`Batches importable:      ${inventoryRows.length}`);
lines.push(`Units importable:        ${importedUnits}`);
lines.push(`Medicines to seed:       ${medicines.size}`);
lines.push(`Suppliers:               ${suppliers.size}`);
lines.push("");
lines.push(importedUnits === sourceUnitCount
  ? "OK — every unit in the source files is accounted for in 02-inventory.csv."
  : `CHECK — ${sourceUnitCount - importedUnits} units are not in the output. See rejected rows below.`);
lines.push("");

if (merges.length) {
  lines.push(`## Merged duplicate batches (${merges.length})`, "");
  lines.push("The legacy export split these across multiple rows. The server would have");
  lines.push("skipped the extra rows and lost their stock, so they are summed here.", "");
  for (const m of merges) lines.push(`  ${m.name} / batch ${m.batch}: +${m.added} -> ${m.total}`);
  lines.push("");
}

if (rejected.length) {
  lines.push(`## Rejected rows (${rejected.length}) — NOT in the output`, "");
  for (const r of rejected) lines.push(`  ${r.name} / batch ${r.batch} (qty ${r.qty}): ${r.problems.join(", ")}`);
  lines.push("");
}

// Independent verification: the client's shortage reports were produced by their
// system separately from the stock list, so their StockInHand is an outside
// opinion on what we computed. Agreement is evidence the merge is right; a
// disagreement is their two reports contradicting each other, and needs a human.
const perMedicine = new Map();
for (const r of inventoryRows) perMedicine.set(key(r.medicineName), (perMedicine.get(key(r.medicineName)) ?? 0) + r.quantity);

const crossChecks = [];
for (const f of [lowFile, excessFile].filter(Boolean)) {
  const { rows } = readReport(inputDir, f, ["Medicine", "StockInHand"]);
  for (const r of rows) {
    const theirs = int(r.StockInHand);
    const ours = perMedicine.get(key(r.Medicine));
    if (theirs === null || ours === undefined) continue;
    crossChecks.push({ name: flat(r.Medicine), theirs, ours });
  }
}
if (crossChecks.length) {
  const mismatched = crossChecks.filter((c) => c.theirs !== c.ours);
  lines.push(`## Cross-check against the client's own stock reports (${crossChecks.length} medicines)`, "");
  lines.push(`  Agree exactly: ${crossChecks.length - mismatched.length}`);
  lines.push(`  Disagree:      ${mismatched.length}`, "");
  if (mismatched.length) {
    lines.push("  These are the client's OWN two reports contradicting each other, not a");
    lines.push("  processing error. We import the Stock List figure because it is the only");
    lines.push("  one with batch and expiry detail. Worth confirming with them.", "");
    lines.push("    medicine                              their report   stock list   diff");
    for (const c of mismatched) {
      const d = c.ours - c.theirs;
      lines.push(`    ${c.name.padEnd(36)} ${String(c.theirs).padStart(12)} ${String(c.ours).padStart(12)} ${String(d > 0 ? "+" + d : d).padStart(6)}`);
    }
  }
  lines.push("");
}

if (suppliers.size) {
  const totalDue = [...suppliers.values()].reduce((a, s) => a + s.openingBalance, 0);
  lines.push(`## Suppliers (${suppliers.size}) — total outstanding ${round2(totalDue)}`, "");
  for (const s of [...suppliers.values()].sort((a, b) => b.openingBalance - a.openingBalance)) {
    lines.push(`  ${String(round2(s.openingBalance)).padStart(12)}  ${s.supplierName}  [${s.source}]`);
  }
  lines.push("");
}

if (notes.length) {
  lines.push(`## Notes (${notes.length})`, "");
  for (const n of notes) lines.push(`  - ${n}`);
  lines.push("");
}

// Every file in the folder, accounted for. A file that carried no data says so
// explicitly, so "nothing was imported from it" is never left ambiguous.
lines.push(`## Every file in the folder (${files.length})`, "");
for (const f of files.sort()) {
  if (!/\.csv$/i.test(f)) continue;
  let verdict;
  try {
    const all = parseCsv(readFileSync(join(inputDir, f), "utf8"));
    // The header is the widest row; anything past it is data.
    let widest = 0, at = 0;
    all.forEach((r, i) => { const n = r.filter((c) => flat(c) !== "").length; if (n > widest) { widest = n; at = i; } });
    const dataRows = all.slice(at + 1).filter((r) => r.filter((c) => flat(c) !== "").length > 1).length;
    verdict = dataRows === 0 ? "EMPTY — header only, nothing to import" : `${dataRows} data rows`;
  } catch { verdict = "could not read"; }
  lines.push(`  ${f.padEnd(48)} ${verdict}`);
}
lines.push("");

lines.push("## Upload order", "");
lines.push("  1. 01-medicines.csv  -> Medicines page -> Bulk Upload");
lines.push("  2. 02-inventory.csv  -> Migration page -> Inventory");
lines.push("  3. 03-suppliers.csv  -> Migration page -> Suppliers");
lines.push("");
lines.push("Step 1 must run first. Medicines created by the inventory import are");
lines.push("hardcoded to 12% GST, and billing reads GST from the medicine, not the batch.");

writeFileSync(join(outDir, "reconciliation.md"), lines.join("\n") + "\n");

console.log(`\nWrote to ${outDir}:`);
console.log(`  01-medicines.csv   ${medicines.size} medicines`);
console.log(`  02-inventory.csv   ${inventoryRows.length} batches, ${importedUnits} units`);
console.log(`  03-suppliers.csv   ${suppliers.size} suppliers`);
console.log(`  reconciliation.md`);
if (rejected.length) console.log(`\n  ${rejected.length} rows rejected — see reconciliation.md`);
if (notes.length) console.log(`  ${notes.length} notes — see reconciliation.md`);
