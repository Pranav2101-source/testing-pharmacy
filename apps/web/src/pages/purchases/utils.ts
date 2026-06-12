import type { GRNLineItem, POLineItem, SRLineItem } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export function currency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(n);
}

export function isOverdue(dueDate: string | null | undefined) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ─── CSV Templates ────────────────────────────────────────────────────────────

export const GRN_CSV_TEMPLATE =
  "medicineName,batchNumber,expiryDate,receivedQty,freeQty,purchaseRate,mrp,discount,gstRate\n" +
  "Paracetamol 500mg Strip,BATCH001,2027-06-30,100,5,4.50,8.00,0,12\n" +
  "Amoxicillin 250mg,BATCH002,2027-03-31,50,0,18.00,32.00,0,12\n";

export const PO_CSV_TEMPLATE =
  "medicineName,batchNumber,expiryDate,quantity,purchaseRate,mrp,gstRate\n" +
  "Paracetamol 500mg Strip,BATCH001,2027-06-30,100,4.50,8.00,12\n" +
  "Amoxicillin 250mg,BATCH002,2027-03-31,50,18.00,32.00,12\n";

export const RETURN_CSV_TEMPLATE =
  "medicineName,batchNumber,expiryDate,returnQty,purchaseRate\n" +
  "Paracetamol 500mg Strip,BATCH001,2025-12-31,10,4.50\n" +
  "Amoxicillin 250mg,BATCH002,2025-06-30,5,18.00\n";

export function downloadTemplate(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Client-side CSV/TSV parser ───────────────────────────────────────────────

export function parseRawRows(raw: string): { headers: string[]; rows: string[][] } {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n").filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const delim   = (lines[0] ?? "").includes("\t") ? "\t" : ",";
  const headers = (lines[0] ?? "").split(delim).map((h) => h.trim().replace(/^"|"$/g, "").trim());
  const rows    = lines.slice(1).map((l) =>
    l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "").trim())
  );
  return { headers, rows };
}

export function csvToGRNItems(raw: string): { items: Partial<GRNLineItem>[]; errors: string[] } {
  const { headers, rows } = parseRawRows(raw);
  const errors: string[]  = [];
  const items: Partial<GRNLineItem>[] = [];
  const col = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    const name = col(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicineName is required`); continue; }
    const rQty = parseFloat(col(row, "receivedQty") || "1");
    const rate = parseFloat(col(row, "purchaseRate") || "0");
    const mrp  = parseFloat(col(row, "mrp")          || "0");
    const gst  = parseFloat(col(row, "gstRate")       || "12");
    if (isNaN(rQty) || rQty <= 0)  { errors.push(`Row ${line}: receivedQty must be positive`); continue; }
    if (isNaN(rate) || rate <= 0)  { errors.push(`Row ${line}: purchaseRate must be positive`); continue; }
    if (isNaN(mrp)  || mrp  <= 0)  { errors.push(`Row ${line}: mrp must be positive`);          continue; }
    if (![0,5,12,18].includes(gst)){ errors.push(`Row ${line}: gstRate must be 0,5,12 or 18`); continue; }
    let expiry = col(row, "expiryDate");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(expiry)) {
      const [dd, mm, yyyy] = expiry.split("/");
      expiry = `${yyyy}-${mm}-${dd}`;
    }
    items.push({
      medicineName: name,
      medicineId:   "",
      batchNumber:  col(row, "batchNumber"),
      expiryDate:   expiry,
      receivedQty:  Math.floor(rQty),
      freeQty:      Math.floor(parseFloat(col(row, "freeQty") || "0")),
      purchaseRate: rate,
      mrp,
      discount:     parseFloat(col(row, "discount") || "0"),
      gstRate:      gst,
      orderedQty:   0,
    });
  }
  return { items, errors };
}

export function csvToPOItems(raw: string): { items: Partial<POLineItem>[]; errors: string[] } {
  const { headers, rows } = parseRawRows(raw);
  const errors: string[]  = [];
  const items: Partial<POLineItem>[] = [];
  const col = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    const name = col(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicineName is required`); continue; }
    const qty  = parseFloat(col(row, "quantity")     || "1");
    const rate = parseFloat(col(row, "purchaseRate") || "0");
    const mrp  = parseFloat(col(row, "mrp")          || "0");
    const gst  = parseFloat(col(row, "gstRate")       || "12");
    if (isNaN(qty)  || qty  <= 0) { errors.push(`Row ${line}: quantity must be positive`);       continue; }
    if (isNaN(rate) || rate <= 0) { errors.push(`Row ${line}: purchaseRate must be positive`);   continue; }
    if (isNaN(mrp)  || mrp  <= 0) { errors.push(`Row ${line}: mrp must be positive`);            continue; }
    if (![0,5,12,18].includes(gst)){ errors.push(`Row ${line}: gstRate must be 0,5,12 or 18`);  continue; }
    let expiry = col(row, "expiryDate");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(expiry)) {
      const [dd, mm, yyyy] = expiry.split("/");
      expiry = `${yyyy}-${mm}-${dd}`;
    }
    items.push({
      medicineName: name,
      medicineId:   "",
      batchNumber:  col(row, "batchNumber"),
      expiryDate:   expiry,
      quantity:     Math.floor(qty),
      purchaseRate: rate,
      mrp,
      gstRate:      gst,
    });
  }
  return { items, errors };
}

export function csvToReturnItems(raw: string): { items: Partial<SRLineItem>[]; errors: string[] } {
  const { headers, rows } = parseRawRows(raw);
  const errors: string[]  = [];
  const items: Partial<SRLineItem>[] = [];
  const col = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    const name = col(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicineName is required`); continue; }
    const qty  = parseFloat(col(row, "returnQty") || "1");
    const rate = parseFloat(col(row, "purchaseRate") || "0");
    if (isNaN(qty)  || qty  <= 0) { errors.push(`Row ${line}: returnQty must be positive`);    continue; }
    if (isNaN(rate) || rate <= 0) { errors.push(`Row ${line}: purchaseRate must be positive`); continue; }
    let expiry = col(row, "expiryDate");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(expiry)) {
      const [dd, mm, yyyy] = expiry.split("/");
      expiry = `${yyyy}-${mm}-${dd}`;
    }
    items.push({
      inventoryId:  "",
      medicineId:   "",
      medicineName: name,
      batchNumber:  col(row, "batchNumber"),
      expiryDate:   expiry,
      quantity:     Math.floor(qty),
      purchaseRate: rate,
      reason:       "DAMAGED" as const,
    });
  }
  return { items, errors };
}
