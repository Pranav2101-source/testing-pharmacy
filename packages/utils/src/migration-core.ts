// ─── Shared migration import core ────────────────────────────────────────────
// CSV parsing, date normalisation, and row validation for the data-migration
// wizard. Lives in @pharmacy/utils so the synchronous request path and the
// async background job import the exact same logic — previously these were
// copy-pasted and silently drifted apart (the async path had weaker validation).
//
// This module is intentionally framework- and DB-agnostic. It turns raw CSV
// text into validated, typed rows plus a list of
// per-row issues. Persistence stays in each consumer.

// ── Types ─────────────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface RowIssue {
  row:      number;
  field?:   string;
  message:  string;
  severity: ValidationSeverity;
}

export interface ParsedRow {
  rowNumber: number;
  fields:    Record<string, string>;
}

export interface ValidatedInventoryRow {
  rowNumber:     number;
  medicineName:  string;
  batchNumber:   string;
  expiryDate:    string; // ISO
  quantity:      number;
  mrp:           number;
  purchaseRate:  number;
  gstRate:       number;
  manufacturer?: string;
  hsnCode?:      string;
  minimumStock?: number;
}

export interface ValidatedSupplierRow {
  rowNumber:       number;
  supplierName:    string;
  gstin?:          string;
  dlNumber?:       string;
  phone?:          string;
  email?:          string;
  address?:        string;
  city?:           string;
  state?:          string;
  creditDays?:     number;
  openingBalance?: number;
}

export interface ValidatedCustomerRow {
  rowNumber:    number;
  customerName: string;
  phone?:       string;
  email?:       string;
  address?:     string;
  dateOfBirth?: string;
  gender?:      string;
  creditLimit?: number;
  openingDue?:  number;
  abhaNumber?:  string;
  cardNumber?:  string;
  notes?:       string;
}

export interface ValidatedDoctorRow {
  rowNumber:       number;
  doctorName:      string;
  registrationNo?: string;
  specialty?:      string;
  clinic?:         string;
  phone?:          string;
  email?:          string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const NEAR_EXPIRY_DAYS = 90;
const VALID_GST_RATES  = new Set([0, 5, 12, 18]);

// GSTIN: 2-digit state code + 10-char PAN + entity number + Z + checksum
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
// Indian mobile: optional +91 / 91 / 0 prefix then 10 digits starting 6-9
const PHONE_RE = /^(?:\+91|91|0)?([6-9][0-9]{9})$/;

// ── CSV parsing ───────────────────────────────────────────────────────────────

/** Splits one CSV/TSV line, honouring quoted fields and escaped ("") quotes. */
export function splitLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current  = "";
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

/**
 * Parses CSV or TSV text (auto-detects delimiter, handles quoted fields, CRLF,
 * and a leading UTF-8 BOM). Keys each field by its canonical name using
 * `columnMappings` ({ "Item Name": "medicineName" }). Columns mapped to the
 * sentinel "(skip)" — or to nothing — are dropped.
 */
export function parseCsv(
  csvText:        string,
  columnMappings: Record<string, string>,
): { rows: ParsedRow[]; headers: string[] } {
  const normalised = csvText
    .replace(/^﻿/, "")        // strip UTF-8 BOM (Excel exports include it)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  const lines = normalised.split("\n");
  if (lines.length < 2) return { rows: [], headers: [] };

  const headerLine = lines[0] ?? "";
  const delimiter  = (headerLine.match(/\t/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0)
    ? "\t"
    : ",";

  const headers = splitLine(headerLine, delimiter);
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;

    const cols   = splitLine(line, delimiter);
    const fields: Record<string, string> = {};

    for (let c = 0; c < headers.length; c++) {
      const header    = headers[c] ?? "";
      const canonical = columnMappings[header];
      if (canonical && canonical !== "(skip)") {
        fields[canonical] = (cols[c] ?? "").trim();
      }
    }

    rows.push({ rowNumber: i + 1, fields });
  }

  return { rows, headers };
}

// ── Date normalisation ────────────────────────────────────────────────────────

export type DateContext = "expiry" | "dob" | "generic";

/**
 * Normalises common Indian pharmacy-software date formats to an ISO string.
 * Handles: YYYY-MM-DD, DD/MM/YYYY, DD/MM/YY, MM/YYYY, MM/YY (- or / separators).
 *
 * The `context` matters for 2-digit years, which are inherently ambiguous:
 *  - "expiry" (default): 2-digit year → 20YY. Expiry dates are always future.
 *  - "dob": 2-digit year uses a sliding pivot — 20YY unless that lands in the
 *    future, in which case 19YY (so "45" → 1945, not 2045). A fully-specified
 *    date that still resolves to the future is rejected (null) rather than
 *    stored as an impossible birthdate.
 */
export function normaliseDate(raw: string, context: DateContext = "expiry"): string | null {
  const s = raw.trim();
  if (!s) return null;

  const finalize = (d: Date): string | null => {
    if (isNaN(d.getTime())) return null;
    // A birthdate can never be in the future — reject typos like 2099/2045.
    if (context === "dob" && d.getTime() > Date.now()) return null;
    return d.toISOString();
  };

  // Pivots a 2-digit year to a full year. For DOB, prefer the past.
  const pivotYear = (yy: number): number => {
    if (context === "dob") {
      const candidate = 2000 + yy;
      return candidate > new Date().getFullYear() ? 1900 + yy : candidate;
    }
    return 2000 + yy;
  };

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return finalize(new Date(s));
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    // Reject silently-overflowed dates (e.g. month 13 → Jan next year, day 32)
    if (d.getFullYear() !== +yyyy! || d.getMonth() + 1 !== +mm! || d.getDate() !== +dd!) return null;
    return finalize(d);
  }

