// Bulk GRN import — parses a CSV/TSV uploaded as multipart form data.
// Expected CSV columns (header row required):
//   medicineName, batchNumber, expiryDate (YYYY-MM-DD), receivedQty, freeQty,
//   purchaseRate, mrp, discount, gstRate, supplierInvoiceNo (optional)
//
// One GRN is created per unique supplierInvoiceNo (or one GRN for the whole file).

import { AppError } from "../../lib/AppError.js";

export interface ImportedGRNRow {
  medicineName:      string;
  batchNumber:       string;
  expiryDate:        string;
  receivedQty:       number;
  freeQty:           number;
  purchaseRate:      number;
  mrp:               number;
  discount:          number;
  gstRate:           number;
  supplierInvoiceNo?: string;
}

const REQUIRED_HEADERS = [
  "medicineName", "batchNumber", "expiryDate",
  "receivedQty", "purchaseRate", "mrp", "gstRate",
] as const;

/** Parse and validate a date string in YYYY-MM-DD or DD/MM/YYYY format.
 *  Returns an ISO string or throws AppError with a row-contextual message. */
function parseExpiryDate(raw: string, rowLabel: string): string {
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    iso = raw;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("/");
    iso = `${yyyy}-${mm}-${dd}`;
  } else {
    throw AppError.unprocessable(`${rowLabel}: expiryDate must be YYYY-MM-DD or DD/MM/YYYY, got "${raw}"`);
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    throw AppError.unprocessable(`${rowLabel}: expiryDate "${raw}" is not a valid calendar date`);
  }
  // V8 silently overflows invalid day-of-month values (e.g. Feb 30 → Mar 2).
  // Re-check the UTC fields match the input parts so such dates are caught.
  const [yyyy, mm, dd] = iso.split("-").map(Number);
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() + 1 !== mm || d.getUTCDate() !== dd) {
    throw AppError.unprocessable(`${rowLabel}: expiryDate "${raw}" is not a valid calendar date`);
  }
  return d.toISOString();
}

export function parseGRNCSV(csvText: string): ImportedGRNRow[] {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) throw AppError.unprocessable("CSV must have a header row and at least one data row");

  // Auto-detect delimiter: Excel / Google Sheets paste uses TAB; standard CSV uses comma.
  const firstLine = lines[0] ?? "";
  const delim     = firstLine.includes("\t") ? "\t" : ",";

  const headers = firstLine.split(delim).map((h) => h.trim().replace(/^"|"$/g, ""));

  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      throw AppError.unprocessable(`Missing required CSV column: ${required}`);
    }
  }

  const idx = (col: string) => headers.indexOf(col);

  const rows: ImportedGRNRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;

    const cols: string[] = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
    const col = (name: string): string => cols[idx(name)] ?? "";
    const rowLabel = `Row ${i + 1}`;

    const medicineName  = col("medicineName");
    const batchNumber   = col("batchNumber");
    const expiryDateRaw = col("expiryDate");

    if (!medicineName || !batchNumber || !expiryDateRaw) {
      throw AppError.unprocessable(`${rowLabel}: medicineName, batchNumber, and expiryDate are required`);
    }

    // Numeric fields — reject blank/missing cells rather than silently defaulting to 0.
    const receivedQtyRaw  = col("receivedQty").trim();
    const purchaseRateRaw = col("purchaseRate").trim();
    const mrpRaw          = col("mrp").trim();

    if (!receivedQtyRaw)  throw AppError.unprocessable(`${rowLabel}: receivedQty is required`);
    if (!purchaseRateRaw) throw AppError.unprocessable(`${rowLabel}: purchaseRate is required`);
    if (!mrpRaw)          throw AppError.unprocessable(`${rowLabel}: mrp is required`);

    const receivedQty  = parseFloat(receivedQtyRaw);
    const freeQty      = parseFloat(col("freeQty")  || "0");
    const purchaseRate = parseFloat(purchaseRateRaw);
    const mrp          = parseFloat(mrpRaw);
    const discount     = parseFloat(col("discount") || "0");
    const gstRate      = parseFloat(col("gstRate")  || "12");
    const supplierInvoiceNo = idx("supplierInvoiceNo") >= 0 ? (col("supplierInvoiceNo") || undefined) : undefined;

    if (isNaN(receivedQty) || receivedQty <= 0)  throw AppError.unprocessable(`${rowLabel}: receivedQty must be a positive number`);
    if (isNaN(purchaseRate) || purchaseRate <= 0) throw AppError.unprocessable(`${rowLabel}: purchaseRate must be a positive number`);
    if (isNaN(mrp) || mrp <= 0)                  throw AppError.unprocessable(`${rowLabel}: mrp must be a positive number`);
    if (![0, 5, 12, 18].includes(gstRate))        throw AppError.unprocessable(`${rowLabel}: gstRate must be 0, 5, 12, or 18`);

    const expiryDate = parseExpiryDate(expiryDateRaw, rowLabel);

    rows.push({
      medicineName,
      batchNumber,
      expiryDate,
      receivedQty:  Math.floor(receivedQty),
      freeQty:      Math.floor(isNaN(freeQty) ? 0 : freeQty),
      purchaseRate,
      mrp,
      discount:     isNaN(discount) ? 0 : discount,
      gstRate,
      supplierInvoiceNo,
    });
  }

  if (rows.length === 0) throw AppError.unprocessable("No valid rows found in CSV");

  return rows;
}
