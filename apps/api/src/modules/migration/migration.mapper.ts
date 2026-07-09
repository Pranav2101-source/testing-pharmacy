// ─── Column alias dictionary ─────────────────────────────────────────────────
// Maps every known variant header from Marg / Busy / RetailGraph / GoFrugal /
// RedBook / Tally exports to our canonical field name.
// Match is case-insensitive and whitespace-normalised before lookup.
//
// CSV parsing, date normalisation, and the ParsedRow type now live in the
// shared @pharmacy/utils migration-core so the async pg-boss worker uses
// byte-for-byte identical logic. They are re-exported below so existing
// imports in this module keep working unchanged.

import type { CanonicalField, ColumnDetection } from "./migration.types.js";
import type { ParsedRow } from "@pharmacy/utils";

export { parseCsv, normaliseDate, splitLine, type ParsedRow } from "@pharmacy/utils";

const ALIASES: Record<CanonicalField, string[]> = {
  // Inventory / medicine
  medicineName: [
    "medicine name", "item name", "product name", "drug name", "item description",
    "description", "medicine", "product", "item", "name", "particulars",
    "drug", "medicine product", "product description", "item code name",
    "salt name", "generic name", "trade name", "brand name",
  ],
  batchNumber: [
    "batch no", "batch number", "batch", "lot no", "lot number", "lot",
    "batch no.", "batchno", "batch no", "mfg batch",
  ],
  expiryDate: [
    "expiry", "expiry date", "exp date", "expiry dt", "exp dt",
    "expiry date mm yy", "exp date", "expiry mm yy",
    "use before", "best before",
  ],
  quantity: [
    "qty", "quantity", "closing stock", "current qty",
    "available qty", "stock qty", "on hand", "current stock",
    "stock balance", "qty on hand", "opening qty", "stock qty",
  ],
  mrp: [
    "mrp", "m r p", "retail price", "sale price", "selling price",
    "max retail price", "maximum retail price", "unit price",
    "price", "unit mrp", "pack price",
  ],
  purchaseRate: [
    "purchase rate", "purchase price", "cost price", "ptr", "landing cost",
    "net rate", "purchase rate excl gst", "purchase cost", "p rate", "pur rate",
    "rate", "cost",
  ],
  manufacturer: [
    "manufacturer", "company", "mfr", "mfg", "mfg name",
    "company name", "manufacturer name", "made by", "manufactured by",
    "manufacturer name", "mfr name",
  ],
  gstRate: [
    "gst", "gst rate", "gst percent", "tax rate", "tax percent", "gst rate percent",
    "gst slab", "tax slab", "gst applicable",
  ],
  hsnCode: [
    "hsn", "hsn code", "hsn sac", "hsn no", "hsn number",
    "hsn code no", "sac code",
  ],
  minimumStock: [
    "minimum stock", "min stock", "reorder qty", "reorder level",
    "min qty", "safety stock", "reorder point",
  ],

  // Supplier
  supplierName: [
    "supplier name", "vendor name", "supplier", "vendor",
    "distributor name", "distributor", "creditor name",
  ],
  gstin: [
    "gstin", "gst no", "gst number", "gst in", "gst registration",
    "gst reg no", "gstin no",
  ],
  dlNumber: [
    "drug license", "dl no", "dl number", "drug licence",
    "drug license no", "d l no",
  ],
  phone: [
    "phone", "mobile", "phone no", "mobile no", "contact no",
    "phone number", "mobile number", "contact number", "tel", "telephone",
  ],
  email: ["email", "e mail", "email address"],
  address: ["address", "addr", "street", "street address"],
  city: ["city", "town", "district"],
  state: ["state", "province"],
  creditDays: [
    "credit days", "payment days", "credit period", "due days",
    "payment terms", "credit terms",
  ],
  openingBalance: [
    "opening balance", "outstanding", "amount due",
    "payable", "opening due", "op balance",
  ],

  // Customer
  customerName: [
    "customer name", "patient name", "customer", "client name",
    "member name",
  ],
  dateOfBirth: [
    "dob", "date of birth", "birth date", "d o b", "birthdate",
    "date of birth dd mm yyyy",
  ],
  gender: ["gender", "sex"],
  creditLimit: [
    "credit limit", "credit ceiling",
  ],
  openingDue: [
    "opening due", "outstanding amount", "balance due", "amount outstanding",
    "receivable", "due amount",
  ],
  abhaNumber: [
    "abha", "abha number", "abha id", "health id", "ipd no", "opd no",
    "uhid",
  ],
  cardNumber: [
    "card number", "card no", "loyalty card", "membership no",
  ],
  notes: ["notes", "remarks", "comment", "note"],

  // Doctor
  doctorName: [
    "doctor name", "dr name", "physician name", "consultant name",
    "doctor", "dr",
  ],
  registrationNo: [
    "reg no", "registration no", "mci no", "registration number",
    "doctor reg", "med reg no", "doctor registration",
  ],
  specialty: [
    "specialty", "specialization", "specialisation", "dept",
    "department", "discipline",
  ],
  clinic: [
    "clinic", "hospital", "clinic name", "hospital name",
    "practice", "facility",
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_-]/g, " ")            // underscores and dashes -> spaces
    .replace(/[^a-z0-9\s]/g, " ")     // strip special chars (%, currency, ., /)
    .replace(/\s+/g, " ")
    .trim();
}

