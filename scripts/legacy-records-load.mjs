#!/usr/bin/env node
/**
 * Turns a client's legacy sales / purchase exports into a single SQL file that
 * loads them into the live tables as historical, view-only records.
 *
 *   node scripts/legacy-records-load.mjs <input-dir> --pharmacy=<pharmacyId>
 *
 * Why this exists rather than a new module: the four target tables already ship
 * in the schema, so loading rows needs no migration and no redeploy.
 *
 * What the client's export does NOT contain, and the consequences:
 *
 *  - No line items, anywhere. Every row is a document total. So these bills can
 *    never move stock, and opening one shows the totals with an empty item list.
 *    Nothing here writes to invoice_items / grn_items / inventory_movements.
 *
 *  - No CGST/SGST split — only a single GST total. Krishnagiri selling locally is
 *    always intra-state, so it is halved (odd paise land on CGST, and SGST takes
 *    the remainder so the two always re-add to the reported total).
 *
 *  - Their GST is computed on the PRE-discount value; ours is post-discount, per
 *    s.15(3) CGST Act (see GstCalculator.calcGstFromMrp). We keep THEIR figure
 *    rather than recomputing, so their filed returns still reconcile, and let
 *    roundOff absorb the difference so each bill still adds up on screen.
 *
 *  - Their "Round_Off" column is not a rounding — it carries arbitrary bill-level
 *    adjustments (bill 3282: 33.75 + 116.00 = 150). We derive roundOff from the
 *    net instead, which reproduces their figure where it really was a rounding.
 *
 * Safety properties, all verified against the code before this was written:
 *
 *  - Supplier dues are untouched. suppliers.ledgerBalance is a STORED running
 *    balance written by GRN confirm(); a raw INSERT never moves it, and nothing
 *    recomputes it from goods_receipt_notes.
 *  - Overdue Bills stays clean. Every overdue query requires paymentDueDate < now,
 *    and we leave paymentDueDate NULL.
 *  - Receivables stay clean. sumPendingCredit() counts only PENDING/PARTIAL, and
 *    every legacy bill is PAID.
 *  - Reports DO include these bills, by design — they carry their original dates,
 *    so day-to-day views stay clean and history appears only when you look back.
 *  - Every row is prefixed `lgcy_` and tagged notes='LEGACY_IMPORT', so the whole
 *    load reverses with four DELETEs (see the emitted rollback file).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── CSV ──────────────────────────────────────────────────────────────────────

/** RFC4180 parser — honours quoted commas and newlines. */
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

const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Finds the real header row — these exports carry 4-7 lines of letterhead above it. */
function findHeader(rows, expected) {
  const want = expected.map((e) => e.toLowerCase());
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map((c) => flat(c).toLowerCase());
    const hits = want.filter((w) => cells.includes(w)).length;
    if (hits >= Math.min(3, want.length)) return i;
  }
  return -1;
}

