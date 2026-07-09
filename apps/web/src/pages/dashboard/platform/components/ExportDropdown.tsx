import { useState } from "react";
import { motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  X, Download, FileText, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  filters: { search: string; status: string; plan: string; state: string };
  selectedIds: string[];
};

type ExportScope = "filtered" | "selected" | "all";

export function ExportDropdown({ open, onClose, filters, selectedIds }: Props) {
  const [scope, setScope] = useState<ExportScope>("filtered");

  const toast = useToast();

  const exportMutation = useMutation({
    mutationFn: async () => {
      const params: Record<string, string> = { scope: scope === "all" ? "all" : "filtered" };
      if (scope === "selected") {
        params.ids = selectedIds.join(",");
      } else if (scope !== "all") {
        if (filters.search) params.search = filters.search;
        if (filters.status !== "ALL") params.status = filters.status;
        if (filters.plan) params.plan = filters.plan;
        if (filters.state) params.state = filters.state;
      }
      const res = await api.get("/platform/tenants/export", { params, responseType: "blob" });
      return res.data as Blob;
    },
    onSuccess: (blob) => {
      const date = new Date().toISOString().split("T")[0];
      const filename = `tenants-${date}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Export started — check your downloads");
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Export failed");
    },
  });

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
              <p className="text-sm text-slate-500">Choose scope for this CSV export</p>
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
            <div className="flex items-center gap-2 px-3 py-3 rounded-xl border-2 border-brand-500 bg-brand-50 text-brand-700 text-sm font-semibold">
              <FileText className="w-4 h-4" /> CSV
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">Cancel</button>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
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