// Build a reverse lookup once at module load (not per request)
const REVERSE: Map<string, CanonicalField> = new Map();
for (const [field, aliases] of Object.entries(ALIASES) as [CanonicalField, string[]][]) {
  for (const alias of aliases) {
    REVERSE.set(normalise(alias), field);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

// A word in `a` matches a word in `b` if equal or one is a prefix of the other
// (so "qty" ~ "quantity", "mfr" ~ "mfr name"). Only words >= 3 chars count, to
// avoid "id"/"no"/"cp" false positives.
function wordScore(aWords: string[], bWords: string[]): number {
  if (aWords.length === 0 || bWords.length === 0) return 0;
  let matched = 0;
  for (const aw of aWords) {
    if (bWords.some((bw) => bw === aw || bw.startsWith(aw) || aw.startsWith(bw))) matched++;
  }
  // Jaccard-style coverage over the larger word set — rewards fuller overlap so
  // the BEST alias wins rather than whichever happened to be declared first.
  return matched / Math.max(aWords.length, bWords.length);
}

export function detectColumns(headers: string[]): ColumnDetection[] {
  return headers.map((header) => {
    const norm = normalise(header);

    // 1. Exact alias match -> high confidence
    const exact = REVERSE.get(norm);
    if (exact) return { csvHeader: header, suggestedField: exact, confidence: "high" };

    // 2. Best-scoring partial match across ALL aliases (not the first hit).
    const normWords = norm.split(" ").filter((w) => w.length >= 3);
    if (normWords.length === 0) return { csvHeader: header, suggestedField: null, confidence: "none" };

    let best: { field: CanonicalField; score: number } | null = null;
    for (const [alias, canonical] of REVERSE.entries()) {
      const aliasWords = alias.split(" ").filter((w) => w.length >= 3);
      const score = wordScore(aliasWords, normWords);
      if (score > 0 && (!best || score > best.score)) {
        best = { field: canonical, score };
      }
    }

    if (!best) return { csvHeader: header, suggestedField: null, confidence: "none" };
    // Full overlap (all words matched both ways) is nearly as good as exact.
    const confidence = best.score >= 0.99 ? "high" : best.score >= 0.5 ? "medium" : "low";
    return { csvHeader: header, suggestedField: best.field, confidence };
  });
}

// Returns { display: original case, key: lowercase } pairs, deduplicated case-insensitively.
// Callers must use `.key` for database lookups (MedicineMapping.csvValue is stored lowercase)
// and `.display` for search queries and user-facing UI.
export function extractUniqueMedicineNames(rows: ParsedRow[]): { display: string; key: string }[] {
  const seen = new Map<string, string>(); // lowercase key -> first-seen original casing
  for (const row of rows) {
    const name = (row.fields["medicineName"] ?? "").trim();
    if (name) {
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.entries()].map(([key, display]) => ({ display, key }));
}
