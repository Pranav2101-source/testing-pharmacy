import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, X, Check, AlertCircle } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { BATCH_STATUS_CFG } from "../types";
import type { BatchStatus, InventoryItem } from "../types";

export function BatchStatusModal({ item, onClose, onDone, onToast }: {
  item: InventoryItem; onClose: () => void; onDone: () => void;
  onToast: (msg: string, variant: "success" | "error") => void;
}) {
  const [status, setStatus] = useState<BatchStatus>(item.status);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError("Reason is required"); return; }
    setSaving(true); setError(null);
    try {
      await api.patch(`/inventory/${item.id}`, { status, statusReason: reason });
      onToast(`Batch status updated to ${BATCH_STATUS_CFG[status].label}`, "success");
      onDone();
    } catch (err: any) {
      // Keep error inline so user can see it and retry without losing their input
      setError(getErrorMessage(err, "Failed to update status"));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Update Batch Status</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{item.medicine.name} · Batch {item.batchNumber}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(BATCH_STATUS_CFG) as BatchStatus[]).map((s) => {
              const cfg = BATCH_STATUS_CFG[s]; const Icon = cfg.icon;
              return (
                <button key={s} type="button" onClick={() => setStatus(s)}
                  className={cn("flex items-center gap-2 border rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-all",
                    status === s ? cn(cfg.cls, "ring-2 ring-offset-1 ring-current") : "border-slate-200 text-slate-600 hover:border-slate-300"
                  )}>
                  <Icon className="w-3.5 h-3.5" />{cfg.label}
                </button>
              );
            })}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Reason *</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Why is this batch being changed?"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none" />
          </div>
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Update
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