  // DD/MM/YY or DD-MM-YY (2-digit year)
  const ddmmyy = s.match(/^(\d{2})[-/](\d{2})[-/](\d{2})$/);
  if (ddmmyy) {
    const [, dd, mm, yy] = ddmmyy;
    const yyyy = pivotYear(Number(yy));
    const d = new Date(yyyy, Number(mm) - 1, Number(dd));
    if (d.getFullYear() !== yyyy || d.getMonth() + 1 !== +mm! || d.getDate() !== +dd!) return null;
    return finalize(d);
  }

  // MM/YYYY or MM-YYYY — last day of that month (common expiry form)
  const mmYyyy = s.match(/^(\d{2})[-/](\d{4})$/);
  if (mmYyyy) {
    const [, mm, yyyy] = mmYyyy;
    return finalize(new Date(Number(yyyy), Number(mm), 0)); // day 0 = last day of prev month
  }

  // MM/YY or MM-YY (2-digit year) — last day of that month
  const mmYy = s.match(/^(\d{2})[-/](\d{2})$/);
  if (mmYy) {
    const [, mm, yy] = mmYy;
    return finalize(new Date(pivotYear(Number(yy)), Number(mm), 0));
  }

  return null;
}

// ── Inventory validation ──────────────────────────────────────────────────────

