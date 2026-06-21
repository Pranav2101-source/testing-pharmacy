// ─── Column alias dictionary ──────────────────────────────────────────────────
// Maps every known variant header from Marg / Busy / RetailGraph / GoFrugal /
// RedBook / Tally exports to our canonical field name.
// Match is case-insensitive and whitespace-normalised before lookup.

import type { CanonicalField, ColumnDetection, ColumnMappings } from "./migration.types.js";

const ALIASES: Record<CanonicalField, string[]> = {
  // ── Inventory / medicine ────────────────────────────────────────────────────
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

  // ── Supplier ─────────────────────────────────────────────────────────────────
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

  // ── Customer ─────────────────────────────────────────────────────────────────
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

  // ── Doctor ───────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-]/g, " ")          // underscores and dashes → spaces
    .replace(/[^a-z0-9\s]/g, " ")    // strip special chars (%, ₹, ., /)
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

// ── Public API ────────────────────────────────────────────────────────────────

export function detectColumns(headers: string[]): ColumnDetection[] {
  return headers.map((header) => {
    const norm = normalise(header);

    // 1. Exact alias match → high confidence
    const exact = REVERSE.get(norm);
    if (exact) return { csvHeader: header, suggestedField: exact, confidence: "high" };

    // 2. Whole-word partial match → medium confidence
    // Only consider meaningful words (≥ 3 chars) to avoid "id", "cp", "no" false positives.
    const normWords = norm.split(" ").filter((w) => w.length >= 3);
    if (normWords.length > 0) {
      for (const [alias, canonical] of REVERSE.entries()) {
        const aliasWords = alias.split(" ").filter((w) => w.length >= 3);
        if (aliasWords.length === 0) continue;
        // All alias words must appear in the norm words (or vice versa)
        const aliasInNorm = aliasWords.every((aw) => normWords.some((nw) => nw === aw || nw.startsWith(aw) || aw.startsWith(nw)));
        const normInAlias = normWords.every((nw) => aliasWords.some((aw) => aw === nw || aw.startsWith(nw) || nw.startsWith(aw)));
        if (aliasInNorm || normInAlias) {
          return { csvHeader: header, suggestedField: canonical, confidence: "medium" };
        }
      }
    }

    return { csvHeader: header, suggestedField: null, confidence: "none" };
  });
}

// ── CSV Parser ────────────────────────────────────────────────────────────────

export interface ParsedRow {
  rowNumber: number;
  fields:    Record<string, string>;
}

/**
 * Parses a CSV or TSV string (handles both delimiters, quoted fields, CRLF).
 * Returns raw { fieldName → value } objects using the column mappings to key the fields.
 * Rows that map to no recognised columns still appear in the output — the
 * validator decides which fields are required.
 */
export function parseCsv(
  csvText:        string,
  columnMappings: ColumnMappings,
): { rows: ParsedRow[]; headers: string[] } {
  // Strip UTF-8 BOM (﻿) — present in most Excel-exported CSVs.
  // Without this the first column header never matches any mapping key.
  const normalised = csvText.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const lines      = normalised.split("\n");
  if (lines.length < 2) return { rows: [], headers: [] };

  // Auto-detect delimiter: TSV if the header line contains more tabs than commas
  const headerLine = lines[0] ?? "";
  const delimiter  = (headerLine.match(/\t/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0)
    ? "\t"
    : ",";

  const csvHeaders = splitLine(headerLine, delimiter);
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;

    const cols   = splitLine(line, delimiter);
    const fields: Record<string, string> = {};

    for (let c = 0; c < csvHeaders.length; c++) {
      const csvHeader = csvHeaders[c] ?? "";
      const canonical = columnMappings[csvHeader];
      if (canonical) {
        fields[canonical] = (cols[c] ?? "").trim();
      }
    }

    rows.push({ rowNumber: i + 1, fields });
  }

  return { rows, headers: csvHeaders };
}

function splitLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── Date normaliser ───────────────────────────────────────────────────────────
// Handles: YYYY-MM-DD, DD/MM/YYYY, MM/YYYY (last day of month), MM-YY, MM/YY

export function normaliseDate(raw: string): string | null {
  const s = raw.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    const d = new Date(`${yyyy}-${mm}-${dd}`);
    // Reject silently-overflowed dates (e.g. month 13 → Jan next year)
    if (isNaN(d.getTime())) return null;
    if (d.getFullYear() !== +yyyy! || d.getMonth() + 1 !== +mm! || d.getDate() !== +dd!) return null;
    return d.toISOString();
  }

  // MM/YYYY or MM-YYYY — treat as last day of that month
  const mmYyyy = s.match(/^(\d{2})[\/\-](\d{4})$/);
  if (mmYyyy) {
    const [, mm, yyyy] = mmYyyy;
    const d = new Date(Number(yyyy), Number(mm), 0); // day 0 = last day of prev month
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // MM/YY — assume 2000s
  const mmYy = s.match(/^(\d{2})[\/\-](\d{2})$/);
  if (mmYy) {
    const [, mm, yy] = mmYy;
    const yyyy = 2000 + Number(yy);
    const d    = new Date(yyyy, Number(mm), 0);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

// Returns { display: original case, key: lowercase } pairs, deduplicated case-insensitively.
// Callers must use `.key` for database lookups (MedicineMapping.csvValue is stored lowercase)
// and `.display` for search queries and user-facing UI.
export function extractUniqueMedicineNames(rows: ParsedRow[]): { display: string; key: string }[] {
  const seen = new Map<string, string>(); // lowercase key → first-seen original casing
  for (const row of rows) {
    const name = (row.fields["medicineName"] ?? "").trim();
    if (name) {
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.entries()].map(([key, display]) => ({ display, key }));
}
