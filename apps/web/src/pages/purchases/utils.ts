import { api } from "@/lib/api-client";
import type { GRNLineItem, Medicine, POLineItem, SRLineItem } from "./types";

/**
 * Client-side upload size cap, in MB. MUST match the server's
 * spring.servlet.multipart.max-file-size — the backend resets the connection on
 * anything larger, so we reject it here first for instant, clear feedback.
 */
export const MAX_UPLOAD_MB = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The one canonical way an imported medicine name is compared to a catalogue name:
 *  trimmed, lowercased, internal whitespace collapsed. Every comparison in the import
 *  flow MUST go through this so the resolution map keys and the row lookups agree. */
export function normalizeMedicineName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export type MedicineMatch = {
  /** Exact catalogue matches, keyed by normalized name. */
  resolved: Map<string, Medicine>;
  /** Searched successfully but no exact match exists — genuinely absent from the catalogue. */
  notInCatalogue: string[];
  /** The lookup request itself failed (offline / server error / rate-limited) — status unknown. */
  lookupFailed: string[];
};

/**
 * Match imported medicine NAMES against the catalogue.
 *
 * <p>CSV/PDF imports only ever carry a printed name — a distributor's invoice has no
 * idea what our internal medicine ids are. Every line item still has to reference a
 * catalogue entry, so without this step each imported row goes to the API with a blank
 * medicineId and the whole document is rejected.
 *
 * <p>Matching is exact on name (via {@link normalizeMedicineName}). The search endpoint
 * is fuzzy and will happily return "Paracetamol 650" for a query of "Paracetamol 500",
 * so a loose match here would silently book stock against the wrong product — far worse
 * than asking the user to pick.
 *
 * <p>The result deliberately separates "searched and not found" from "couldn't search":
 * a failed request must NOT be reported to the user as "not in your catalogue" (which
 * would send them to add a medicine that may already be there). The caller uses the two
 * buckets to give accurate advice — add/pick vs. retry.
 */
export async function resolveMedicinesByName(names: string[]): Promise<MedicineMatch> {
  const unique = [...new Set(names.map(normalizeMedicineName).filter(Boolean))];
  const resolved = new Map<string, Medicine>();
  const notInCatalogue: string[] = [];
  const lookupFailed: string[] = [];

  // Small concurrency cap — an imported invoice can carry 50+ lines and firing that
  // many parallel requests at the search endpoint trips its rate limiter (which would
  // itself land every remaining row in lookupFailed).
  const BATCH = 5;
  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH);
    await Promise.all(slice.map(async (name) => {
      try {
        const { data } = await api.get("/medicines/search", { params: { q: name, limit: 8 } });
        const list = Array.isArray(data?.data) ? (data.data as Medicine[]) : [];
        const hit = list.find((m) => normalizeMedicineName(m.name) === name);
        if (hit) resolved.set(name, hit);
        else notInCatalogue.push(name);
      } catch {
        lookupFailed.push(name);
      }
    }));
  }
  return { resolved, notInCatalogue, lookupFailed };
}

/**
 * Plain-language summary of an import that couldn't fully auto-link, written so the
 * user knows exactly which problem they have and what to do about it. Keeps the two
 * failure modes apart on purpose — telling someone to "add it to the catalogue" when
 * the lookup merely failed sends them down the wrong path. Returns null when there is
 * nothing to report (everything imported and matched).
 */
export function describeImportResolution(opts: {
  imported?: number;
  skipped?: number;
  notInCatalogue: number;
  lookupFailed: number;
}): string | null {
  const { imported, skipped = 0, notInCatalogue, lookupFailed } = opts;
  const bits: string[] = [];
  if (imported !== undefined) bits.push(`${imported} row${imported === 1 ? "" : "s"} imported.`);
  if (skipped > 0) bits.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped — the medicine name column was empty or unreadable.`);
  if (lookupFailed > 0) {
    bits.push(`${lookupFailed} ${lookupFailed === 1 ? "row" : "rows"} couldn't be checked against your catalogue — this is usually a connection problem, not missing data. Use "Retry matching", or pick each highlighted row manually.`);
  }
  if (notInCatalogue > 0) {
    bits.push(`${notInCatalogue} ${notInCatalogue === 1 ? "row isn't" : "rows aren't"} in your catalogue — for each highlighted row, pick a match or use its "+ Add" button to create it.`);
  }
  return bits.length > 0 && (skipped || lookupFailed || notInCatalogue) ? bits.join(" ") : null;
}

/** Fetches a fresh signed URL for an uploaded PO/GRN source PDF and opens it
 * in a new tab. Fails silently (signed URLs expire; the file may also have
 * been deleted) — there's nothing actionable for the user to do about it. */
export async function viewSourceUpload(uploadId: string) {
  try {
    const { data } = await api.get<{ data: { signedUrl: string | null } }>(`/uploads/${uploadId}/signed-url`);
    if (data.data.signedUrl) window.open(data.data.signedUrl, "_blank", "noopener,noreferrer");
  } catch {
    // ignore — nothing useful to surface here
  }
}

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
