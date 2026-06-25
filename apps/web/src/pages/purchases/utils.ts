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
  const lines = raw
    .replace(/^\uFEFF/, "") // strip Excel UTF-8 BOM
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n").filter(Boolean);
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

  // Flexible column mapping — handles "Medicine Name", "Qty", "P. Rate", etc.
  const mapping = inferColumnMapping(headers);
  const fieldIdx: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const f = mapping[headers[i]!] ?? "";
    if (f) fieldIdx[f] = i;
  }
  const get = (row: string[], field: string) => {
    const idx = fieldIdx[field];
    return idx !== undefined ? (row[idx] ?? "").trim() : "";
  };

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    if (row.every((c) => !c.trim())) continue; // skip blank rows

    const name = get(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicine name is required`); continue; }

    const qty  = parseFloat(get(row, "receivedQty") || get(row, "quantity") || "1");
    if (isNaN(qty) || qty <= 0) { errors.push(`Row ${line} (${name}): quantity must be > 0`); continue; }

    // Rate, MRP, GST are optional at PO stage — filled in when goods arrive
    const rate = parseFloat(get(row, "purchaseRate") || "0") || 0;
    const mrp  = parseFloat(get(row, "mrp")          || "0") || 0;
    const rawGst = parseFloat(get(row, "gstRate")    || "12");
    const gst  = [0, 5, 12, 18].includes(rawGst) ? rawGst : 12;

    const expiry = normalizeExpiryDate(get(row, "expiryDate"));

    items.push({
      medicineName: name,
      medicineId:   "",
      batchNumber:  get(row, "batchNumber"),
      expiryDate:   expiry,
      quantity:     Math.floor(qty),
      purchaseRate: rate,
      mrp,
      gstRate:      gst,
    });
  }
  return { items, errors };
}

// ─── Column inference + flexible row parser (for BulkImportPanel) ────────────

const COL_ALIASES: Record<string, string[]> = {
  medicineName: [
    "name","medicine","drug","item","product","description","particulars",
    "item name","medicine name","drug name","product name","items",
    "product description","drug description",
  ],
  batchNumber: [
    "batch","batch no","batch no.","batch number","batch#","lot",
    "lot no","lot number","batch num","mfg batch","batch code",
  ],
  expiryDate: [
    "expiry","exp","exp date","expiry date","expiration","exp. date",
    "expiry dt","exp dt","best before","use by","expiry(mm/yy)","exp(mm/yyyy)",
  ],
  receivedQty: [
    "qty","quantity","received","received qty","rcvd","units",
    "pcs","nos","received quantity","rcvd qty","recv qty","quantity received",
    "order qty","order quantity","req qty","required qty",
  ],
  purchaseRate: [
    "rate","purchase rate","buy rate","price","cost","ptr","pts",
    "buy price","purchase price","p. rate","p rate","unit price",
    "pur rate","basic rate","net rate","net price","p/rate",
  ],
  mrp: [
    "mrp","max retail price","selling price","retail price","sp",
    "sale price","m.r.p","m.r.p.","retail","mrp.","maximum retail price",
  ],
  gstRate: [
    "gst","gst%","tax","gst rate","tax rate","vat","gst %","tax %","igst",
  ],
  freeQty: [
    "free","free qty","bonus","free units","free quantity","bonus qty","free pcs","sample",
  ],
  discount: [
    "disc","disc%","discount","disc %","discount %","dis","dis%","disc.","cash discount",
  ],
};

export function inferColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const header of headers) {
    if (mapping[header] !== undefined) continue; // first occurrence wins for duplicate headers
    const h = header.toLowerCase().trim().replace(/['"]/g, "");
    let best = "";
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (used.has(field)) continue;
      if (aliases.some((a) => h === a || h.includes(a) || a.includes(h))) {
        best = field; break;
      }
    }
    mapping[header] = best;
    if (best) used.add(best);
  }
  return mapping;
}

function normalizeExpiryDate(s: string): string {
  s = s.trim();
  // MM/YYYY or MM-YYYY (Indian strip format: 06/2027)
  if (/^\d{1,2}[/-]\d{4}$/.test(s)) {
    const [m, y] = s.split(/[/-]/);
    return `${y}-${String(m).padStart(2, "0")}-01`;
  }
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }
  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }
  // MM/YY (e.g. 06/27 → 2027-06-01)
  if (/^\d{1,2}\/\d{2}$/.test(s)) {
    const [m, yy] = s.split("/");
    return `20${yy}-${String(m).padStart(2, "0")}-01`;
  }
  return s; // Already YYYY-MM-DD or unrecognised
}

export function parseWithMapping(
  rows:    string[][],
  headers: string[],
  mapping: Record<string, string>,
): { items: Partial<GRNLineItem>[]; errors: string[] } {
  const errors: string[] = [];
  const items:  Partial<GRNLineItem>[] = [];

  // field → column index
  const fieldIdx: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const f = mapping[headers[i]!] ?? "";
    if (f) fieldIdx[f] = i;
  }

  function get(row: string[], field: string): string {
    const idx = fieldIdx[field];
    return idx !== undefined ? (row[idx] ?? "").trim() : "";
  }

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    if (row.every((c) => !c.trim())) continue; // skip blank rows

    const name = get(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicine name is empty`); continue; }

    const rQty = parseFloat(get(row, "receivedQty") || "1");
    const rate = parseFloat(get(row, "purchaseRate") || "0");
    const mrp  = parseFloat(get(row, "mrp")          || "0");
    const gst  = parseFloat(get(row, "gstRate")       || "12");

    if (isNaN(rQty) || rQty <= 0) { errors.push(`Row ${line} (${name}): qty must be > 0`); continue; }
    if (isNaN(rate) || rate <= 0) { errors.push(`Row ${line} (${name}): purchase rate must be > 0`); continue; }
    if (isNaN(mrp)  || mrp  <= 0) { errors.push(`Row ${line} (${name}): MRP must be > 0`); continue; }
    if (![0, 5, 12, 18].includes(gst)) { errors.push(`Row ${line} (${name}): GST must be 0, 5, 12 or 18`); continue; }

    items.push({
      medicineName: name,
      medicineId:   "",
      batchNumber:  get(row, "batchNumber"),
      expiryDate:   normalizeExpiryDate(get(row, "expiryDate")),
      receivedQty:  Math.floor(rQty),
      freeQty:      Math.floor(parseFloat(get(row, "freeQty") || "0")),
      purchaseRate: rate,
      mrp,
      discount:     parseFloat(get(row, "discount") || "0"),
      gstRate:      gst,
      orderedQty:   0,
    });
  }
  return { items, errors };
}

