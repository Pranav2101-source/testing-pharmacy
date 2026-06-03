// Bulk GRN import — parses a CSV/TSV uploaded as multipart form data.
// Expected CSV columns (header row required):
//   medicineName, batchNumber, expiryDate (YYYY-MM-DD), receivedQty, freeQty,
//   purchaseRate, mrp, discount, gstRate, supplierInvoiceNo (optional)
//
// One GRN is created per unique supplierInvoiceNo (or one GRN for the whole file).

import type { FastifyRequest } from "fastify";
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

export function parseGRNCSV(csvText: string): ImportedGRNRow[] {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) throw AppError.unprocessable("CSV must have a header row and at least one data row");

  const headers = (lines[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

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

    const cols: string[] = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    const col = (name: string): string => cols[idx(name)] ?? "";
    const medicineName  = col("medicineName");
    const batchNumber   = col("batchNumber");
    const expiryDateRaw = col("expiryDate");
    const receivedQty   = parseFloat(col("receivedQty")  || "0");
    const freeQty       = parseFloat(col("freeQty")      || "0");
    const purchaseRate  = parseFloat(col("purchaseRate") || "0");
    const mrp           = parseFloat(col("mrp")          || "0");
    const discount      = parseFloat(col("discount")     || "0");
    const gstRate       = parseFloat(col("gstRate")      || "12");
    const supplierInvoiceNo = idx("supplierInvoiceNo") >= 0 ? (col("supplierInvoiceNo") || undefined) : undefined;

    if (!medicineName || !batchNumber || !expiryDateRaw) {
      throw AppError.unprocessable(`Row ${i + 1}: medicineName, batchNumber, and expiryDate are required`);
    }
    if (isNaN(receivedQty) || receivedQty <= 0) {
      throw AppError.unprocessable(`Row ${i + 1}: receivedQty must be a positive number`);
    }
    if (isNaN(purchaseRate) || purchaseRate <= 0) {
      throw AppError.unprocessable(`Row ${i + 1}: purchaseRate must be a positive number`);
    }
    if (isNaN(mrp) || mrp <= 0) {
      throw AppError.unprocessable(`Row ${i + 1}: mrp must be a positive number`);
    }
    if (![0, 5, 12, 18].includes(gstRate)) {
      throw AppError.unprocessable(`Row ${i + 1}: gstRate must be 0, 5, 12, or 18`);
    }

    // Parse expiryDate — accept YYYY-MM-DD or DD/MM/YYYY
    let expiryDate: string;
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiryDateRaw)) {
      expiryDate = new Date(expiryDateRaw).toISOString();
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(expiryDateRaw)) {
      const [dd, mm, yyyy] = expiryDateRaw.split("/");
      expiryDate = new Date(`${yyyy}-${mm}-${dd}`).toISOString();
    } else {
      throw AppError.unprocessable(`Row ${i + 1}: expiryDate must be YYYY-MM-DD or DD/MM/YYYY`);
    }

    rows.push({ medicineName, batchNumber, expiryDate, receivedQty: Math.floor(receivedQty), freeQty: Math.floor(freeQty), purchaseRate, mrp, discount, gstRate, supplierInvoiceNo });
  }

  if (rows.length === 0) throw AppError.unprocessable("No valid rows found in CSV");

  return rows;
}
