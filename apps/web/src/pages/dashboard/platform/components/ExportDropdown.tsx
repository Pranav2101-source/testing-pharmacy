import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  X, Download, FileText, FileSpreadsheet, File, Loader2, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  filters: { search: string; status: string; plan: string; state: string };
  selectedIds: string[];
};

type ExportFormat = "csv" | "excel" | "pdf";
type ExportScope = "current-page" | "filtered" | "selected" | "all";

const COLUMNS = [
  { key: "tenantCode", label: "Tenant Code", default: true },
  { key: "pharmacyName", label: "Pharmacy Name", default: true },
  { key: "owner", label: "Owner", default: true },
  { key: "ownerEmail", label: "Owner Email", default: true },
  { key: "ownerPhone", label: "Owner Phone", default: false },
  { key: "plan", label: "Plan", default: true },
  { key: "status", label: "Status", default: true },
  { key: "createdDate", label: "Created Date", default: true },
  { key: "renewalDate", label: "Renewal Date", default: true },
  { key: "doctors", label: "Doctors", default: false },
  { key: "patients", label: "Patients", default: false },
  { key: "storage", label: "Storage", default: false },
  { key: "lastLogin", label: "Last Login", default: false },
  { key: "subscriptionStatus", label: "Subscription Status", default: true },
] as const;

function downloadCSV(data: Record<string, any>[], columns: string[], filename: string) {
  const headers = columns.join(",");
  const rows = data.map((row) => columns.map((c) => `"${String(row[c] ?? "").replace(/"/g, '""')}"`).join(","));
  const csv = [headers, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportDropdown({ open, onClose, filters, selectedIds }: Props) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [scope, setScope] = useState<ExportScope>("filtered");
  const [selectedCols, setSelectedCols] = useState<Set<string>>(
    new Set(COLUMNS.filter((c) => c.default).map((c) => c.key))
  );

  const toast = useToast();

  const exportMutation = useMutation({
    mutationFn: async () => {
      const params: Record<string, string> = { scope: scope === "all" ? "all" : "filtered" };
      if (scope !== "all") {
        if (filters.search) params.search = filters.search;
        if (filters.status !== "ALL") params.status = filters.status;
        if (filters.plan) params.plan = filters.plan;
        if (filters.state) params.state = filters.state;
      }
      const { data } = await api.get<{ data: Record<string, any>[] }>("/platform/tenants/export", { params });
      return data.data;
    },
    onSuccess: (data) => {
      const cols = Array.from(selectedCols);
      const date = new Date().toISOString().split("T")[0];
      const filename = `tenants-${date}.${format === "excel" ? "csv" : format}`;

      // For selected scope, filter the data
      let exportData = data;
      if (scope === "selected" && selectedIds.length > 0) {
        exportData = data.filter((d) => selectedIds.includes(d.tenantId));
      }

      if (format === "csv" || format === "excel") {
        downloadCSV(exportData, cols, filename);
      } else {
        // PDF: fall back to CSV for now and notify
        downloadCSV(exportData, cols, `tenants-${date}.csv`);
        toast.info("PDF export generated as CSV. Full PDF support coming soon.");
      }

      toast.success(`Exported ${exportData.length} tenants as ${format.toUpperCase()}`);
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Export failed");
    },
  });

  const toggleCol = (key: string) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg z-10 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Download className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Export Tenants</h2>
              <p className="text-sm text-slate-500">Choose format, scope, and columns</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Format */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-3">Format</h3>
            <div className="flex gap-3">
              {([
                { key: "csv" as const, label: "CSV", icon: FileText, color: "emerald" },
                { key: "excel" as const, label: "Excel", icon: FileSpreadsheet, color: "emerald" },
                { key: "pdf" as const, label: "PDF", icon: File, color: "red" },
              ]).map((f) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFormat(f.key)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-semibold transition-all",
                      format === f.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                    )}
                  >
                    <Icon className="w-4 h-4" /> {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scope */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-3">Scope</h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "filtered" as const, label: "Filtered Results" },
                { key: "all" as const, label: "Entire Platform" },
                { key: "selected" as const, label: `Selected (${selectedIds.length})` },
                { key: "current-page" as const, label: "Current Page" },
              ]).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setScope(s.key)}
                  disabled={s.key === "selected" && selectedIds.length === 0}
                  className={cn(
                    "py-2.5 px-3 rounded-lg border-2 text-sm font-medium transition-all text-left",
                    scope === s.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300",
                    s.key === "selected" && selectedIds.length === 0 && "opacity-40 cursor-not-allowed"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Columns */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-700">Columns</h3>
              <button
                onClick={() => setSelectedCols(new Set(COLUMNS.map((c) => c.key)))}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Select All
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                    selectedCols.has(col.key) ? "bg-brand-50 text-brand-700" : "bg-slate-50 text-slate-500"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedCols.has(col.key)}
                    onChange={() => toggleCol(col.key)}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500/20"
                  />
                  <span className="text-sm font-medium">{col.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">Cancel</button>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending || selectedCols.size === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {exportMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export
          </button>
        </div>
      </motion.div>
    </div>
  );
}
