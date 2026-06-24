/**
 * BulkImportPanel — Option A + B combined
 *
 * Option A: Download template → fill in Excel → upload CSV or drag-drop
 * Option B: Copy cells in Excel/Sheets → Ctrl+V anywhere → data appears here
 *
 * After data is loaded, a column mapper auto-infers which column is which
 * (fuzzy match against common Indian invoice column names). User can override
 * any mapping via dropdown. A live preview table shows the first 4 rows.
 * One click imports all valid rows into the GRN form.
 */
import { useState, useRef, useCallback } from "react";
import {
  FileSpreadsheet, Download, X, Check, AlertTriangle,
  ChevronRight, ClipboardPaste, Loader2, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  GRN_CSV_TEMPLATE, downloadTemplate,
  parseRawRows, inferColumnMapping, parseWithMapping,
} from "../utils";
import type { GRNLineItem } from "../types";

// ─── Field metadata ───────────────────────────────────────────────────────────

const FIELD_OPTIONS = [
  { value: "",             label: "— Skip this column —" },
  { value: "medicineName", label: "Medicine Name",  req: true  },
  { value: "batchNumber",  label: "Batch Number",   req: true  },
  { value: "expiryDate",   label: "Expiry Date",    req: true  },
  { value: "receivedQty",  label: "Received Qty",   req: true  },
  { value: "purchaseRate", label: "Purchase Rate ₹",req: true  },
  { value: "mrp",          label: "MRP ₹",          req: true  },
  { value: "gstRate",      label: "GST Rate %",     req: false },
  { value: "freeQty",      label: "Free Qty",       req: false },
  { value: "discount",     label: "Discount %",     req: false },
];

const REQUIRED = FIELD_OPTIONS.filter((f) => f.req).map((f) => f.value);

// ─── Component ────────────────────────────────────────────────────────────────

