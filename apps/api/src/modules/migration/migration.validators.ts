// ─── Row-level validation for each entity type ───────────────────────────────
// Returns errors (block import) and warnings (import with note).
// All validators work on the raw ParsedRow.fields object so the mapper stays
// separate from business logic.

import type { RowIssue } from "./migration.types.js";
import type { ParsedRow } from "./migration.mapper.js";
import { normaliseDate } from "./migration.mapper.js";

const NEAR_EXPIRY_DAYS = 90;
const VALID_GST_RATES  = new Set([0, 5, 12, 18]);

// GSTIN: 2-digit state code + 10-char PAN + entity number + Z + checksum
const GSTIN_RE  = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
// Indian mobile: optional +91 / 0 prefix followed by 10 digits starting with 6-9
const PHONE_RE  = /^(?:\+91|91|0)?([6-9][0-9]{9})$/;

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface ValidatedInventoryRow {
  rowNumber:    number;
  medicineName: string;
  batchNumber:  string;
  expiryDate:   string;      // ISO
  quantity:     number;
  mrp:          number;
  purchaseRate: number;
  gstRate:      number;
  manufacturer?: string;
  hsnCode?:     string;
  minimumStock?: number;
}

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

  const expiryDate = normaliseDate(expiryRaw);
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

  // Pricing anomaly warning
  if (!isNaN(mrp) && !isNaN(purchaseRate) && mrp > 0 && purchaseRate > mrp) {
    issues.push({ row: rowNumber, field: "purchaseRate", message: `Purchase rate (${purchaseRate}) exceeds MRP (${mrp})`, severity: "warning" });
  }

  const gstRate = parseFloat(gstRaw || "12");
  if (!VALID_GST_RATES.has(gstRate)) {
    issues.push({ row: rowNumber, field: "gstRate", message: `GST rate ${gstRate}% is not standard (0/5/12/18) — using 12%`, severity: "warning" });
  }

  // Expiry warnings
  if (expiryDate) {
    const expiry = new Date(expiryDate);
    const now    = new Date();
    const daysToExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (daysToExpiry < 0) {
      issues.push({ row: rowNumber, field: "expiryDate", message: `Batch expired on ${expiry.toLocaleDateString("en-IN")}`, severity: "warning" });
    } else if (daysToExpiry < NEAR_EXPIRY_DAYS) {
      issues.push({ row: rowNumber, field: "expiryDate", message: `Batch expires in ${Math.ceil(daysToExpiry)} days (near expiry)`, severity: "warning" });
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  if (hasErrors || !expiryDate) return { data: null, issues };

  const minimumStockRaw = (fields["minimumStock"] ?? "").trim();
  const minimumStock = minimumStockRaw ? parseInt(minimumStockRaw, 10) : undefined;

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

// ── Supplier ──────────────────────────────────────────────────────────────────

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

  const creditDaysRaw    = (fields["creditDays"]    ?? "").trim();
  const openingBalRaw    = (fields["openingBalance"] ?? "").trim();

  const creditDays    = creditDaysRaw    ? parseInt(creditDaysRaw, 10)    : undefined;
  const openingBalance = openingBalRaw   ? parseFloat(openingBalRaw)      : undefined;

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

  const phoneRaw  = (fields["phone"] ?? "").trim();
  const phoneMatch = phoneRaw ? PHONE_RE.exec(phoneRaw) : null;
  if (phoneRaw && !phoneMatch) {
    issues.push({ row: rowNumber, field: "phone", message: `Invalid phone number "${phoneRaw}" — expected 10-digit Indian mobile`, severity: "warning" });
  }
  const phone = phoneMatch ? phoneMatch[1] : (phoneRaw || undefined); // normalise to 10 digits

  return {
    data: {
      rowNumber,
      supplierName,
      gstin:          gstinRaw || undefined,
      dlNumber:       (fields["dlNumber"] ?? "").trim() || undefined,
      phone,
      email:          (fields["email"]    ?? "").trim() || undefined,
      address:        (fields["address"]  ?? "").trim() || undefined,
      city:           (fields["city"]     ?? "").trim() || undefined,
      state:          (fields["state"]    ?? "").trim() || undefined,
      creditDays:     creditDays && !isNaN(creditDays) ? creditDays : undefined,
      openingBalance: openingBalance && !isNaN(openingBalance) ? openingBalance : undefined,
    },
    issues,
  };
}

// ── Customer ──────────────────────────────────────────────────────────────────

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

  const dobRaw          = (fields["dateOfBirth"]  ?? "").trim();
  const creditLimitRaw  = (fields["creditLimit"]  ?? "").trim();
  const openingDueRaw   = (fields["openingDue"]   ?? "").trim();

  const dateOfBirth  = dobRaw          ? normaliseDate(dobRaw)            : undefined;
  const creditLimit  = creditLimitRaw  ? parseFloat(creditLimitRaw)       : undefined;
  const openingDue   = openingDueRaw   ? parseFloat(openingDueRaw)        : undefined;

  if (dobRaw && !dateOfBirth) {
    issues.push({ row: rowNumber, field: "dateOfBirth", message: `Cannot parse date of birth "${dobRaw}"`, severity: "warning" });
  }

  const cPhoneRaw   = (fields["phone"] ?? "").trim();
  const cPhoneMatch = cPhoneRaw ? PHONE_RE.exec(cPhoneRaw) : null;
  if (cPhoneRaw && !cPhoneMatch) {
    issues.push({ row: rowNumber, field: "phone", message: `Invalid phone number "${cPhoneRaw}" — expected 10-digit Indian mobile`, severity: "warning" });
  }
  const customerPhone = cPhoneMatch ? cPhoneMatch[1] : (cPhoneRaw || undefined);

  const genderRaw = (fields["gender"] ?? "").trim().toUpperCase();
  const gender    = ["MALE", "FEMALE", "M", "F", "OTHER"].includes(genderRaw)
    ? (genderRaw === "M" ? "Male" : genderRaw === "F" ? "Female" : genderRaw)
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

// ── Doctor ────────────────────────────────────────────────────────────────────

export interface ValidatedDoctorRow {
  rowNumber:      number;
  doctorName:     string;
  registrationNo?: string;
  specialty?:     string;
  clinic?:        string;
  phone?:         string;
  email?:         string;
}

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