export function csvToReturnItems(raw: string): { items: Partial<SRLineItem>[]; errors: string[] } {
  const { headers, rows } = parseRawRows(raw);
  const errors: string[]  = [];
  const items: Partial<SRLineItem>[] = [];

  // Flexible column mapping — handles "Medicine Name", "Batch", "Return Qty", etc.
  const mapping = inferColumnMapping(headers);
  // "returnQty" isn't in COL_ALIASES; treat it as receivedQty alias
  const returnQtyIdx = headers.findIndex((h) => {
    const lc = h.toLowerCase().trim();
    return lc.includes("return") && (lc.includes("qty") || lc.includes("quantity"));
  });

  const fieldIdx: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const f = mapping[headers[i]!] ?? "";
    if (f) fieldIdx[f] = i;
  }
  if (returnQtyIdx >= 0) fieldIdx["returnQty"] = returnQtyIdx;

  const get = (row: string[], field: string) => {
    const idx = fieldIdx[field];
    return idx !== undefined ? (row[idx] ?? "").trim() : "";
  };

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    if (row.every((c) => !c.trim())) continue;

    const name = get(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicine name is required`); continue; }

    const qty  = parseFloat(get(row, "returnQty") || get(row, "receivedQty") || "1");
    const rate = parseFloat(get(row, "purchaseRate") || "0");
    if (isNaN(qty)  || qty  <= 0) { errors.push(`Row ${line} (${name}): return qty must be > 0`);  continue; }
    if (isNaN(rate) || rate <  0) { errors.push(`Row ${line} (${name}): purchase rate must be ≥ 0`); continue; }

    const expiry = normalizeExpiryDate(get(row, "expiryDate"));

    items.push({
      inventoryId:  "",
      medicineId:   "",
      medicineName: name,
      batchNumber:  get(row, "batchNumber"),
      expiryDate:   expiry,
      quantity:     Math.floor(qty),
      purchaseRate: rate,
      reason:       "DAMAGED" as const,
    });
  }
  return { items, errors };
}
