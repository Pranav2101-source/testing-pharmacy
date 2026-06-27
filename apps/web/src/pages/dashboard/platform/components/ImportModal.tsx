import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle,
  XCircle, Loader2, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
};

type ParsedRow = {
  name: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
  gstin?: string;
  drugLicense?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  planName?: string;
};

type ValidationResult = {
  valid: ParsedRow[];
  duplicate: { row: number; data: ParsedRow; reason: string }[];
  invalid: { row: number; data: Record<string, any>; reason: string }[];
};

type ImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; email: string; reason: string }>;
};

const REQUIRED_COLS = ["name", "ownerName", "ownerEmail"];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ""; });
    return obj;
  });
}

function validateRows(rows: Record<string, any>[]): ValidationResult {
  const valid: ParsedRow[] = [];
  const duplicate: ValidationResult["duplicate"] = [];
  const invalid: ValidationResult["invalid"] = [];
  const seenEmails = new Set<string>();

  rows.forEach((row, i) => {
    const rowNum = i + 2; // +2 for 1-indexed + header
    const reasons: string[] = [];

    if (!row.name?.trim()) reasons.push("Missing pharmacy name");
    if (!row.ownerName?.trim()) reasons.push("Missing owner name");
    if (!row.ownerEmail?.trim()) reasons.push("Missing owner email");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.ownerEmail)) reasons.push("Invalid email format");

    if (row.ownerPhone && !/^\d{10}$/.test(row.ownerPhone)) reasons.push("Invalid phone (must be 10 digits)");
    if (row.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/.test(row.gstin.toUpperCase())) reasons.push("Invalid GST format");

    if (reasons.length > 0) {
      invalid.push({ row: rowNum, data: row, reason: reasons.join("; ") });
      return;
    }

    const email = row.ownerEmail.toLowerCase();
    if (seenEmails.has(email)) {
      duplicate.push({ row: rowNum, data: row as ParsedRow, reason: "Duplicate email in file" });
      return;
    }
    seenEmails.add(email);

    valid.push({
      name: row.name,
      ownerName: row.ownerName,
      ownerEmail: row.ownerEmail,
      ownerPhone: row.ownerPhone || undefined,
      gstin: row.gstin || undefined,
      drugLicense: row.drugLicense || undefined,
      address: row.address || undefined,
      city: row.city || undefined,
      state: row.state || undefined,
      pincode: row.pincode || undefined,
      phone: row.phone || undefined,
      email: row.email || undefined,
      planName: row.planName || "Free",
    });
  });

  return { valid, duplicate, invalid };
}

function generateCSVTemplate() {
  const headers = "name,ownerName,ownerEmail,ownerPhone,gstin,drugLicense,address,city,state,pincode,phone,email,planName";
  const sample1 = "MedPlus Pharmacy,Rajesh Kumar,rajesh@medplus.com,9876543210,22AAAAA0000A1Z5,DL-MH-12345,Shop 5 Medical Complex,Mumbai,Maharashtra,400001,9876543210,info@medplus.com,Free";
  const sample2 = "Apollo Health,Priya Sharma,priya@apollo.com,9123456789,,DL-KA-98765,45 Health Street,Bangalore,Karnataka,560001,9123456789,info@apollo.com,Standard";
  return `${headers}\n${sample1}\n${sample2}`;
}

