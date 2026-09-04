

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus, Search, SlidersHorizontal, ChevronDown, Loader2,
  FileX, AlertCircle, Pencil, PowerOff, Power, X, Check,
  RefreshCw, FlaskConical, Upload, Download, CheckCircle2, XCircle,
  BadgePercent, ScanLine, Scissors,
} from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { TableSkeletonRows } from "@/components/Skeleton";
import { useToast } from "@/hooks/useToast";
import { isPlatformAdmin, getStoredUser } from "@/lib/auth";
import { BarcodeMappingModal } from "@/components/BarcodeMappingModal";
import { IconGridPicker } from "@/components/IconGridPicker";
import { PACKAGING_UNITS, PRODUCT_CATEGORIES, ProductTag } from "@/lib/product-taxonomy";

// ─── Types ────────────────────────────────────────────────────────────────────

type Medicine = {
  id:           string;
  name:         string;
  genericName:  string | null;
  manufacturer: string | null;
  composition:  string | null;
  category:     string | null;
  schedule:     string | null;
  hsnCode:      string | null;
  gstRate:      number;
  form:         string | null;
  strength:     string | null;
  unit:         string | null;
  packSize:     string | null;
  unitsPerPack: number | null;
  baseUnit:     string | null;
  isActive:     boolean;
};

// Per-pharmacy override of catalog values (gstRate/discount/loose); null = catalog value
type Override = {
  medicineId:            string;
  gstRate:               number | null;
  defaultDiscountPct:    number | null;
  notes:                 string | null;
  allowLooseSale:        boolean;
  looseByDefault:        boolean;
  looseConfirmedAt:      string | null;
  unitsPerPack:          number | null;  // this override's own pack size
  effectiveUnitsPerPack: number | null;  // what billing will use
};

type FormState = {
  name:         string;
  genericName:  string;
  manufacturer: string;
  composition:  string;
  category:     string;
  schedule:     string;
  hsnCode:      string;
  gstRate:      string;
  form:         string;
  strength:     string;
  unit:         string;
  packSize:     string;
  unitsPerPack: string;
  baseUnit:     string;
};

const BLANK: FormState = {
  name: "", genericName: "", manufacturer: "", composition: "",
  category: "", schedule: "", hsnCode: "", gstRate: "12",
  form: "", strength: "", unit: "", packSize: "",
  unitsPerPack: "", baseUnit: "",
};

const BASE_UNITS = ["TABLET", "CAPSULE", "ML", "GM", "EACH"] as const;

const SCHEDULES = ["OTC", "H", "H1", "X", "G"];
const FORMS     = ["tablet", "capsule", "syrup", "injection", "cream", "drops", "sachet", "gel", "powder", "inhaler", "suspension", "lotion", "ointment", "patch", "spray"];
const GST_RATES = ["0", "5", "12", "18"];

const SCHEDULE_CFG: Record<string, { cls: string; title: string }> = {
  OTC: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", title: "Over the Counter — no prescription required"                           },
  H:   { cls: "bg-amber-50   text-amber-700   border-amber-200",   title: "Schedule H — prescription required; must record sale"                  },
  H1:  { cls: "bg-orange-50  text-orange-700  border-orange-200",  title: "Schedule H1 — stricter control; maintain sales register"               },
  X:   { cls: "bg-red-50     text-red-600     border-red-200",     title: "Schedule X — psychotropic/narcotic; licence + register mandatory"     },
  G:   { cls: "bg-blue-50    text-blue-600    border-blue-200",    title: "Schedule G — caution label required; medical supervision recommended"  },
};

// ─── Small reusable field ─────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors",
        className,
      )}
    />
  );
}

function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors bg-white"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

const REQUIRED_COLS = ["name"] as const;
const ALL_COLS = ["name","genericName","manufacturer","composition","category","schedule","hsnCode","gstRate","form","strength","unit","packSize"] as const;

type ParsedRow = Record<string, string>;
type PreviewRow = { [key: string]: string | boolean | undefined; _valid: boolean; _error?: string };

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: ParsedRow = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
}

// Excel → rows. Reads the FIRST sheet as an array-of-arrays (header row + data),
// mapping columns by header name — the same object shape parseCSV produces, so
// the preview/validation/submit pipeline is shared. Going via rows (not CSV)
// avoids the comma-in-cell breakage of naive CSV splitting.
function aoaToRows(aoa: unknown[][]): ParsedRow[] {
  if (aoa.length < 2) return [];
  const headers = (aoa[0] ?? []).map((h) => String(h ?? "").trim());
  return aoa
    .slice(1)
    .filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => {
      const row: ParsedRow = {};
      headers.forEach((h, i) => { if (h) row[h] = String(r[i] ?? "").trim(); });
      return row;
    });
}

async function parseUpload(file: File): Promise<ParsedRow[]> {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await import("@e965/xlsx");
    const wb   = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const ws   = wb.Sheets[wb.SheetNames[0]!];
    if (!ws) return [];
    const aoa  = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "", raw: false });
    return aoaToRows(aoa);
  }
  return parseCSV(await file.text());
}

function validateRow(row: ParsedRow): { valid: boolean; error?: string } {
  if (!row.name?.trim()) return { valid: false, error: "name is required" };
  if (row.gstRate && !["0","5","12","18"].includes(String(row.gstRate).trim())) {
    return { valid: false, error: "gstRate must be 0, 5, 12, or 18" };
  }
  if (row.hsnCode && !/^\d{8}$/.test(row.hsnCode.trim())) {
    return { valid: false, error: "hsnCode must be 8 digits" };
  }
  return { valid: true };
}

// ─── Bulk Upload Modal ────────────────────────────────────────────────────────

function BulkUploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows,      setRows]      = useState<PreviewRow[]>([]);
  const [step,      setStep]      = useState<"upload" | "preview" | "result">("upload");
  const [uploading, setUploading] = useState(false);
  const [result,    setResult]    = useState<{ added: number; skipped: number; failed: number; parseErrors: string[] } | null>(null);
  const [dragOver,  setDragOver]  = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setParseError(null);
    try {
      const parsed = await parseUpload(file);
      if (parsed.length === 0) {
        setParseError("No data rows found. Make sure the first row has column headers (name, gstRate, …) and there is at least one row below it.");
        return;
      }
      const preview: PreviewRow[] = parsed.map((row) => {
        const { valid, error } = validateRow(row);
        return { ...row, _valid: valid, _error: error };
      });
      setRows(preview);
      setStep("preview");
    } catch {
      setParseError("Couldn't read that file. Upload a .csv or .xlsx exported from Excel / Google Sheets.");
    }
  }

  async function submit() {
    const str = (v: string | boolean | undefined) =>
      typeof v === "string" ? v.trim() || undefined : undefined;

    const validRows = rows.filter((r) => r._valid).map((r) => ({
      name:         str(r.name),
      genericName:  str(r.genericName),
      manufacturer: str(r.manufacturer),
      composition:  str(r.composition),
      category:     str(r.category),
      schedule:     str(r.schedule),
      hsnCode:      str(r.hsnCode),
      gstRate:      r.gstRate ? Number(r.gstRate) : 12,
      form:         str(r.form),
      strength:     str(r.strength),
      unit:         str(r.unit),
      packSize:     str(r.packSize),
    }));
    setUploading(true);
    try {
      const { data } = await api.post("/medicines/bulk", { rows: validRows });
      setResult(data.data);
      setStep("result");
    } catch {
      setResult({ added: 0, skipped: 0, failed: validRows.length, parseErrors: ["Upload failed. Please try again."] });
      setStep("result");
    } finally {
      setUploading(false);
    }
  }

  const validCount   = rows.filter((r) => r._valid).length;
  const invalidCount = rows.filter((r) => !r._valid).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.96, y: 10  }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <Upload className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-slate-900">Bulk Upload Medicines</h2>
              <p className="text-[11px] text-slate-400">Upload a CSV file to add multiple medicines at once</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Step 1 — Upload */}
          {step === "upload" && (
            <div className="p-6">
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                  dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-blue-300 hover:bg-slate-50",
                )}
              >
                <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-[14px] font-semibold text-slate-600">Drop your Excel or CSV file here</p>
                <p className="text-[12px] text-slate-400 mt-1">or click to browse</p>
                <p className="text-[11px] text-slate-300 mt-3">Supports .xlsx, .xls, .csv · Max 5,000 rows</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>

              {parseError && (
                <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] text-red-600">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{parseError}
                </div>
              )}

              {/* Template download */}
              <div className="mt-4 flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-[13px] font-semibold text-slate-700">Need the template?</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Download a CSV with the correct column headers pre-filled</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const sample = [
                      "Dolo 650","Paracetamol","Micro Labs","Paracetamol 650mg",
                      "Analgesic","OTC","30049099","12","tablet","650mg","strip","15 tablets",
                    ];
                    const csv = [ALL_COLS.join(","), sample.join(",")].join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement("a");
                    a.href     = url; a.download = "medicine-template.csv"; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded-lg px-3 py-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
              </div>

              {/* Column guide */}
              <div className="mt-4">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Required columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_COLS.map((col) => (
                    <span key={col} className={cn(
                      "text-[11px] font-medium rounded-full px-2.5 py-0.5 border",
                      REQUIRED_COLS.includes(col as any)
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "bg-slate-50 text-slate-500 border-slate-200",
                    )}>
                      {col}{REQUIRED_COLS.includes(col as any) ? " *" : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Preview */}
          {step === "preview" && (
            <div className="flex flex-col">
              {/* Summary bar */}
              <div className="flex items-center gap-4 px-6 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" /> {validCount} valid
                </span>
                {invalidCount > 0 && (
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-red-600">
                    <XCircle className="w-4 h-4" /> {invalidCount} invalid (will be skipped)
                  </span>
                )}
                <span className="text-[12px] text-slate-400 ml-auto">{rows.length} rows total</span>
              </div>

              {/* Table */}
              <div className="overflow-auto max-h-[380px]">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-semibold text-slate-500 w-8">#</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Generic</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Manufacturer</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Form</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">GST%</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={cn("border-b border-slate-50", !row._valid && "bg-red-50/40")}>
                        <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-800 max-w-[160px] truncate">{row.name || <span className="text-red-400">—</span>}</td>
                        <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{row.genericName || "—"}</td>
                        <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{row.manufacturer || "—"}</td>
                        <td className="px-3 py-2 text-slate-500 capitalize">{row.form || "—"}</td>
                        <td className="px-3 py-2 text-slate-500">{row.gstRate || "12"}</td>
                        <td className="px-3 py-2">
                          {row._valid ? (
                            <span className="flex items-center gap-1 text-emerald-600 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Valid</span>
                          ) : (
                            <span className="flex items-center gap-1 text-red-500 font-semibold" title={row._error}><XCircle className="w-3.5 h-3.5" /> {row._error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 3 — Result */}
          {step === "result" && result && (
            <div className="p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="text-[18px] font-bold text-slate-900 mb-1">Upload Complete</h3>
              <div className="flex items-center justify-center gap-6 mt-4">
                <div className="text-center">
                  <p className="text-[28px] font-black text-emerald-600">{result.added}</p>
                  <p className="text-[12px] text-slate-400 font-medium">Added</p>
                </div>
                <div className="text-center">
                  <p className="text-[28px] font-black text-amber-500">{result.skipped}</p>
                  <p className="text-[12px] text-slate-400 font-medium">Skipped (duplicates)</p>
                </div>
                <div className="text-center">
                  <p className="text-[28px] font-black text-red-500">{result.failed}</p>
                  <p className="text-[12px] text-slate-400 font-medium">Failed</p>
                </div>
              </div>
              {result.parseErrors.length > 0 && (
                <div className="mt-4 text-left bg-red-50 border border-red-100 rounded-xl p-3 max-h-32 overflow-y-auto">
                  {result.parseErrors.map((e, i) => (
                    <p key={i} className="text-[11px] text-red-600">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 flex-shrink-0">
          {step === "preview" && (
            <button onClick={() => setStep("upload")} className="text-[13px] text-slate-500 hover:text-slate-700 transition-colors">
              ← Back
            </button>
          )}
          {step !== "preview" && <div />}

          <div className="flex gap-3">
            <button
              onClick={step === "result" ? onDone : onClose}
              className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50 transition-colors"
            >
              {step === "result" ? "Done" : "Cancel"}
            </button>
            {step === "preview" && validCount > 0 && (
              <button
                onClick={submit}
                disabled={uploading}
                className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Upload {validCount} medicines
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

function MedicineModal({
  medicine,
  onClose,
  onSaved,
}: {
  medicine: Medicine | null;
  onClose: () => void;
  onSaved: (m: Medicine, isNew: boolean) => void;
}) {
  const [form,    setForm]    = useState<FormState>(
    medicine
      ? {
          name:         medicine.name,
          genericName:  medicine.genericName  ?? "",
          manufacturer: medicine.manufacturer ?? "",
          composition:  medicine.composition  ?? "",
          category:     medicine.category     ?? "",
          schedule:     medicine.schedule     ?? "",
          hsnCode:      medicine.hsnCode      ?? "",
          gstRate:      String(medicine.gstRate),
          form:         medicine.form         ?? "",
          strength:     medicine.strength     ?? "",
          unit:         medicine.unit         ?? "",
          packSize:     medicine.packSize     ?? "",
          unitsPerPack: medicine.unitsPerPack != null ? String(medicine.unitsPerPack) : "",
          baseUnit:     medicine.baseUnit     ?? "",
        }
      : BLANK,
  );
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Medicine name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name:         form.name.trim(),
        genericName:  form.genericName.trim()  || undefined,
        manufacturer: form.manufacturer.trim() || undefined,
        composition:  form.composition.trim()  || undefined,
        category:     form.category.trim()     || undefined,
        schedule:     form.schedule            || undefined,
        hsnCode:      form.hsnCode.trim()      || undefined,
        gstRate:      Number(form.gstRate),
        form:         form.form                || undefined,
        strength:     form.strength.trim()     || undefined,
        unit:         form.unit.trim()         || undefined,
        packSize:     form.packSize.trim()      || undefined,
        unitsPerPack: form.unitsPerPack.trim() ? Number(form.unitsPerPack) : null,
        baseUnit:     form.baseUnit             || null,
      };
      const { data } = medicine
        ? await api.patch(`/medicines/${medicine.id}`, body)
        : await api.post("/medicines", body);
      onSaved(data.data, !medicine);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to save medicine."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.96, y: 10  }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-[16px] font-bold text-slate-900">
              {medicine ? "Edit Medicine" : "Add Medicine"}
            </h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 grid grid-cols-2 gap-4">
          {/* Row 1 */}
          <div className="col-span-2">
            <Field label="Medicine Name *">
              <Input value={form.name} onChange={set("name")} placeholder="e.g. Dolo 650" />
            </Field>
          </div>

          <Field label="Generic Name / Salt">
            <Input value={form.genericName} onChange={set("genericName")} placeholder="e.g. Paracetamol" />
          </Field>
          <Field label="Manufacturer">
            <Input value={form.manufacturer} onChange={set("manufacturer")} placeholder="e.g. Micro Labs" />
          </Field>

          <div className="col-span-2">
            <Field label="Composition">
              <Input value={form.composition} onChange={set("composition")} placeholder="e.g. Paracetamol 650mg" />
            </Field>
          </div>

          <Field label="Category / Type">
            <IconGridPicker
              value={form.category}
              onChange={set("category")}
              options={PRODUCT_CATEGORIES}
              title="Product Category"
              placeholder="Select category"
            />
          </Field>
          <Field label="Schedule">
            <Select value={form.schedule} onChange={set("schedule")} options={SCHEDULES} placeholder="Select schedule" />
          </Field>

          <Field label="Form">
            <Select value={form.form} onChange={set("form")} options={FORMS} placeholder="Select form" />
          </Field>
          <Field label="Strength">
            <Input value={form.strength} onChange={set("strength")} placeholder="e.g. 650mg" />
          </Field>

          <Field label="Packaging">
            <IconGridPicker
              value={form.unit}
              onChange={set("unit")}
              options={PACKAGING_UNITS}
              title="Packaging Type"
              placeholder="Select packaging"
            />
          </Field>
          <Field label="Pack Size">
            <Input value={form.packSize} onChange={set("packSize")} placeholder="e.g. 15 tablets" />
          </Field>

          <Field label="Units / Pack (for loose selling)">
            <Input value={form.unitsPerPack} onChange={set("unitsPerPack")} placeholder="e.g. 15" />
          </Field>
          <Field label="Base Unit">
            <Select
              value={form.baseUnit}
              onChange={set("baseUnit")}
              options={BASE_UNITS as unknown as string[]}
              placeholder="— none —"
            />
          </Field>

          <Field label="HSN Code">
            <Input value={form.hsnCode} onChange={set("hsnCode")} placeholder="8-digit HSN" />
          </Field>
          <Field label="GST Rate (%)">
            <Select value={form.gstRate} onChange={set("gstRate")} options={GST_RATES} />
          </Field>

          {error && (
            <div className="col-span-2 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="col-span-2 flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {medicine ? "Save Changes" : "Add Medicine"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Pharmacy override modal ──────────────────────────────────────────────────
// The catalog is global (platform-managed); this sets MY pharmacy's GST rate /
// standing discount for one medicine without touching the shared record.

/**
 * Best-effort "units per pack" from free text — a PREFILL only, the pharmacist still
 * checks it against a real strip. Conservative on purpose: a wrong guess mis-prices
 * every loose sale. Mirrors migration 20260901000001's backfill rule.
 *   "1x10" / "10 x 15" → the second number
 *   "15" / "15 tablets" / "10's" → the number
 *   "200 ml", "50 g", "500mg 10 tablets", "strip of 15" → nothing (left for a human)
 */
export function parsePackSize(text: string | null): number | undefined {
  if (!text) return undefined;
  const t = text.trim();
  const grid = t.match(/^(\d+)\s*[xX*]\s*(\d+)\b/);
  if (grid) { const n = Number(grid[2]); if (n >= 2 && n <= 100000) return n; }
  // A bare count with an optional piece word and NOTHING else. A volume/weight, a
  // strength, a second number or extra words all fail this and fall through.
  const bare = t.match(/^(\d+)\s*(?:tab(?:let)?s?|cap(?:sule)?s?|pcs?|pieces?|nos?|'?s)?$/i);
  if (bare) { const n = Number(bare[1]); if (n >= 2 && n <= 100000) return n; }
  return undefined;
}

/** Word for the loose toggle button in the POS ("Tablet" → shown as "Tab"). */
export function baseUnitWord(b: string | null): string {
  switch (b) {
    case "TABLET":  return "Tab";
    case "CAPSULE": return "Cap";
    case "ML":      return "mL";
    case "GM":      return "gm";
    default:        return "Loose";
  }
}

function OverrideModal({
  medicine,
  override,
  onClose,
  onSaved,
  onRemoved,
}: {
  medicine: Medicine;
  override: Override | null;
  onClose: () => void;
  onSaved: (o: Override) => void;
  onRemoved: (medicineId: string) => void;
}) {
  const canLoose = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");
  const isSchX   = (medicine.schedule ?? "").trim().toUpperCase() === "X";

  const [gstRate,  setGstRate]  = useState<string>(override?.gstRate != null ? String(override.gstRate) : "");
  const [discount, setDiscount] = useState<string>(override?.defaultDiscountPct != null ? String(override.defaultDiscountPct) : "");
  const [notes,    setNotes]    = useState<string>(override?.notes ?? "");
  const [allowLoose, setAllowLoose] = useState<boolean>(override?.allowLooseSale ?? false);
  const [looseDefault, setLooseDefault] = useState<boolean>(override?.looseByDefault ?? false);
  // Pre-fill the pack size: this override's value → the effective value → the
  // catalogue's structured value → whatever we can parse out of the packSize text.
  const [upp, setUpp] = useState<string>(
    override?.unitsPerPack != null ? String(override.unitsPerPack)
      : override?.effectiveUnitsPerPack != null ? String(override.effectiveUnitsPerPack)
      : medicine.unitsPerPack != null ? String(medicine.unitsPerPack)
      : String(parsePackSize(medicine.packSize) ?? ""),
  );
  // Already confirmed once, or the pharmacist ticks it this time.
  const [confirmed, setConfirmed] = useState<boolean>(!!override?.looseConfirmedAt);
  const [saving,   setSaving]   = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const wasEnabled = override?.allowLooseSale ?? false;
  // The pack size billing will actually use today (this override's, else the catalogue's).
  const effectiveUpp = override?.unitsPerPack ?? override?.effectiveUnitsPerPack ?? medicine.unitsPerPack ?? null;
  const looseChanged = allowLoose !== wasEnabled
    || looseDefault !== (override?.looseByDefault ?? false)
    || (upp !== "" && Number(upp) !== effectiveUpp)
    || (confirmed && !override?.looseConfirmedAt);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const discountNum = discount === "" ? null : Number(discount);
    if (discountNum !== null && (Number.isNaN(discountNum) || discountNum < 0 || discountNum > 100)) {
      setError("Discount must be between 0 and 100.");
      return;
    }
    const uppNum = upp === "" ? null : Number(upp);
    if (allowLoose && (uppNum === null || Number.isNaN(uppNum) || uppNum < 2)) {
      setError("Enter how many units are in a pack (at least 2) to sell this medicine loose.");
      return;
    }
    if (allowLoose && !confirmed && !override?.looseConfirmedAt) {
      setError(`Confirm the pack size first — a wrong number would over- or under-charge every loose sale.`);
      return;
    }
    if (gstRate === "" && discount === "" && notes.trim() === "" && !canLoose) {
      setError("Set a GST rate and/or a default discount — or remove the override.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let saved: Override | null = null;
      // Loose selling is a narrow OWNER/MANAGER action on its own endpoint.
      if (canLoose && (looseChanged || allowLoose)) {
        // Only persist a pharmacy-specific pack size when it differs from the
        // catalogue's — otherwise a later platform-admin correction can't reach us,
        // and billing keeps resolving COALESCE(override, catalogue) anyway.
        const catalogueUpp = medicine.unitsPerPack ?? null;
        const sendUpp = uppNum != null && uppNum !== catalogueUpp ? uppNum : null;
        const { data } = await api.patch(`/medicines/${medicine.id}/loose-settings`, {
          allowLooseSale: allowLoose,
          unitsPerPack:   sendUpp,
          looseByDefault: looseDefault,
          confirmed:      confirmed || undefined,
        });
        saved = data.data;
      }
      // GST / discount / notes on the shared override endpoint (partial update).
      if (gstRate !== "" || discount !== "" || notes.trim() !== "" || (override && !saved)) {
        const { data } = await api.put(`/medicines/${medicine.id}/override`, {
          gstRate:            gstRate === "" ? null : Number(gstRate),
          defaultDiscountPct: discountNum,
          notes:              notes.trim() || null,
        });
        saved = data.data;
      }
      if (saved) onSaved(saved);
      else onClose();
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to save override."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await api.delete(`/medicines/${medicine.id}/override`);
      onRemoved(medicine.id);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to remove override."));
      setRemoving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.96, y: 10  }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
              <BadgePercent className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900 leading-tight">Pharmacy Override</h2>
              <p className="text-[12px] text-slate-500 leading-tight truncate max-w-[260px]">{medicine.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <p className="text-[12px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
            Applies to <span className="font-semibold">your pharmacy only</span> — billing and the POS
            will use these values instead of the shared catalog.
          </p>

          <Field label={`GST Rate (catalog: ${medicine.gstRate}%)`}>
            <select
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors bg-white"
            >
              <option value="">Use catalog rate ({medicine.gstRate}%)</option>
              {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
          </Field>

          <Field label="Default Discount % (pre-filled at POS)">
            <Input value={discount} onChange={setDiscount} placeholder="e.g. 10 — leave blank for none" />
          </Field>

          <Field label="Notes (optional)">
            <Input value={notes} onChange={setNotes} placeholder="Why this override exists" />
          </Field>

          {/* ── Loose (cut-strip) selling — OWNER/MANAGER only ─────────────── */}
          {canLoose && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3 space-y-3">
              <label className={cn("flex items-start gap-2.5", isSchX && "opacity-50")}>
                <input
                  type="checkbox"
                  checked={allowLoose}
                  disabled={isSchX}
                  onChange={(e) => setAllowLoose(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                />
                <span className="text-[13px] text-slate-700 leading-snug">
                  <span className="font-semibold">Sell this medicine loose</span> (cut strip)
                  {isSchX
                    ? <span className="block text-[11px] text-red-500">Schedule X — must be sold in the original pack.</span>
                    : <span className="block text-[11px] text-slate-500">The POS shows a Strip / {baseUnitWord(medicine.baseUnit)} toggle on the bill line.</span>}
                </span>
              </label>
              {allowLoose && !isSchX && (
                <>
                  <Field label={`Units per pack${medicine.packSize ? ` (catalogue says "${medicine.packSize}")` : ""}`}>
                    <Input value={upp} onChange={setUpp} placeholder="e.g. 15" />
                  </Field>
                  {/* Pack-size confirmation — a wrong number silently mis-prices every loose sale */}
                  {upp !== "" && Number(upp) >= 2 && (
                    <label className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                      />
                      <span className="text-[12px] text-slate-600 leading-snug">
                        I've checked a real strip — it has <b>{upp} {baseUnitWord(medicine.baseUnit).toLowerCase()}</b>.
                        <span className="block text-[11px] text-slate-400">Each unit is priced at MRP ÷ {upp}.</span>
                      </span>
                    </label>
                  )}
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={looseDefault}
                      onChange={(e) => setLooseDefault(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                    />
                    <span className="text-[12px] text-slate-600 leading-snug">
                      Start new bill lines for this medicine as <b>loose</b>
                      <span className="block text-[11px] text-slate-400">For a shop that cuts every strip of this one.</span>
                    </span>
                  </label>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            {override ? (
              <button
                type="button"
                onClick={remove}
                disabled={removing}
                className="text-[13px] text-red-500 hover:text-red-600 font-medium disabled:opacity-60 flex items-center gap-1.5"
              >
                {removing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Remove override
              </button>
            ) : <div />}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save Override
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MedicinesPage() {
  const isAdmin = isPlatformAdmin();
  const toast = useToast();
  const [medicines,   setMedicines]   = useState<Medicine[]>([]);
  const [total,       setTotal]       = useState(0);
  const [totalPages,  setTotalPages]  = useState(1);
  const [page,        setPage]        = useState(1);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  const [search,      setSearch]      = useState("");
  const [filterSchedule, setFilterSchedule] = useState("");
  const [filterForm,     setFilterForm]     = useState("");
  const [filterActive,   setFilterActive]   = useState<"" | "true" | "false">("");
  const [showFilters,    setShowFilters]     = useState(false);

  const [modal,       setModal]       = useState<"add" | "edit" | "bulk" | "override" | "barcode" | "bulkLoose" | null>(null);
  const canMapBarcodes = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");
  const [looseHintDismissed, setLooseHintDismissed] = useState(() => {
    try { return localStorage.getItem("loose-hint-dismissed") === "1"; } catch { return false; }
  });
  const [editing,     setEditing]     = useState<Medicine | null>(null);
  const [reindexing,  setReindexing]  = useState(false);
  // medicineId → this pharmacy's override (loaded once; mutated by the modal)
  const [overrides,   setOverrides]   = useState<Record<string, Override>>({});

  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (search.trim())       params.search   = search.trim();
      if (filterSchedule)      params.schedule = filterSchedule;
      if (filterForm)          params.form     = filterForm;
      if (filterActive !== "") params.isActive = filterActive;

      const { data } = await api.get("/medicines", { params });
      setMedicines(data.data.items);
      setTotal(data.data.total);
      setTotalPages(data.data.totalPages);
    } catch {
      setError("Failed to load medicines.");
    } finally {
      setLoading(false);
    }
  }, [page, search, filterSchedule, filterForm, filterActive]);

  useEffect(() => {
    const delay = search ? 350 : 0;
    const t = setTimeout(fetch, delay);
    return () => clearTimeout(t);
  }, [fetch, search]);

  const loadOverrides = useCallback(() => {
    api.get("/medicines/overrides")
      .then(({ data }) => {
        const map: Record<string, Override> = {};
        for (const o of data.data as Override[]) map[o.medicineId] = o;
        setOverrides(map);
      })
      .catch(() => { /* non-fatal — page still works without override badges */ });
  }, []);
  useEffect(() => { loadOverrides(); }, [loadOverrides]);

  function handleSaved(saved: Medicine, isNew: boolean) {
    setMedicines((prev) => {
      const idx = prev.findIndex((m) => m.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [saved, ...prev];
    });
    toast.success(isNew ? `${saved.name} added successfully` : `${saved.name} updated`);
    setModal(null);
    setEditing(null);
  }

  async function toggleActive(m: Medicine) {
    try {
      const { data } = m.isActive
        ? await api.delete(`/medicines/${m.id}`)
        : await api.patch(`/medicines/${m.id}/activate`);
      const updated = data.data;
      const idx = medicines.findIndex((x) => x.id === updated.id);
      if (idx >= 0) {
        setMedicines((prev) => { const next = [...prev]; next[idx] = updated; return next; });
      } else {
        fetch();
      }
      toast.success(m.isActive ? `${m.name} deactivated` : `${m.name} activated`);
    } catch {
      toast.error("Failed to update medicine status");
    }
  }

  async function runReindex() {
    setReindexing(true);
    try {
      const { data } = await api.post("/medicines/reindex");
      toast.success(`Search index refreshed — ${data.data.indexed} medicines indexed`);
    } catch {
      toast.error("Failed to refresh search index");
    } finally {
      setReindexing(false);
    }
  }

  const activeFilters = [filterSchedule, filterForm, filterActive].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-bold text-slate-900 leading-none">Medicines</h1>

          <button
            onClick={() => { setEditing(null); setModal("add"); }}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            Add Medicine
          </button>

          <button
            onClick={() => setModal("bulk")}
            className="flex items-center gap-1.5 border border-slate-200 hover:border-blue-300 bg-white text-slate-600 hover:text-blue-600 text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            Bulk Upload
          </button>

          {canMapBarcodes && (
            <button
              onClick={() => setModal("barcode")}
              title="Scan products to link barcodes so POS & receiving scans work"
              className="flex items-center gap-1.5 border border-violet-200 hover:border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm"
            >
              <ScanLine className="w-3.5 h-3.5" />
              Map Barcodes
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={runReindex}
              disabled={reindexing}
              title="Refresh search index so newly added medicines appear instantly in search"
              className="flex items-center gap-1.5 text-slate-500 hover:text-blue-600 text-[12px] font-medium border border-slate-200 hover:border-blue-300 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", reindexing && "animate-spin")} />
              Refresh Index
            </button>
          )}
          <span className="text-[12px] text-slate-400">{total} medicines</span>
        </div>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0">

        {/* Search */}
        <div className="flex items-center border border-slate-200 rounded-md bg-white overflow-hidden h-[30px] shadow-sm flex-1 max-w-[320px]">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name, generic, manufacturer…"
            className="px-3 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-full h-full text-[13px]"
          />
          <span className="px-2.5 text-slate-400 flex items-center h-full">
            <Search className="w-3.5 h-3.5" />
          </span>
        </div>

        {/* Filters dropdown */}
        <div ref={filterRef} className="relative">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 border rounded-md bg-white px-3 h-[30px] text-[13px] font-medium transition-colors whitespace-nowrap shadow-sm",
              activeFilters > 0 ? "border-blue-300 text-blue-600 ring-2 ring-blue-100" : "border-slate-200 text-slate-600 hover:border-slate-300",
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {activeFilters > 0 && (
              <span className="text-[11px] font-bold bg-blue-100 text-blue-700 rounded-full px-1.5 leading-[18px]">{activeFilters}</span>
            )}
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0,  scale: 1    }}
                exit={{   opacity: 0, y: -6, scale: 0.97  }}
                transition={{ duration: 0.14 }}
                className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-20 p-4 w-[260px]"
              >
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-3">Filters</p>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium mb-1 block">Schedule</label>
                    <select
                      value={filterSchedule}
                      onChange={(e) => { setFilterSchedule(e.target.value); setPage(1); }}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none"
                    >
                      <option value="">All</option>
                      {SCHEDULES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium mb-1 block">Form</label>
                    <select
                      value={filterForm}
                      onChange={(e) => { setFilterForm(e.target.value); setPage(1); }}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none"
                    >
                      <option value="">All</option>
                      {FORMS.map((f) => <option key={f} value={f} className="capitalize">{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium mb-1 block">Status</label>
                    <select
                      value={filterActive}
                      onChange={(e) => { setFilterActive(e.target.value as "" | "true" | "false"); setPage(1); }}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none"
                    >
                      <option value="">All</option>
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>

                  {activeFilters > 0 && (
                    <button
                      onClick={() => { setFilterSchedule(""); setFilterForm(""); setFilterActive(""); setPage(1); setShowFilters(false); }}
                      className="w-full text-[12px] text-red-500 hover:text-red-600 text-center py-1 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      Clear all filters
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── First-run loose-selling hint (OWNER/MANAGER, none enabled yet) ── */}
      {canMapBarcodes && !looseHintDismissed
        && !loading && medicines.length > 0
        && !Object.values(overrides).some((o) => o.allowLooseSale) && (
        <div className="mx-5 mt-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-2.5">
          <Scissors className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-[12.5px] text-amber-800 flex-1">
            <b>Sell tablets loose?</b> Turn it on per medicine with the ✂ button on a row, or set up your common ones in one go.
          </span>
          <button
            onClick={() => setModal("bulkLoose")}
            className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors flex-shrink-0"
          >
            Set up loose selling
          </button>
          <button
            onClick={() => { setLooseHintDismissed(true); try { localStorage.setItem("loose-hint-dismissed", "1"); } catch { /* ignore */ } }}
            className="w-6 h-6 rounded hover:bg-amber-100 flex items-center justify-center flex-shrink-0"
          >
            <X className="w-3.5 h-3.5 text-amber-500" />
          </button>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {["Medicine Name", "Generic Name", "Manufacturer", "Form", "Strength", "Schedule", "GST%", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <TableSkeletonRows columns={9} />
            ) : error ? (
              <tr>
                <td colSpan={9} className="py-24 text-center">
                  <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-3" />
                  <p className="text-red-500 text-[13px] font-medium">{error}</p>
                  <button onClick={fetch} className="mt-3 text-blue-600 text-[12px] hover:underline">Try again</button>
                </td>
              </tr>
            ) : medicines.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-24 text-center">
                  <FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 text-[14px] font-medium">No medicines found</p>
                  <p className="text-slate-400 text-[12px] mt-1">
                    {search || activeFilters > 0
                      ? "Try adjusting your search or filters"
                      : "Add your first medicine to get started"}
                  </p>
                </td>
              </tr>
            ) : (
              medicines.map((m) => (
                <tr
                  key={m.id}
                  className={cn(
                    "border-b border-slate-100 hover:bg-blue-50/30 transition-colors",
                    !m.isActive && "bg-slate-50/60",
                  )}
                >
                  <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 max-w-[200px]">
                    <span className="truncate block">{m.name}</span>
                    {(m.category || m.unit || overrides[m.id]?.allowLooseSale) && (
                      <span className="flex items-center gap-1 mt-1 flex-wrap">
                        <ProductTag value={m.category} kind="category" size="xs" />
                        <ProductTag value={m.unit} kind="packaging" size="xs" />
                        {overrides[m.id]?.allowLooseSale && (
                          <span
                            title={`Sold loose — ${overrides[m.id]!.effectiveUnitsPerPack ?? "?"} per strip${overrides[m.id]!.looseByDefault ? ", default loose" : ""}`}
                            className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 cursor-help"
                          >
                            <Scissors className="w-2.5 h-2.5" /> Loose
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-500 max-w-[140px]">
                    <span className="truncate block">{m.genericName ?? <span className="text-slate-300">—</span>}</span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-500 whitespace-nowrap">
                    {m.manufacturer ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap capitalize">
                    {m.form ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">
                    {m.strength ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {m.schedule ? (
                      <span
                        title={SCHEDULE_CFG[m.schedule]?.title}
                        className={cn(
                          "inline-flex items-center text-[11px] font-bold border rounded-full px-2 py-0.5 whitespace-nowrap cursor-help",
                          SCHEDULE_CFG[m.schedule]?.cls ?? "bg-slate-50 text-slate-600 border-slate-200",
                        )}
                      >
                        {m.schedule}
                      </span>
                    ) : <span className="text-slate-300 text-[13px]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">
                    {overrides[m.id]?.gstRate != null ? (
                      <span
                        title={`Catalog ${m.gstRate}% — overridden for your pharmacy`}
                        className="inline-flex items-center gap-1 text-violet-700 font-semibold cursor-help"
                      >
                        <span className="line-through text-slate-300 font-normal">{m.gstRate}%</span>
                        {overrides[m.id]!.gstRate}%
                      </span>
                    ) : (
                      <>{m.gstRate}%</>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap",
                      m.isActive
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-50  text-slate-400  border-slate-200",
                    )}>
                      {m.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {isAdmin && (
                        <button
                          onClick={() => { setEditing(m); setModal("edit"); }}
                          title="Edit medicine"
                          className="w-7 h-7 rounded-md hover:bg-blue-100 flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => { setEditing(m); setModal("override"); }}
                        title={overrides[m.id] ? "Pharmacy settings — GST / discount / loose selling" : "Set pharmacy GST / discount / loose selling"}
                        className={cn(
                          "w-7 h-7 rounded-md hover:bg-violet-100 flex items-center justify-center transition-colors",
                          overrides[m.id] ? "text-violet-600" : "text-slate-300 hover:text-violet-600",
                        )}
                      >
                        <BadgePercent className="w-3.5 h-3.5" />
                      </button>
                      {canMapBarcodes && (m.schedule ?? "").trim().toUpperCase() !== "X" && (
                        <button
                          onClick={() => { setEditing(m); setModal("override"); }}
                          title={overrides[m.id]?.allowLooseSale ? "Loose selling — on" : "Sell this medicine loose (cut strip)"}
                          className={cn(
                            "w-7 h-7 rounded-md hover:bg-amber-100 flex items-center justify-center transition-colors",
                            overrides[m.id]?.allowLooseSale ? "text-amber-600" : "text-slate-300 hover:text-amber-600",
                          )}
                        >
                          <Scissors className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => toggleActive(m)}
                          title={m.isActive ? "Deactivate medicine" : "Activate medicine"}
                          className={cn(
                            "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
                            m.isActive
                              ? "hover:bg-red-50   text-slate-300 hover:text-red-500"
                              : "hover:bg-emerald-50 text-slate-300 hover:text-emerald-600",
                          )}
                        >
                          {m.isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ─────────────────────────────────────────── */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0"
        >
            <span className="text-[12px] text-slate-500">
              Showing{" "}
              <span className="font-semibold text-slate-700">
                {Math.min((page - 1) * 20 + 1, total)}–{Math.min(page * 20, total)}
              </span>{" "}
              of <span className="font-semibold text-slate-700">{total}</span> medicines
            </span>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ‹ Prev
              </button>
              <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next ›
              </button>
            </div>
        </div>
      )}

      {/* ── Add / Edit Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {(modal === "add" || modal === "edit") && (
          <MedicineModal
            medicine={modal === "edit" ? editing : null}
            onClose={() => { setModal(null); setEditing(null); }}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>

      {/* ── Bulk Upload Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {modal === "bulk" && (
          <BulkUploadModal
            onClose={() => setModal(null)}
            onDone={() => { setModal(null); fetch(); }}
          />
        )}
        {modal === "barcode" && (
          <BarcodeMappingModal
            onClose={() => { setModal(null); fetch(); }}
            onToast={(msg, v) => v === "success" ? toast.success(msg) : toast.error(msg)}
          />
        )}
      </AnimatePresence>

      {/* ── Pharmacy Override Modal ───────────────────────────────── */}
      <AnimatePresence>
        {modal === "override" && editing && (
          <OverrideModal
            medicine={editing}
            override={overrides[editing.id] ?? null}
            onClose={() => { setModal(null); setEditing(null); }}
            onSaved={(o) => {
              setOverrides((prev) => ({ ...prev, [o.medicineId]: o }));
              toast.success(`Override saved for ${editing.name}`);
              setModal(null);
              setEditing(null);
            }}
            onRemoved={(medicineId) => {
              setOverrides((prev) => {
                const next = { ...prev };
                delete next[medicineId];
                return next;
              });
              toast.success(`Override removed for ${editing.name}`);
              setModal(null);
              setEditing(null);
            }}
          />
        )}
        {modal === "bulkLoose" && (
          <BulkLooseModal
            search={search.trim()}
            filterForm={filterForm}
            filterSchedule={filterSchedule}
            overrides={overrides}
            onClose={() => setModal(null)}
            onDone={(count) => {
              setModal(null);
              loadOverrides();
              if (count > 0) toast.success(`Loose selling enabled for ${count} medicine${count === 1 ? "" : "s"}`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Bulk enable loose ────────────────────────────────────────────────────────
type BulkCandidate = { id: string; name: string; unitsPerPack: number | null };

function BulkLooseModal({
  search, filterForm, filterSchedule, overrides, onClose, onDone,
}: {
  search: string;
  filterForm: string;
  filterSchedule: string;
  overrides: Record<string, Override>;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  // Fetch a wide slice (not just the 20-row page behind the modal) matching the
  // page's current search / form filter, so "set up my common ones" actually reaches
  // them. Only medicines that ALREADY have a structured pack size are eligible — a
  // parsePackSize() guess off free text can be wrong and bulk has no strip to check.
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<BulkCandidate[]>([]);
  const [leftOut, setLeftOut] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params: Record<string, string | number> = { page: 1, limit: 200, isActive: "true" };
        if (search) params.search = search;
        if (filterForm) params.form = filterForm;
        if (filterSchedule && filterSchedule.toUpperCase() !== "X") params.schedule = filterSchedule;
        const { data } = await api.get("/medicines", { params });
        if (cancelled) return;
        const rows = (data.data.items as Medicine[])
          .filter((m) => m.isActive && (m.schedule ?? "").trim().toUpperCase() !== "X")
          .filter((m) => !overrides[m.id]?.allowLooseSale);
        const ready: BulkCandidate[] = [];
        let out = 0;
        for (const m of rows) {
          const upp = m.unitsPerPack ?? overrides[m.id]?.effectiveUnitsPerPack ?? null;
          if (upp && upp >= 2) ready.push({ id: m.id, name: m.name, unitsPerPack: upp });
          else out++;
        }
        setCandidates(ready);
        setLeftOut(out);
        setPicked(new Set(ready.map((c) => c.id)));
      } catch (err: any) {
        if (!cancelled) setError(getErrorMessage(err, "Couldn't load medicines."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [search, filterForm, filterSchedule, overrides]);

  const ready = candidates;

  async function submit() {
    const items = ready.filter((c) => picked.has(c.id)).map((c) => ({ medicineId: c.id, unitsPerPack: c.unitsPerPack }));
    if (items.length === 0) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post("/medicines/loose-settings/bulk", { items });
      onDone(items.length);
    } catch (err: any) {
      setError(getErrorMessage(err, "Couldn't enable loose selling for the batch."));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <Scissors className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900 leading-tight">Enable loose selling</h2>
              <p className="text-[12px] text-slate-500 leading-tight">
                {search || filterForm ? "Medicines matching your current filter" : "Your first 200 medicines"} that
                already have a pack size on record. Check each against a real strip when you can.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-10 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : ready.length === 0 ? (
            <p className="text-[13px] text-slate-500 py-6 text-center">
              None of these medicines have a structured pack size on record. Set one on each with the ✂ button — you'll confirm it against a real strip there — or add it to the catalogue first.
            </p>
          ) : (
            <div className="space-y-1">
              {ready.map((c) => (
                <label key={c.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={(e) => setPicked((prev) => { const n = new Set(prev); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })}
                    className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                  />
                  <span className="flex-1 text-[13px] text-slate-800 truncate">{c.name}</span>
                  <span className="text-[12px] font-semibold text-amber-700 tabular-nums">{c.unitsPerPack}/strip</span>
                </label>
              ))}
            </div>
          )}
          {!loading && leftOut > 0 && (
            <p className="mt-3 text-[11px] text-slate-400">
              {leftOut} more have no structured pack size and were left out — enable those one at a time with the ✂ button.
            </p>
          )}
          {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-slate-100">
          <button onClick={onClose} className="text-[13px] text-slate-500 hover:text-slate-700 font-medium">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || picked.size === 0}
            className="text-[13px] font-bold px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Enable for {picked.size}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