function readReport(dir, filename, expected) {
  const all = parseCsv(readFileSync(join(dir, filename), "utf8"));
  const h = findHeader(all, expected);
  if (h === -1) return { rows: [], noHeader: true };

  const headers = all[h].map(flat);
  const rows = [];
  for (let i = h + 1; i < all.length; i++) {
    const cells = all[i];
    if (!cells.some((c) => flat(c) !== "")) continue;
    const o = {};
    headers.forEach((name, j) => { if (name) o[name] = flat(cells[j]); });
    // Section labels ("OP Sales Returns") and the "Total" footer carry one cell.
    if (Object.values(o).filter((v) => v !== "").length <= 1) continue;
    rows.push(o);
  }
  return { rows, headers };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const num = (s) => {
  const v = parseFloat(String(s ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(v) ? v : 0;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Both date shapes these exports use, normalised to an instant.
 *
 * 06:00 UTC is 11:30 IST — comfortably inside the same IST calendar day, so the
 * IST-bucketing report queries (which convert AT TIME ZONE on the way out) can
 * never file a bill under the previous or following day.
 */
function toInstant(s) {
  const v = flat(s);
  let m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);           // 12-08-2026
  if (m) return `${m[3]}-${m[2]}-${m[1]} 06:00:00`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);                // 2026-08-12 [10:23 AM]
  if (m) return `${m[1]}-${m[2]}-${m[3]} 06:00:00`;
  return null;
}
const dayOf = (instant) => (instant ? instant.slice(0, 10) : null);

const sqlStr = (s) => (s === null || s === undefined || s === "" ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const sqlNum = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "NULL" : String(round2(n)));

/** Digits only — their export mixes spacing, and some numbers are 9 digits. */
const phoneKey = (s) => flat(s).replace(/\D/g, "");
const nameKey = (s) => flat(s).toUpperCase();

// ─── args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputDir = args.find((a) => !a.startsWith("--"));
const argOf = (k) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : null;
};
const pharmacyId = argOf("pharmacy");
const pharmacyName = argOf("pharmacy-name") ?? "Malar";

if (!inputDir || !existsSync(inputDir)) {
  console.error("usage: node scripts/legacy-records-load.mjs <input-dir> [--pharmacy=<id>] [--pharmacy-name=<text>]");
  process.exit(1);
}

const outDir = join(inputDir, "prepared");
mkdirSync(outDir, { recursive: true });

const files = readdirSync(inputDir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
const find = (re) => files.find((f) => re.test(f.replace(/[_\-\s()]/g, "").toLowerCase()));

const salesFile = find(/^saleslist/);
const purchaseFile = find(/^purchaselist/);
const purchaseReturnFile = find(/^purchasereturnlist/);
const salesReturnFile = find(/^salesreturnlist/);

const notes = [];
const warn = (s) => notes.push(s);

// ─── sales bills → invoices ───────────────────────────────────────────────────

const invoices = [];
if (!salesFile) {
  warn("Sales List not found — no bills will be loaded.");
} else {
  const { rows } = readReport(inputDir, salesFile, ["Bill_No", "Bill_Date", "Patient_Name", "Net_Total"]);
  for (const r of rows) {
    const billNo = flat(r.Bill_No);
    const createdAt = toInstant(r.Bill_Date);
    if (!billNo || !createdAt) { warn(`Sales bill skipped, unreadable number or date: ${JSON.stringify(r).slice(0, 90)}`); continue; }

    const gross = num(r.Bill_Total);      // GST-INCLUSIVE, before discount
    const gst = num(r.GST_Total);
    const discount = num(r.Discount_Amount);
    const net = num(r.Net_Total);         // authoritative amount actually collected

    // Clamped so a 100%-discount bill cannot produce a negative taxable value;
    // roundOff then absorbs the GST, keeping taxable + gst + roundOff = total.
    const taxable = Math.max(0, round2(gross - discount - gst));
    const cgst = round2(gst / 2);
    const sgst = round2(gst - cgst);
    const roundOff = round2(net - taxable - gst);

    invoices.push({
      id: `lgcy_inv_${billNo}`,
      number: `OLD-${billNo}`,
      name: flat(r.Patient_Name) || null,
      phone: phoneKey(r.Mobile_No) || null,
      subtotal: gross,
      discount,
      taxable,
      cgst,
      sgst,
      gst,
      total: net,
      roundOff,
      createdAt,
    });
  }
}

const invoiceByPhoneDate = new Map();
for (const i of invoices) {
  if (!i.phone) continue;
  if (!invoiceByPhoneDate.has(i.phone)) invoiceByPhoneDate.set(i.phone, []);
  invoiceByPhoneDate.get(i.phone).push(i);
}
for (const list of invoiceByPhoneDate.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

// ─── purchases → goods_receipt_notes ──────────────────────────────────────────

const grns = [];

/**
 * Suppliers named anywhere in the two purchase exports, keyed on the normalised
 * name. Any that are not already on file get created, because
 * goods_receipt_notes.supplierId is NOT NULL — without the supplier, the purchase
 * silently disappears.
 *
 * There is NO unique index on (pharmacyId, name), so creation cannot lean on
 * ON CONFLICT and is guarded by NOT EXISTS instead. Matching is upper+trimmed
 * because their export carries trailing spaces ("SRI SHANMUGA AGENCY ").
 */
const suppliers = new Map();

/** Deterministic id from the name, so a re-run reuses the same supplier row. */
function supplierId(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
  return `lgcy_sup_${slug}_${h.toString(36)}`;
}

function noteSupplier(rawName, rawPhone) {
  const key = nameKey(rawName);
  if (!key) return key;
  const phone = phoneKey(rawPhone) || null;
  const prev = suppliers.get(key);
  if (!prev) suppliers.set(key, { id: supplierId(key), name: flat(rawName), phone });
  else if (!prev.phone && phone) prev.phone = phone;
  return key;
}
if (!purchaseFile) {
  warn("Purchase list not found — no GRNs will be loaded.");
} else {
  const { rows } = readReport(inputDir, purchaseFile, ["GRNno", "GRNdate", "Supplier", "NetAmount"]);
  for (const r of rows) {
    const no = flat(r.GRNno);
    const createdAt = toInstant(r.GRNdate);
    const supplier = nameKey(r.Supplier);
    if (!no || !createdAt || !supplier) { warn(`GRN skipped, missing number/date/supplier: ${JSON.stringify(r).slice(0, 90)}`); continue; }
    noteSupplier(r.Supplier);

    grns.push({
      id: `lgcy_grn_${no}`,
      number: `OLD-G-${no}`,
      supplier,
      invoiceNo: flat(r.InvoiceNo) || null,
      invoiceDate: toInstant(r.InvoiceDate),
      total: num(r.NetAmount),
      status: /approved/i.test(r.GRNStatus) ? "CONFIRMED" : "DRAFT",
      createdAt,
    });
  }
}

// ─── purchase returns → supplier_returns ──────────────────────────────────────

const supplierReturns = [];
if (!purchaseReturnFile) {
  warn("Purchase-Return list not found — no supplier returns will be loaded.");
} else {
  const { rows } = readReport(inputDir, purchaseReturnFile, ["ReturnNo", "ReturnDate", "Supplier", "ReturnAmt"]);
  for (const r of rows) {
    const no = flat(r.ReturnNo);
    const createdAt = toInstant(r.ReturnDate);
    const supplier = nameKey(r.Supplier);
    if (!no || !createdAt || !supplier) { warn(`Supplier return skipped: ${JSON.stringify(r).slice(0, 90)}`); continue; }
    // This export is the only one carrying a supplier phone number.
    noteSupplier(r.Supplier, r["Supplier Mobile No"]);

    // The model has no reason column — reason, remarks and the supplier's own
    // invoice reference all go to notes, which is what the UI shows.
    const detail = [flat(r.Reason), flat(r.ReturnRemarks), r.InvNo ? `Inv ${flat(r.InvNo)}` : ""]
      .filter(Boolean).join(" — ");

    supplierReturns.push({
      id: `lgcy_pret_${no}`,
      number: `OLD-PR-${no}`,
      supplier,
      total: num(r.ReturnAmt),
      status: /approved/i.test(r.ReturnStatus) ? "CONFIRMED" : "DRAFT",
      notes: `LEGACY_IMPORT${detail ? ` — ${detail}` : ""}`,
      createdAt,
    });
  }
}

// ─── sales returns → sales_returns ────────────────────────────────────────────
//
// sales_returns.invoiceId is NOT NULL with an FK to invoices, and their export
// carries no link back to the original bill — its return numbers are their own
// 1..n sequence. So each return is matched to the same patient's nearest bill on
// or before the return date, and only when the return does not exceed that bill.
// Anything that cannot be matched that way is left out and listed for the client
// rather than being attached to a guess.

const salesReturns = [];
const unmatchedReturns = [];
if (!salesReturnFile) {
  warn("Sales-Return list not found — no sales returns will be loaded.");
} else {
  const { rows } = readReport(inputDir, salesReturnFile, ["Return Bill No", "Return Bill Date", "Patient Name", "Net Total"]);
  for (const r of rows) {
    const no = flat(r["Return Bill No"]);
    // This report interleaves "OP Sales Returns" / "DS Sales Returns" section
    // headings and a "Total" footer among the data; none carry a numeric number.
    if (!/^\d+$/.test(no)) continue;
    const createdAt = toInstant(r["Return Bill Date"]);
    const phone = phoneKey(r["Mobile No"]);
    const gross = num(r["Bill Total"]);
    const gst = num(r["GST Total"]);
    const net = num(r["Net Total"]);
    if (!no || !createdAt) { warn(`Sales return skipped, unreadable number or date: ${no}`); continue; }

    const candidates = (invoiceByPhoneDate.get(phone) ?? [])
      .filter((i) => dayOf(i.createdAt) <= dayOf(createdAt) && i.subtotal + 0.01 >= gross);
    const match = candidates[candidates.length - 1];

    if (!match) {
      unmatchedReturns.push({ no, date: dayOf(createdAt), name: flat(r["Patient Name"]), phone, net });
      continue;
    }

    const cgst = round2(gst / 2);
    salesReturns.push({
      id: `lgcy_sret_${no}`,
      number: `OLD-SR-${no}`,
      invoiceId: match.id,
      phone: phone || null,
      subtotal: gross,
      taxable: Math.max(0, round2(gross - gst)),
      cgst,
      sgst: round2(gst - cgst),
      gst,
      total: net,
      reason: `Imported from previous software — original bill matched to ${match.number} by patient and date`,
      createdAt,
    });
  }
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const ctx = pharmacyId
  ? `SELECT p.id AS pharmacy_id,
       (SELECT u.id FROM users u WHERE u."pharmacyId" = p.id ORDER BY u."createdAt" LIMIT 1) AS user_id
  FROM pharmacies p WHERE p.id = ${sqlStr(pharmacyId)}`
  : `SELECT p.id AS pharmacy_id,
       (SELECT u.id FROM users u WHERE u."pharmacyId" = p.id ORDER BY u."createdAt" LIMIT 1) AS user_id
  FROM pharmacies p WHERE p.name ILIKE ${sqlStr(`%${pharmacyName}%`)}`;

/**
 * One INSERT..SELECT per chunk; literals only, so there is no parameter limit.
 * Returns the statements separately so --split can distribute them across files.
 */
function chunked(rows, size, render) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(render(rows.slice(i, i + size)));
  return out;
}

const sql = [];

/**
 * Every INSERT, in dependency order: suppliers before their GRNs, bills before
 * the returns that reference them. --split hands these out across files in this
 * same order, so the parts must be run in order too.
 */
const statements = [];
const pushStmts = (arr) => { for (const s of arr) { sql.push(s); statements.push(s); } };

sql.push(`-- Legacy records load — generated ${new Date().toISOString()}`);
sql.push(`-- ${invoices.length} bills, ${grns.length} GRNs, ${supplierReturns.length} supplier returns, ${salesReturns.length} sales returns.`);
sql.push(`-- Run legacy-records-preflight.sql FIRST. Reverse with legacy-records-rollback.sql.`);
sql.push(``);
// Repeated at the top of every split part: _ctx is ON COMMIT DROP, so each part
// that runs as its own transaction has to rebuild it.
const preamble = `BEGIN;

CREATE TEMP TABLE _ctx ON COMMIT DROP AS
${ctx};

DO $$
BEGIN
  IF (SELECT count(*) FROM _ctx) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one pharmacy, found %', (SELECT count(*) FROM _ctx);
  END IF;
  IF (SELECT pharmacy_id FROM _ctx) IS NULL THEN RAISE EXCEPTION 'Pharmacy not found'; END IF;
  IF (SELECT user_id FROM _ctx) IS NULL THEN RAISE EXCEPTION 'Pharmacy has no user to attribute bills to'; END IF;
END $$;`;

sql.push(preamble);

if (invoices.length) {
  sql.push(`\n-- ── Sales bills ──────────────────────────────────────────────────────────`);
  pushStmts(chunked(invoices, 500, (batch) => `INSERT INTO invoices (
  id, "pharmacyId", "invoiceNumber", "customerId", "customerName", "customerPhone", "userId",
  "paymentMode", "paymentStatus", status,
  subtotal, "discountAmount", "taxableAmount", cgst, sgst, igst, "totalGst", "totalAmount",
  "extraCharges", "adjustmentAmount", "roundOff", "returnedAmount",
  "isInterstate", notes, "isCancelled", "createdAt", "updatedAt")
-- ::text on the nullable columns: if a whole batch happened to be NULL, Postgres
-- could not infer the VALUES column type without it.
SELECT v.id, c.pharmacy_id, v.number, cu.id, v.name::text, v.phone::text, c.user_id,
  'CASH', 'PAID', 'COMPLETED',
  v.subtotal, v.discount, v.taxable, v.cgst, v.sgst, 0, v.gst, v.total,
  0, 0, v.round_off, 0,
  false, 'LEGACY_IMPORT', false, v.created_at::timestamp(3), v.created_at::timestamp(3)
FROM _ctx c
CROSS JOIN (VALUES
${batch.map((i) => `  (${sqlStr(i.id)}, ${sqlStr(i.number)}, ${sqlStr(i.name)}, ${sqlStr(i.phone)}, ${sqlNum(i.subtotal)}::numeric(12,2), ${sqlNum(i.discount)}::numeric(12,2), ${sqlNum(i.taxable)}::numeric(12,2), ${sqlNum(i.cgst)}::numeric(12,2), ${sqlNum(i.sgst)}::numeric(12,2), ${sqlNum(i.gst)}::numeric(12,2), ${sqlNum(i.total)}::numeric(12,2), ${sqlNum(i.roundOff)}::numeric(12,2), ${sqlStr(i.createdAt)})`).join(",\n")}
) AS v(id, number, name, phone, subtotal, discount, taxable, cgst, sgst, gst, total, round_off, created_at)
LEFT JOIN customers cu ON cu."pharmacyId" = c.pharmacy_id AND cu.phone = v.phone
ON CONFLICT DO NOTHING;`));
}

if (suppliers.size) {
  sql.push(`\n-- ── Suppliers named in the purchase exports ──────────────────────────────`);
  sql.push(`-- Creates only the ones not already on file, matched on upper+trimmed name.
-- No unique index exists on (pharmacyId, name), so the guard is NOT EXISTS.
-- ledgerBalance defaults to 0: these carry no known opening dues, and the 23
-- suppliers already imported keep the balances they came with, untouched.`);
  pushStmts(chunked([...suppliers.values()], 500, (batch) => `INSERT INTO suppliers (id, "pharmacyId", name, phone, "createdAt", "updatedAt")
SELECT v.id, c.pharmacy_id, v.name, v.phone::text, now(), now()
FROM _ctx c
CROSS JOIN (VALUES
${batch.map((s) => `  (${sqlStr(s.id)}, ${sqlStr(s.name)}, ${sqlStr(s.phone)})`).join(",\n")}
) AS v(id, name, phone)
WHERE NOT EXISTS (
  SELECT 1 FROM suppliers s
  WHERE s."pharmacyId" = c.pharmacy_id AND upper(btrim(s.name)) = upper(btrim(v.name))
);`));
}

if (grns.length) {
  sql.push(`\n-- ── Purchases (GRNs) ─────────────────────────────────────────────────────`);
  sql.push(`-- INNER JOIN on suppliers: supplierId is NOT NULL. After the step above every
-- supplier in the export exists, so this should skip nothing.`);
  pushStmts(chunked(grns, 500, (batch) => `INSERT INTO goods_receipt_notes (
  id, "pharmacyId", "supplierId", "grnNumber", "supplierInvoiceNo", "supplierInvoiceDate",
  status, notes, subtotal, "totalGst", "totalAmount", "confirmedAt", "paymentDueDate",
  "createdAt", "updatedAt")
SELECT v.id, c.pharmacy_id, s.id, v.number, v.invoice_no::text, v.invoice_date::timestamp(3),
  v.status::"GRNStatus", 'LEGACY_IMPORT', v.total, 0, v.total,
  CASE WHEN v.status = 'CONFIRMED' THEN v.created_at::timestamp(3) END, NULL,
  v.created_at::timestamp(3), v.created_at::timestamp(3)
FROM _ctx c
CROSS JOIN (VALUES
${batch.map((g) => `  (${sqlStr(g.id)}, ${sqlStr(g.number)}, ${sqlStr(g.supplier)}, ${sqlStr(g.invoiceNo)}, ${sqlStr(g.invoiceDate)}, ${sqlStr(g.status)}, ${sqlNum(g.total)}::numeric(12,2), ${sqlStr(g.createdAt)})`).join(",\n")}
) AS v(id, number, supplier, invoice_no, invoice_date, status, total, created_at)
JOIN suppliers s ON s."pharmacyId" = c.pharmacy_id AND upper(btrim(s.name)) = v.supplier
ON CONFLICT DO NOTHING;`));
}

if (supplierReturns.length) {
  sql.push(`\n-- ── Purchase returns ─────────────────────────────────────────────────────`);
  pushStmts(chunked(supplierReturns, 500, (batch) => `INSERT INTO supplier_returns (
  id, "pharmacyId", "supplierId", "returnNumber", status, notes,
  subtotal, "taxableAmount", cgst, sgst, igst, "totalGst", "totalAmount",
  items, "itemCount", "createdAt", "updatedAt")
SELECT v.id, c.pharmacy_id, s.id, v.number, v.status::"SupplierReturnStatus", v.notes,
  v.total, v.total, 0, 0, 0, 0, v.total,
  '[]'::jsonb, 0, v.created_at::timestamp(3), v.created_at::timestamp(3)
FROM _ctx c
CROSS JOIN (VALUES
${batch.map((r) => `  (${sqlStr(r.id)}, ${sqlStr(r.number)}, ${sqlStr(r.supplier)}, ${sqlStr(r.status)}, ${sqlStr(r.notes)}, ${sqlNum(r.total)}::numeric(12,2), ${sqlStr(r.createdAt)})`).join(",\n")}
) AS v(id, number, supplier, status, notes, total, created_at)
JOIN suppliers s ON s."pharmacyId" = c.pharmacy_id AND upper(btrim(s.name)) = v.supplier
ON CONFLICT DO NOTHING;`));
}

if (salesReturns.length) {
  sql.push(`\n-- ── Sales returns ────────────────────────────────────────────────────────`);
  pushStmts(chunked(salesReturns, 500, (batch) => `INSERT INTO sales_returns (
  id, "pharmacyId", "invoiceId", "returnNumber", reason, "userId", "customerId",
  subtotal, "discountAmount", "taxableAmount", cgst, sgst, igst, "totalGst", "totalAmount",
  "createdAt", "updatedAt")
SELECT v.id, c.pharmacy_id, v.invoice_id, v.number, v.reason, c.user_id, cu.id,
  v.subtotal, 0, v.taxable, v.cgst, v.sgst, 0, v.gst, v.total,
  v.created_at::timestamp(3), v.created_at::timestamp(3)
FROM _ctx c
CROSS JOIN (VALUES
${batch.map((r) => `  (${sqlStr(r.id)}, ${sqlStr(r.number)}, ${sqlStr(r.invoiceId)}, ${sqlStr(r.reason)}, ${sqlStr(r.phone)}, ${sqlNum(r.subtotal)}::numeric(12,2), ${sqlNum(r.taxable)}::numeric(12,2), ${sqlNum(r.cgst)}::numeric(12,2), ${sqlNum(r.sgst)}::numeric(12,2), ${sqlNum(r.gst)}::numeric(12,2), ${sqlNum(r.total)}::numeric(12,2), ${sqlStr(r.createdAt)})`).join(",\n")}
) AS v(id, number, invoice_id, reason, phone, subtotal, taxable, cgst, sgst, gst, total, created_at)
JOIN invoices i ON i.id = v.invoice_id
LEFT JOIN customers cu ON cu."pharmacyId" = c.pharmacy_id AND cu.phone = v.phone::text
ON CONFLICT DO NOTHING;`));
}

sql.push(`\nCOMMIT;`);
writeFileSync(join(outDir, "legacy-records.sql"), sql.join("\n") + "\n");

/**
 * --split writes the same statements across numbered parts, for pasting into a
 * web SQL console that will not take an 800 KB file in one go.
 *
 * Each part is a complete transaction, and every statement is idempotent
 * (ON CONFLICT DO NOTHING, or NOT EXISTS for suppliers, which have no unique
 * index to conflict on). So a part that fails can simply be run again, and a
 * part run twice changes nothing the second time.
 *
 * Run them IN ORDER: suppliers precede their GRNs, bills precede their returns.
 */
const splitParts = [];
if (args.includes("--split")) {
  const perPart = Math.max(1, parseInt(argOf("split-size") ?? "2", 10));
  for (let i = 0; i < statements.length; i += perPart) {
    const part = statements.slice(i, i + perPart);
    const n = splitParts.length + 1;
    const total = Math.ceil(statements.length / perPart);
    const name = `legacy-records-part${String(n).padStart(2, "0")}.sql`;
    writeFileSync(join(outDir, name), [
      `-- Part ${n} of ${total} — run the parts in order.`,
      `-- Safe to re-run: every statement here is idempotent.`,
      ``,
      preamble,
      ``,
      ...part,
      ``,
      `COMMIT;`,
    ].join("\n") + "\n");
    splitParts.push(name);
  }
}

// ─── pre-flight ───────────────────────────────────────────────────────────────

const preflight = `-- Run this BEFORE legacy-records.sql. It only reads.

-- 1. Exactly one row, with a non-null user_id, or the load will abort.
${ctx};

-- 2. Suppliers the load will CREATE — those named in the export with no match on
--    file. Name (and phone, where the purchase-return export had one) only; no
--    GSTIN, address or opening balance. Review the list before running the load.
WITH ctx AS (${ctx}),
     wanted(name) AS (VALUES
${[...suppliers.keys()].sort().map((n) => `  (${sqlStr(n)})`).join(",\n")}
     )
SELECT w.name AS will_be_created
FROM wanted w, ctx c
WHERE NOT EXISTS (
  SELECT 1 FROM suppliers s
  WHERE s."pharmacyId" = c.pharmacy_id AND upper(btrim(s.name)) = w.name
)
ORDER BY 1;

-- 3. Document numbers already taken. Anything returned here is skipped by the
--    ON CONFLICT clause rather than overwriting a real record.
WITH ctx AS (${ctx})
SELECT 'invoice' AS kind, i."invoiceNumber" AS number FROM invoices i, ctx c
WHERE i."pharmacyId" = c.pharmacy_id AND i."invoiceNumber" LIKE 'OLD-%'
UNION ALL
SELECT 'grn', g."grnNumber" FROM goods_receipt_notes g, ctx c
WHERE g."pharmacyId" = c.pharmacy_id AND g."grnNumber" LIKE 'OLD-%';
`;
writeFileSync(join(outDir, "legacy-records-preflight.sql"), preflight);

// ─── verification ─────────────────────────────────────────────────────────────

const expectedSalesTotal = round2(invoices.reduce((a, i) => a + i.total, 0));
const expectedGrnTotal = round2(grns.reduce((a, g) => a + g.total, 0));

const verify = `-- Run AFTER legacy-records.sql.

WITH ctx AS (${ctx})
SELECT 'bills loaded'        AS check, count(*)::text AS actual, '${invoices.length}' AS expected
FROM invoices i, ctx c WHERE i."pharmacyId" = c.pharmacy_id AND i.notes = 'LEGACY_IMPORT'
UNION ALL
SELECT 'bills value', to_char(coalesce(sum(i."totalAmount"), 0), 'FM999999999.00'), '${expectedSalesTotal.toFixed(2)}'
FROM invoices i, ctx c WHERE i."pharmacyId" = c.pharmacy_id AND i.notes = 'LEGACY_IMPORT'
UNION ALL
SELECT 'GRNs loaded', count(*)::text, '${grns.length}'
FROM goods_receipt_notes g, ctx c WHERE g."pharmacyId" = c.pharmacy_id AND g.notes = 'LEGACY_IMPORT'
UNION ALL
SELECT 'GRNs value', to_char(coalesce(sum(g."totalAmount"), 0), 'FM999999999.00'), '${expectedGrnTotal.toFixed(2)}'
FROM goods_receipt_notes g, ctx c WHERE g."pharmacyId" = c.pharmacy_id AND g.notes = 'LEGACY_IMPORT'
UNION ALL
SELECT 'supplier returns', count(*)::text, '${supplierReturns.length}'
FROM supplier_returns r, ctx c WHERE r."pharmacyId" = c.pharmacy_id AND r.notes LIKE 'LEGACY_IMPORT%'
UNION ALL
SELECT 'sales returns', count(*)::text, '${salesReturns.length}'
FROM sales_returns r, ctx c WHERE r."pharmacyId" = c.pharmacy_id AND r.id LIKE 'lgcy\\_%'
UNION ALL
SELECT 'suppliers created', count(*)::text, 'see pre-flight list'
FROM suppliers s, ctx c WHERE s."pharmacyId" = c.pharmacy_id AND s.id LIKE 'lgcy\\_sup\\_%'
UNION ALL
-- Must be 0. A created supplier carries no opening dues, so none may hold a balance.
SELECT 'created suppliers with a balance', count(*)::text, '0'
FROM suppliers s, ctx c
WHERE s."pharmacyId" = c.pharmacy_id AND s.id LIKE 'lgcy\\_sup\\_%' AND s."ledgerBalance" <> 0
UNION ALL
-- Must be 0. A non-zero result means a bill does not add up on screen.
SELECT 'bills that do not balance', count(*)::text, '0'
FROM invoices i, ctx c
WHERE i."pharmacyId" = c.pharmacy_id AND i.notes = 'LEGACY_IMPORT'
  AND abs(i."taxableAmount" + i."totalGst" + i."extraCharges" + i."adjustmentAmount" + i."roundOff" - i."totalAmount") > 0.01
UNION ALL
-- Must be 0. Legacy bills are all PAID, so none may reach the receivables figure.
SELECT 'legacy bills in receivables', count(*)::text, '0'
FROM invoices i, ctx c
WHERE i."pharmacyId" = c.pharmacy_id AND i.notes = 'LEGACY_IMPORT'
  AND i."isCancelled" = false AND i."paymentStatus"::text IN ('PENDING', 'PARTIAL')
UNION ALL
-- Must be 0. paymentDueDate NULL is what keeps these out of Overdue Bills.
SELECT 'legacy GRNs in overdue bills', count(*)::text, '0'
FROM goods_receipt_notes g, ctx c
WHERE g."pharmacyId" = c.pharmacy_id AND g.notes = 'LEGACY_IMPORT' AND g."paymentDueDate" IS NOT NULL;

-- Supplier dues must read exactly as they did before the load.
WITH ctx AS (${ctx})
SELECT round(sum(s."ledgerBalance"), 2) AS supplier_dues_total
FROM suppliers s, ctx c WHERE s."pharmacyId" = c.pharmacy_id;
`;
writeFileSync(join(outDir, "legacy-records-verify.sql"), verify);

// ─── rollback ─────────────────────────────────────────────────────────────────

writeFileSync(join(outDir, "legacy-records-rollback.sql"), `-- Removes everything the load inserted, and nothing else.
-- Children first: sales_returns references invoices.

BEGIN;
DELETE FROM sales_returns        WHERE id LIKE 'lgcy\\_%';
DELETE FROM supplier_returns     WHERE id LIKE 'lgcy\\_%';
DELETE FROM goods_receipt_notes  WHERE id LIKE 'lgcy\\_%';
DELETE FROM invoices             WHERE id LIKE 'lgcy\\_%';

-- Suppliers this load created, but only those nothing else points at. If staff
-- have since raised a PO, GRN, return, payment or quotation against one, it stays
-- — removing it would either break the FK or orphan live purchasing.
DELETE FROM suppliers s
WHERE s.id LIKE 'lgcy\\_sup\\_%'
  AND NOT EXISTS (SELECT 1 FROM purchase_orders        x WHERE x."supplierId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM goods_receipt_notes    x WHERE x."supplierId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM supplier_returns       x WHERE x."supplierId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM supplier_ledger_entries x WHERE x."supplierId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM quotations             x WHERE x."supplierId" = s.id);
COMMIT;
`);

// ─── report ───────────────────────────────────────────────────────────────────

const report = [
  `Sales bills          ${String(invoices.length).padStart(5)}   ₹${expectedSalesTotal.toLocaleString("en-IN")}`,
  `Purchases (GRNs)     ${String(grns.length).padStart(5)}   ₹${expectedGrnTotal.toLocaleString("en-IN")}`,
  `Purchase returns     ${String(supplierReturns.length).padStart(5)}`,
  `Sales returns        ${String(salesReturns.length).padStart(5)}   (${unmatchedReturns.length} could not be matched to a bill)`,
  `Supplier names       ${String(suppliers.size).padStart(5)}   any not on file are created by the load`,
];
console.log(report.join("\n"));

if (unmatchedReturns.length) {
  console.log(`\nSales returns with no matching bill — left out:`);
  for (const u of unmatchedReturns) console.log(`  #${u.no}  ${u.date}  ${u.name} ${u.phone}  ₹${u.net}`);
}
if (notes.length) {
  console.log(`\nNotes:`);
  for (const n of notes.slice(0, 20)) console.log(`  ${n}`);
  if (notes.length > 20) console.log(`  ...and ${notes.length - 20} more`);
}
console.log(`\nWrote to ${outDir}:\n  legacy-records-preflight.sql   run first, read-only\n  legacy-records.sql             the load\n  legacy-records-verify.sql      run after\n  legacy-records-rollback.sql    undo`);
if (splitParts.length) {
  console.log(`  ${splitParts.length} split parts                 legacy-records-part01..${String(splitParts.length).padStart(2, "0")}.sql — run in order`);
}