export function BulkImportPanel({ initialRaw = "", onImport, onClose }: {
  initialRaw?: string;
  onImport: (items: GRNLineItem[]) => void;
  onClose: () => void;
}) {
  const [raw,      setRaw]      = useState(initialRaw);
  const [headers,  setHeaders]  = useState<string[]>(() => initialRaw ? parseRawRows(initialRaw).headers : []);
  const [rows,     setRows]     = useState<string[][]>(() => initialRaw ? parseRawRows(initialRaw).rows : []);
  const [mapping,  setMapping]  = useState<Record<string, string>>(() =>
    initialRaw ? inferColumnMapping(parseRawRows(initialRaw).headers) : {},
  );
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load raw text (file or paste) ────────────────────────────────────────

  const loadRaw = useCallback((text: string) => {
    setRaw(text);
    const { headers: h, rows: r } = parseRawRows(text);
    setHeaders(h);
    setRows(r);
    setMapping(h.length > 0 ? inferColumnMapping(h) : {});
  }, []);

  function readFile(file: File) {
    const r = new FileReader();
    r.onload = (e) => loadRaw((e.target?.result as string) ?? "");
    r.readAsText(file);
  }

  function reset() { setRaw(""); setHeaders([]); setRows([]); setMapping({}); }

  // ── Derived state ─────────────────────────────────────────────────────────

  const hasData = headers.length > 0 && rows.length > 0;

  const missingRequired = REQUIRED.filter(
    (f) => !Object.values(mapping).includes(f),
  );

  const { items: parsed, errors } =
    hasData && missingRequired.length === 0
      ? parseWithMapping(rows, headers, mapping)
      : { items: [], errors: [] };

  const validCount  = parsed.length;
  const errorCount  = errors.length;
  const previewRows = parsed.slice(0, 4);

  // ── Column badge colour ───────────────────────────────────────────────────

  function colCls(val: string) {
    if (REQUIRED.includes(val))  return "border-emerald-300 text-emerald-700 bg-emerald-50";
    if (val)                     return "border-slate-300 text-slate-600 bg-white";
    return "border-slate-200 text-slate-400 bg-white";
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-blue-200 bg-white overflow-hidden shadow-sm">

      {/* ── Panel header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-50 to-white border-b border-blue-100">
        <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-slate-800">Bulk Import</p>
          <p className="text-[11px] text-slate-400">From Excel, CSV, or paste — any column order</p>
        </div>
        <button type="button"
          onClick={() => downloadTemplate("grn_import_template.csv", GRN_CSV_TEMPLATE)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg px-2.5 py-1.5 transition-colors">
          <Download className="w-3 h-3" />Template
        </button>
        <button type="button" onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-4">

        {/* ── STEP 1: No data yet — load zone ───────────────────────── */}
        {!hasData && (
          <div className="space-y-3">

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragging(false);
                const f = e.dataTransfer.files[0]; if (f) readFile(f);
              }}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all",
                dragging
                  ? "border-blue-400 bg-blue-50"
                  : "border-slate-200 hover:border-blue-300 hover:bg-slate-50/60",
              )}>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
              <FileSpreadsheet className={cn("w-8 h-8 mx-auto mb-2", dragging ? "text-blue-400" : "text-slate-300")} />
              <p className="text-[13px] font-semibold text-slate-600">Drop CSV file here or click to browse</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Excel → Save As → CSV, then drop here &nbsp;·&nbsp; Or use the template above
              </p>
            </div>

            {/* Paste zone */}
            <div className="relative">
              <div className="absolute -top-2 inset-x-6 flex justify-center z-10">
                <span className="bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  or paste directly from Excel / Sheets
                </span>
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50/60 border-b border-slate-100">
                  <ClipboardPaste className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <p className="text-[11px] text-slate-500">
                    Select rows in Excel or Sheets → <kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono">Ctrl+C</kbd>
                    → click below → <kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono">Ctrl+V</kbd>
                  </p>
                </div>
                <textarea
                  value={raw}
                  onChange={(e) => loadRaw(e.target.value)}
                  placeholder={"Paste your rows here…\n(Include the header row — column order doesn't matter)"}
                  rows={4}
                  className="w-full px-3 py-2.5 text-[11px] font-mono resize-none focus:outline-none placeholder-slate-300 bg-white" />
              </div>
            </div>

            {/* Hint row */}
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
              <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" /> Any column order — we'll match them</span>
              <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" /> Indian date formats (MM/YYYY, DD/MM/YYYY)</span>
              <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" /> Live preview before import</span>
            </div>
          </div>
        )}

        {/* ── STEP 2 + 3: Data loaded — mapper + preview ────────────── */}
        {hasData && (
          <>
            {/* Stats bar */}
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-slate-500">
                <span className="font-bold text-slate-800">{rows.length}</span> row{rows.length !== 1 ? "s" : ""} detected
                {headers.length > 0 && <> · <span className="font-bold text-slate-800">{headers.length}</span> columns</>}
              </p>
              <button type="button" onClick={reset}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
                <RotateCcw className="w-3 h-3" />Start over
              </button>
            </div>

            {/* Column mapper */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_1fr] bg-slate-50 border-b border-slate-200 px-3 py-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Your column</p>
                <div />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Maps to</p>
              </div>
              <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
                {headers.map((h) => {
                  const val = mapping[h] ?? "";
                  return (
                    <div key={h} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 hover:bg-slate-50/60">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[120px]"
                          title={h}>
                          {h}
                        </span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                      <select
                        value={val}
                        onChange={(e) => setMapping((p) => ({ ...p, [h]: e.target.value }))}
                        className={cn(
                          "w-full border rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-300 transition-colors",
                          colCls(val),
                        )}>
                        {FIELD_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Missing required fields warning */}
            {missingRequired.length > 0 && (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[12px] font-semibold text-amber-800">Still need to map:</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    {missingRequired
                      .map((f) => FIELD_OPTIONS.find((o) => o.value === f)?.label ?? f)
                      .join(" · ")}
                  </p>
                  <p className="text-[10px] text-amber-600 mt-1">
                    Use the dropdowns above to match these to your columns. Select "Skip" to use defaults (GST = 12%, discount = 0).
                  </p>
                </div>
              </div>
            )}

            {/* Live preview table */}
            {missingRequired.length === 0 && previewRows.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-1.5 flex items-center gap-2">
                  Preview
                  <span className="font-normal text-slate-400">— first {previewRows.length} of {validCount + errorCount} rows</span>
                </p>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="w-5 px-2 py-1.5" />
                        {["Medicine","Batch","Expiry","Qty","Rate ₹","MRP ₹"].map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((item, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-1.5 text-center">
                            <Check className="w-3 h-3 text-emerald-500 mx-auto" />
                          </td>
                          <td className="px-2 py-1.5 text-[11px] font-medium text-slate-800 max-w-[120px] truncate">{item.medicineName}</td>
                          <td className="px-2 py-1.5 text-[11px] font-mono text-slate-500">
                            {item.batchNumber || <span className="text-amber-400 font-sans">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-[11px] text-slate-500">
                            {item.expiryDate || <span className="text-amber-400">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-[11px] tabular-nums text-slate-700 text-right">{item.receivedQty}</td>
                          <td className="px-2 py-1.5 text-[11px] tabular-nums text-slate-700 text-right">{item.purchaseRate?.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-[11px] tabular-nums text-slate-700 text-right">{item.mrp?.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {validCount > previewRows.length && (
                    <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 text-center text-[11px] text-slate-400">
                      + {validCount - previewRows.length} more medicine{validCount - previewRows.length !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Row errors */}
            {errors.length > 0 && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 space-y-1">
                <p className="text-[11px] font-bold text-red-700">
                  {errors.length} row{errors.length !== 1 ? "s" : ""} will be skipped:
                </p>
                {errors.slice(0, 5).map((e, i) => (
                  <p key={i} className="text-[11px] text-red-600">· {e}</p>
                ))}
                {errors.length > 5 && (
                  <p className="text-[11px] text-red-400">…and {errors.length - 5} more</p>
                )}
              </div>
            )}

            {/* Import CTA */}
            {validCount > 0 ? (
              <button type="button"
                onClick={() => onImport(parsed as GRNLineItem[])}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-[13px] font-bold py-3 rounded-xl shadow-sm transition-colors">
                <Check className="w-4 h-4" />
                Add {validCount} medicine{validCount !== 1 ? "s" : ""} to GRN
                {errorCount > 0 && (
                  <span className="text-blue-200 text-[11px] font-normal ml-1">
                    ({errorCount} row{errorCount !== 1 ? "s" : ""} skipped)
                  </span>
                )}
              </button>
            ) : missingRequired.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-3 text-[12px] text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Parsing rows…
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
