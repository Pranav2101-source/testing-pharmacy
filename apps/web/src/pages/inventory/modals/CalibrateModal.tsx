import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, X, Check, Sparkles } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { CalibrateResult } from "../types";

export function CalibrateModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  type Phase = "loading" | "preview" | "applying" | "done";
  const [phase,   setPhase]   = useState<Phase>("loading");
  const [preview, setPreview] = useState<CalibrateResult | null>(null);
  const [applied, setApplied] = useState<CalibrateResult | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  // Dry run on mount
  useEffect(() => {
    api.post("/inventory/calibrate-stock", { dryRun: true })
      .then((r) => { setPreview(r.data.data as CalibrateResult); setPhase("preview"); })
      .catch((e) => { setError(getErrorMessage(e, "Failed to analyze inventory")); setPhase("preview"); });
  }, []);

  async function applyChanges() {
    setPhase("applying");
    try {
      const r = await api.post("/inventory/calibrate-stock", { dryRun: false });
      setApplied(r.data.data as CalibrateResult);
      setPhase("done");
      onApplied();
    } catch (e: any) {
      setError(getErrorMessage(e, "Failed to apply changes"));
      setPhase("preview");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4.5 h-4.5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900">Smart Stock Levels</h2>
              <p className="text-[12px] text-slate-400 truncate">90-day sales analysis → optimal minimum stock levels</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors flex-shrink-0">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-[13px] text-slate-500">Analyzing 90 days of sales data…</p>
            </div>
          )}

          {(phase === "preview" || phase === "applying") && (
            <>
              {error && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-600">{error}</div>
              )}
              {preview && (
                <>
                  {/* Summary stats */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
                    {[
                      { label: "Will Update",     value: preview.updated, cls: "text-blue-600 bg-blue-50 border-blue-100" },
                      { label: "Already Optimal", value: Math.max(0, preview.analyzed - preview.updated - preview.skipped), cls: "text-emerald-600 bg-emerald-50 border-emerald-100" },
                      { label: "No Sales Data",   value: preview.skipped, cls: "text-slate-500 bg-slate-50 border-slate-100" },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className={cn("rounded-xl border p-2.5 sm:p-3 text-center", cls)}>
                        <p className="text-[18px] sm:text-[22px] font-bold tabular-nums">{value}</p>
                        <p className="text-[10px] sm:text-[11px] font-medium mt-0.5 opacity-75">{label}</p>
                      </div>
                    ))}
                  </div>

                  {preview.changes.length === 0 ? (
                    <div className="text-center py-10 bg-emerald-50 rounded-xl border border-emerald-100">
                      <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                      <p className="text-[14px] font-semibold text-emerald-700">All minimum stock levels are already optimal</p>
                      <p className="text-[12px] text-emerald-500 mt-1">No changes needed based on your sales patterns</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-[12px] text-slate-500 mb-2">
                        Formula: <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">avg_daily × 7 days × 1.5 safety</span> · floor: 5 units
                      </p>
                      <div className="border border-slate-200 rounded-xl overflow-x-auto">
                        <table className="w-full min-w-[420px]">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              {["Medicine", "Old Min", "New Min", "Avg / Day"].map((h) => (
                                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.changes.map((c) => (
                              <tr key={c.medicineId} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/30">
                                <td className="px-4 py-2.5 text-[13px] font-medium text-slate-800 whitespace-nowrap">{c.medicineName}</td>
                                <td className="px-4 py-2.5 text-[13px] text-slate-400 tabular-nums">{c.oldMin}</td>
                                <td className="px-4 py-2.5">
                                  <span className={cn("text-[13px] font-bold tabular-nums whitespace-nowrap", c.newMin > c.oldMin ? "text-blue-600" : "text-emerald-600")}>
                                    {c.newMin > c.oldMin ? "↑" : "↓"} {c.newMin}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-[12px] text-slate-500 tabular-nums whitespace-nowrap">{c.avgDailySales}/day</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {phase === "done" && applied && (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-500" />
              </div>
              <div>
                <p className="text-[16px] font-bold text-slate-800">Update Complete</p>
                <p className="text-[13px] text-slate-500 mt-1">
                  {applied.updated} medicine{applied.updated !== 1 ? "s" : ""} updated · {applied.skipped} skipped
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-100 transition-colors">
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {phase === "preview" && preview && preview.changes.length > 0 && !error && (
            <button
              onClick={applyChanges}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Apply {preview.updated} Change{preview.updated !== 1 ? "s" : ""}
            </button>
          )}
          {phase === "applying" && (
            <button disabled className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-400 text-white text-[13px] font-semibold opacity-70">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