function downloadErrorReport(errors: Array<{ row: number; email: string; reason: string }>) {
  const csv = "Row,Email,Reason\n" + errors.map((e) => `${e.row},"${e.email}","${e.reason}"`).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `import-errors-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportModal({ open, onClose }: Props) {
  const [stage, setStage] = useState<"upload" | "preview" | "result">("upload");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const qc = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (rows: ParsedRow[]) => {
      const { data } = await api.post<{ data: ImportResult }>("/platform/tenants/import", { rows });
      return data.data;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setStage("result");
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      toast.success(`${data.imported} tenants imported successfully`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Import failed");
    },
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      toast.error("File is empty or has no data rows");
      return;
    }

    // Check required columns
    const firstRow = rows[0]!;
    const missingCols = REQUIRED_COLS.filter((c) => !(c in firstRow));
    if (missingCols.length > 0) {
      toast.error(`Missing required columns: ${missingCols.join(", ")}. Download the template for reference.`);
      return;
    }

    const result = validateRows(rows);
    setValidation(result);
    setStage("preview");
  };

  const handleImport = () => {
    if (!validation) return;
    importMutation.mutate(validation.valid);
  };

  const handleDownloadTemplate = () => {
    const csv = generateCSVTemplate();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tenant-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    setStage("upload");
    setValidation(null);
    setImportResult(null);
    setFileName("");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col z-10 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Upload className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Import Tenants</h2>
              <p className="text-sm text-slate-500">Upload CSV to bulk-create pharmacies</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {stage === "upload" && (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {/* Download Templates */}
                <div className="flex gap-3">
                  <button onClick={handleDownloadTemplate} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                    <FileText className="w-4 h-4 text-emerald-500" /> Download CSV Template
                  </button>
                </div>

                {/* Upload Zone */}
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center cursor-pointer hover:border-brand-300 hover:bg-brand-50/30 transition-all group"
                >
                  <FileSpreadsheet className="w-12 h-12 text-slate-300 mx-auto mb-4 group-hover:text-brand-400 transition-colors" />
                  <p className="text-slate-600 font-medium">Click to upload or drag and drop</p>
                  <p className="text-slate-400 text-sm mt-1">Supports CSV files</p>
                  <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
                </div>
              </motion.div>
            )}

            {stage === "preview" && validation && (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span className="font-medium">{fileName}</span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                    <p className="text-2xl font-bold text-emerald-700">{validation.valid.length}</p>
                    <p className="text-xs font-medium text-emerald-600 mt-1">Valid</p>
                  </div>
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center">
                    <p className="text-2xl font-bold text-amber-700">{validation.duplicate.length}</p>
                    <p className="text-xs font-medium text-amber-600 mt-1">Duplicate</p>
                  </div>
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center">
                    <p className="text-2xl font-bold text-red-700">{validation.invalid.length}</p>
                    <p className="text-xs font-medium text-red-600 mt-1">Invalid</p>
                  </div>
                </div>

                {/* Error Details */}
                {(validation.duplicate.length > 0 || validation.invalid.length > 0) && (
                  <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                    <div className="p-3 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">Issues</div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                      {validation.duplicate.map((d) => (
                        <div key={d.row} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="text-slate-500">Row {d.row}:</span>
                          <span className="text-slate-700 font-medium">{d.data.ownerEmail}</span>
                          <span className="text-amber-600 text-xs ml-auto">{d.reason}</span>
                        </div>
                      ))}
                      {validation.invalid.map((d) => (
                        <div key={d.row} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                          <span className="text-slate-500">Row {d.row}:</span>
                          <span className="text-slate-700 font-medium truncate max-w-[150px]">{d.data.ownerEmail || d.data.name || "--"}</span>
                          <span className="text-red-600 text-xs ml-auto">{d.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {stage === "result" && importResult && (
              <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Import Complete</h3>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                    <p className="text-2xl font-bold text-emerald-700">{importResult.imported}</p>
                    <p className="text-xs font-medium text-emerald-600 mt-1">Imported</p>
                  </div>
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center">
                    <p className="text-2xl font-bold text-amber-700">{importResult.skipped}</p>
                    <p className="text-xs font-medium text-amber-600 mt-1">Skipped</p>
                  </div>
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center">
                    <p className="text-2xl font-bold text-red-700">{importResult.failed}</p>
                    <p className="text-xs font-medium text-red-600 mt-1">Failed</p>
                  </div>
                </div>

                {importResult.errors.length > 0 && (
                  <button
                    onClick={() => downloadErrorReport(importResult.errors)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors w-full justify-center"
                  >
                    <Download className="w-4 h-4 text-red-500" /> Download Error Report
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-100">
          {stage === "upload" && (
            <button onClick={handleClose} className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">Cancel</button>
          )}
          {stage === "preview" && (
            <>
              <button onClick={() => { setStage("upload"); setValidation(null); setFileName(""); }} className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">Back</button>
              <button
                onClick={handleImport}
                disabled={importMutation.isPending || !validation || validation.valid.length === 0}
                className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50"
              >
                {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import {validation?.valid.length || 0} Valid Rows
              </button>
            </>
          )}
          {stage === "result" && (
            <button onClick={handleClose} className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-500 transition-colors">Done</button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
