

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus, Search, SlidersHorizontal, ChevronDown, Loader2,
  FileX, AlertCircle, Pencil, PowerOff, Power, X, Check,
  RefreshCw, FlaskConical, Upload, Download, CheckCircle2, XCircle,
  BadgePercent,
} from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { isPlatformAdmin } from "@/lib/auth";

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
  isActive:     boolean;
};

// Per-pharmacy override of catalog values (gstRate/discount); null = catalog value
type Override = {
  medicineId:         string;
  gstRate:            number | null;
  defaultDiscountPct: number | null;
  notes:              string | null;
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
};

const BLANK: FormState = {
  name: "", genericName: "", manufacturer: "", composition: "",
  category: "", schedule: "", hsnCode: "", gstRate: "12",
  form: "", strength: "", unit: "", packSize: "",
};

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
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      const preview: PreviewRow[] = parsed.map((row) => {
        const { valid, error } = validateRow(row);
        return { ...row, _valid: valid, _error: error };
      });
      setRows(preview);
      setStep("preview");
    };
    reader.readAsText(file);
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
                <p className="text-[14px] font-semibold text-slate-600">Drop your CSV file here</p>
                <p className="text-[12px] text-slate-400 mt-1">or click to browse</p>
                <p className="text-[11px] text-slate-300 mt-3">Supports .csv files · Max 5,000 rows</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>

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

          <Field label="Category">
            <Input value={form.category} onChange={set("category")} placeholder="e.g. Analgesic" />
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

          <Field label="Unit">
            <Input value={form.unit} onChange={set("unit")} placeholder="e.g. strip, bottle" />
          </Field>
          <Field label="Pack Size">
            <Input value={form.packSize} onChange={set("packSize")} placeholder="e.g. 15 tablets" />
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
  const [gstRate,  setGstRate]  = useState<string>(override?.gstRate != null ? String(override.gstRate) : "");
  const [discount, setDiscount] = useState<string>(override?.defaultDiscountPct != null ? String(override.defaultDiscountPct) : "");
  const [notes,    setNotes]    = useState<string>(override?.notes ?? "");
  const [saving,   setSaving]   = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (gstRate === "" && discount === "") {
      setError("Set a GST rate and/or a default discount — or remove the override.");
      return;
    }
    const discountNum = discount === "" ? null : Number(discount);
    if (discountNum !== null && (Number.isNaN(discountNum) || discountNum < 0 || discountNum > 100)) {
      setError("Discount must be between 0 and 100.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.put(`/medicines/${medicine.id}/override`, {
        gstRate:            gstRate === "" ? null : Number(gstRate),
        defaultDiscountPct: discountNum,
        notes:              notes.trim() || null,
      });
      onSaved(data.data);
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

  const [modal,       setModal]       = useState<"add" | "edit" | "bulk" | "override" | null>(null);
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
  }, [fetch]);

  useEffect(() => {
    api.get("/medicines/overrides")
      .then(({ data }) => {
        const map: Record<string, Override> = {};
        for (const o of data.data as Override[]) map[o.medicineId] = o;
        setOverrides(map);
      })
      .catch(() => { /* non-fatal — page still works without override badges */ });
  }, []);

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
              <tr>
                <td colSpan={9} className="py-24 text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-blue-400 mx-auto" />
                  <p className="text-slate-400 text-[13px] mt-3">Loading medicines…</p>
                </td>
              </tr>
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
                  <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 max-w-[180px]">
                    <span className="truncate block">{m.name}</span>
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
                        title={overrides[m.id] ? "Edit pharmacy override (GST / discount)" : "Set pharmacy override (GST / discount)"}
                        className={cn(
                          "w-7 h-7 rounded-md hover:bg-violet-100 flex items-center justify-center transition-colors",
                          overrides[m.id] ? "text-violet-600" : "text-slate-300 hover:text-violet-600",
                        )}
                      >
                        <BadgePercent className="w-3.5 h-3.5" />
                      </button>
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
      </AnimatePresence>
    </div>
  );
}
