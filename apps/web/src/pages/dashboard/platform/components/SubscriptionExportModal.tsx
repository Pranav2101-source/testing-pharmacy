import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, FileText, Table, FileBarChart, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  filters: { search: string; plan: string; status: string };
  selectedIds: string[];
};

const COLUMNS = [
  { key: "tenantCode", label: "Tenant Code", default: true },
  { key: "pharmacy", label: "Pharmacy", default: true },
  { key: "owner", label: "Owner", default: true },
  { key: "ownerEmail", label: "Owner Email", default: true },
  { key: "plan", label: "Plan", default: true },
  { key: "billingCycle", label: "Billing Cycle", default: true },
  { key: "amount", label: "Amount", default: true },
  { key: "status", label: "Status", default: true },
  { key: "autoRenew", label: "Auto Renew", default: false },
  { key: "validUntil", label: "Valid Until", default: true },
  { key: "gstin", label: "GSTIN", default: false },
  { key: "createdAt", label: "Created", default: false },
];

export function SubscriptionExportModal({ open, onClose, filters, selectedIds }: Props) {
  const [scope, setScope] = useState<"all" | "filtered" | "selected">(selectedIds.length > 0 ? "selected" : "filtered");
  const [format, setFormat] = useState<"csv" | "excel" | "pdf">("csv");
  const [columns, setColumns] = useState(new Set(COLUMNS.filter((c) => c.default).map((c) => c.key)));

  const toast = useToast();

  const toggleCol = (key: string) => setColumns((prev) => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const params: Record<string, any> = { scope };
      if (scope === "filtered") {
        if (filters.search) params.search = filters.search;
        if (filters.plan) params.plan = filters.plan;
        if (filters.status !== "ALL") params.status = filters.status;
      }
      const { data } = await api.get<{ data: any[] }>("/platform/subscriptions/export", { params });
      return data.data;
    },
    onSuccess: (data) => {
      const cols = Array.from(columns);
      const rows = data.map((r: any) => cols.map((c) => r[c] ?? ""));
      const csv = [cols.join(","), ...rows.map((r) => r.map((v: any) => `"${v}"`).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `subscriptions-export-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.length} subscriptions`);
      onClose();
    },
    onError: () => toast.error("Export failed"),
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Download className="w-5 h-5 text-brand-600" /> Export Subscriptions</h2>
              <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-5">
              {/* Scope */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Scope</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: "all", label: "All Subscriptions" },
                    { key: "filtered", label: "Current Filters" },
                    { key: "selected", label: `Selected (${selectedIds.length})` },
                  ] as const).map((s) => (
                    <button key={s.key} onClick={() => setScope(s.key)} disabled={s.key === "selected" && selectedIds.length === 0}
                      className={cn("p-3 rounded-xl border-2 text-xs font-semibold text-center transition-all disabled:opacity-40",
                        scope === s.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Format */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Format</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: "csv", label: "CSV", icon: Table },
                    { key: "excel", label: "Excel", icon: FileBarChart },
                    { key: "pdf", label: "PDF", icon: FileText },
                  ] as const).map((f) => {
                    const Icon = f.icon;
                    return (
                      <button key={f.key} onClick={() => setFormat(f.key as typeof format)}
                        className={cn("p-3 rounded-xl border-2 text-xs font-semibold text-center transition-all flex flex-col items-center gap-1.5",
                          format === f.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                        <Icon className="w-5 h-5" /> {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Columns */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Columns</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {COLUMNS.map((c) => (
                    <label key={c.key} className={cn("flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors",
                      columns.has(c.key) ? "bg-brand-50 text-brand-700" : "bg-slate-50 text-slate-500 hover:bg-slate-100")}>
                      <input type="checkbox" checked={columns.has(c.key)} onChange={() => toggleCol(c.key)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-600/20 w-3.5 h-3.5" />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">Cancel</button>
              <button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending || columns.size === 0}
                className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white rounded-xl font-semibold text-sm hover:bg-brand-700 shadow-lg shadow-brand-600/20 disabled:opacity-60">
                {exportMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Export
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