export function validateInventoryRow(
  row: ParsedRow,
): { data: ValidatedInventoryRow | null; issues: RowIssue[] } {
  const { rowNumber, fields } = row;
  const issues: RowIssue[] = [];

  const medicineName = (fields["medicineName"] ?? "").trim();
  const batchNumber  = (fields["batchNumber"]  ?? "").trim();
  const expiryRaw    = (fields["expiryDate"]   ?? "").trim();
  const qtyRaw       = (fields["quantity"]     ?? "").trim();
  const mrpRaw       = (fields["mrp"]          ?? "").trim();
  const rateRaw      = (fields["purchaseRate"] ?? "").trim();
  const gstRaw       = (fields["gstRate"]      ?? "12").trim();

  if (!medicineName) {
    issues.push({ row: rowNumber, field: "medicineName", message: "Medicine name is required", severity: "error" });
  }
  if (!batchNumber) {
    issues.push({ row: rowNumber, field: "batchNumber", message: "Batch number is required", severity: "error" });
  }

  const expiryDate = normaliseDate(expiryRaw, "expiry");
  if (!expiryRaw) {
    issues.push({ row: rowNumber, field: "expiryDate", message: "Expiry date is required", severity: "error" });
  } else if (!expiryDate) {
    issues.push({ row: rowNumber, field: "expiryDate", message: `Cannot parse expiry date "${expiryRaw}" — use DD/MM/YYYY, MM/YY, or YYYY-MM-DD`, severity: "error" });
  }

  const quantity = parseInt(qtyRaw, 10);
  if (!qtyRaw) {
    issues.push({ row: rowNumber, field: "quantity", message: "Quantity is required", severity: "error" });
  } else if (isNaN(quantity) || quantity < 0) {
    issues.push({ row: rowNumber, field: "quantity", message: `Invalid quantity "${qtyRaw}"`, severity: "error" });
  } else if (quantity === 0) {
    issues.push({ row: rowNumber, field: "quantity", message: "Quantity is 0 — this batch will be imported with zero stock", severity: "warning" });
  }

  const mrp = parseFloat(mrpRaw);
  if (!mrpRaw) {
    issues.push({ row: rowNumber, field: "mrp", message: "MRP is required", severity: "error" });
  } else if (isNaN(mrp) || mrp <= 0) {
    issues.push({ row: rowNumber, field: "mrp", message: `Invalid MRP "${mrpRaw}"`, severity: "error" });
  }

  const purchaseRate = parseFloat(rateRaw);
  if (!rateRaw) {
    issues.push({ row: rowNumber, field: "purchaseRate", message: "Purchase rate is required", severity: "error" });
  } else if (isNaN(purchaseRate) || purchaseRate <= 0) {
    issues.push({ row: rowNumber, field: "purchaseRate", message: `Invalid purchase rate "${rateRaw}"`, severity: "error" });
  }

  // Pricing anomaly — purchase cost above MRP would mean selling at a loss.
  if (!isNaN(mrp) && !isNaN(purchaseRate) && mrp > 0 && purchaseRate > mrp) {
    issues.push({ row: rowNumber, field: "purchaseRate", message: `Purchase rate (${purchaseRate}) exceeds MRP (${mrp})`, severity: "warning" });
  }

  const gstRate = parseFloat(gstRaw || "12");
  if (!VALID_GST_RATES.has(gstRate)) {
    issues.push({ row: rowNumber, field: "gstRate", message: `GST rate ${gstRaw}% is not standard (0/5/12/18) — using 12%`, severity: "warning" });
  }

  // Expiry warnings (only when we could parse the date)
  if (expiryDate) {
    const daysToExpiry = (new Date(expiryDate).getTime() - Date.now()) / 86_400_000;
    if (daysToExpiry < 0) {
      issues.push({ row: rowNumber, field: "expiryDate", message: `Batch already expired`, severity: "warning" });
    } else if (daysToExpiry < NEAR_EXPIRY_DAYS) {
      issues.push({ row: rowNumber, field: "expiryDate", message: `Batch expires in ${Math.ceil(daysToExpiry)} days (near expiry)`, severity: "warning" });
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  if (hasErrors || !expiryDate) return { data: null, issues };

  const minimumStockRaw = (fields["minimumStock"] ?? "").trim();
  const minimumStock    = minimumStockRaw ? parseInt(minimumStockRaw, 10) : undefined;

  return {
    data: {
      rowNumber,
      medicineName,
      batchNumber,
      expiryDate,
      quantity:     isNaN(quantity) ? 0 : quantity,
      mrp:          isNaN(mrp) ? 0 : mrp,
      purchaseRate: isNaN(purchaseRate) ? 0 : purchaseRate,
      gstRate:      VALID_GST_RATES.has(gstRate) ? gstRate : 12,
      manufacturer: (fields["manufacturer"] ?? "").trim() || undefined,
      hsnCode:      (fields["hsnCode"]      ?? "").trim() || undefined,
      minimumStock: minimumStock && !isNaN(minimumStock) ? minimumStock : undefined,
    },
    issues,
  };
}

// ── Supplier validation ─────────────────────────────────────────────────────

export function validateSupplierRow(
  row: ParsedRow,
): { data: ValidatedSupplierRow | null; issues: RowIssue[] } {
  const { rowNumber, fields } = row;
  const issues: RowIssue[] = [];

  const supplierName = (fields["supplierName"] ?? "").trim();
  if (!supplierName) {
    issues.push({ row: rowNumber, field: "supplierName", message: "Supplier name is required", severity: "error" });
    return { data: null, issues };
  }

  const creditDaysRaw = (fields["creditDays"]     ?? "").trim();
  const openingBalRaw = (fields["openingBalance"] ?? "").trim();

  const creditDays     = creditDaysRaw ? parseInt(creditDaysRaw, 10) : undefined;
  const openingBalance = openingBalRaw ? parseFloat(openingBalRaw)   : undefined;

  if (creditDays !== undefined && (isNaN(creditDays) || creditDays < 0)) {
    issues.push({ row: rowNumber, field: "creditDays", message: `Invalid credit days "${creditDaysRaw}"`, severity: "warning" });
  }
  if (openingBalance !== undefined && isNaN(openingBalance)) {
    issues.push({ row: rowNumber, field: "openingBalance", message: `Invalid opening balance "${openingBalRaw}"`, severity: "warning" });
  }

  const gstinRaw = (fields["gstin"] ?? "").trim().toUpperCase();
  if (gstinRaw && !GSTIN_RE.test(gstinRaw)) {
    issues.push({ row: rowNumber, field: "gstin", message: `Invalid GSTIN format "${gstinRaw}" — expected 15-char format (e.g. 27AABCA1234Z1Z5)`, severity: "warning" });
  }

  const phoneRaw   = (fields["phone"] ?? "").trim();
  const phoneMatch = phoneRaw ? PHONE_RE.exec(phoneRaw) : null;
  if (phoneRaw && !phoneMatch) {
    issues.push({ row: rowNumber, field: "phone", message: `Invalid phone number "${phoneRaw}" — expected 10-digit Indian mobile`, severity: "warning" });
  }
  const phone = phoneMatch ? phoneMatch[1] : (phoneRaw || undefined);

  return {
    data: {
      rowNumber,
      supplierName,
      gstin:          gstinRaw || undefined,
      dlNumber:       (fields["dlNumber"] ?? "").trim() || undefined,
      phone,
      email:          (fields["email"]   ?? "").trim() || undefined,
      address:        (fields["address"] ?? "").trim() || undefined,
      city:           (fields["city"]    ?? "").trim() || undefined,
      state:          (fields["state"]   ?? "").trim() || undefined,
      creditDays:     creditDays !== undefined && !isNaN(creditDays) ? creditDays : undefined,
      openingBalance: openingBalance !== undefined && !isNaN(openingBalance) ? openingBalance : undefined,
    },
    issues,
  };
}

// ── Customer validation ─────────────────────────────────────────────────────

export function validateCustomerRow(
  row: ParsedRow,
): { data: ValidatedCustomerRow | null; issues: RowIssue[] } {
  const { rowNumber, fields } = row;
  const issues: RowIssue[] = [];

  const customerName = (fields["customerName"] ?? "").trim();
  if (!customerName) {
    issues.push({ row: rowNumber, field: "customerName", message: "Customer name is required", severity: "error" });
    return { data: null, issues };
  }

  const dobRaw         = (fields["dateOfBirth"] ?? "").trim();
  const creditLimitRaw = (fields["creditLimit"] ?? "").trim();
  const openingDueRaw  = (fields["openingDue"]  ?? "").trim();

  const dateOfBirth = dobRaw         ? normaliseDate(dobRaw, "dob") : undefined;
  const creditLimit = creditLimitRaw ? parseFloat(creditLimitRaw)  : undefined;
  const openingDue  = openingDueRaw  ? parseFloat(openingDueRaw)    : undefined;

  if (dobRaw && !dateOfBirth) {
    issues.push({ row: rowNumber, field: "dateOfBirth", message: `Cannot parse date of birth "${dobRaw}" — use DD/MM/YYYY (a future date is not a valid birthdate)`, severity: "warning" });
  }

  const cPhoneRaw   = (fields["phone"] ?? "").trim();
  const cPhoneMatch = cPhoneRaw ? PHONE_RE.exec(cPhoneRaw) : null;
  if (cPhoneRaw && !cPhoneMatch) {
    issues.push({ row: rowNumber, field: "phone", message: `Invalid phone number "${cPhoneRaw}" — expected 10-digit Indian mobile`, severity: "warning" });
  }
  const customerPhone = cPhoneMatch ? cPhoneMatch[1] : (cPhoneRaw || undefined);

  const genderRaw = (fields["gender"] ?? "").trim().toUpperCase();
  const gender    = ["MALE", "FEMALE", "M", "F", "OTHER"].includes(genderRaw)
    ? (genderRaw === "M" ? "Male" : genderRaw === "F" ? "Female" : genderRaw.charAt(0) + genderRaw.slice(1).toLowerCase())
    : (genderRaw || undefined);

  return {
    data: {
      rowNumber,
      customerName,
      phone:       customerPhone,
      email:       (fields["email"]      ?? "").trim() || undefined,
      address:     (fields["address"]    ?? "").trim() || undefined,
      dateOfBirth: dateOfBirth ?? undefined,
      gender,
      creditLimit: creditLimit && !isNaN(creditLimit) ? creditLimit : undefined,
      openingDue:  openingDue  && !isNaN(openingDue)  ? openingDue  : undefined,
      abhaNumber:  (fields["abhaNumber"] ?? "").trim() || undefined,
      cardNumber:  (fields["cardNumber"] ?? "").trim() || undefined,
      notes:       (fields["notes"]      ?? "").trim() || undefined,
    },
    issues,
  };
}

// ── Doctor validation ───────────────────────────────────────────────────────

export function validateDoctorRow(
  row: ParsedRow,
): { data: ValidatedDoctorRow | null; issues: RowIssue[] } {
  const { rowNumber, fields } = row;
  const issues: RowIssue[] = [];

  const doctorName = (fields["doctorName"] ?? "").trim();
  if (!doctorName) {
    issues.push({ row: rowNumber, field: "doctorName", message: "Doctor name is required", severity: "error" });
    return { data: null, issues };
  }

  return {
    data: {
      rowNumber,
      doctorName,
      registrationNo: (fields["registrationNo"] ?? "").trim() || undefined,
      specialty:      (fields["specialty"]      ?? "").trim() || undefined,
      clinic:         (fields["clinic"]         ?? "").trim() || undefined,
      phone:          (fields["phone"]          ?? "").trim() || undefined,
      email:          (fields["email"]          ?? "").trim() || undefined,
    },
    issues,
  };
}
