import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, X, Check, AlertCircle, PlusCircle, MinusCircle } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ADJUSTMENT_REASONS } from "../types";
import type { InventoryItem } from "../types";

export function AdjustStockModal({ item, onClose, onDone, onToast }: {
  item: InventoryItem; onClose: () => void; onDone: () => void;
  onToast: (msg: string, variant: "success" | "error") => void;
}) {
  const [mode,   setMode]   = useState<"add" | "remove">("add");
  const [qty,    setQty]    = useState(1);
  const [type,   setType]   = useState<string>("STOCK_COUNT");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (qty <= 0) { setError("Quantity must be a positive number"); return; }
    if (mode === "remove" && qty > item.quantity) {
      setError(`Cannot remove ${qty} — only ${item.quantity} in stock`); return;
    }
    if (!reason.trim()) { setError("Notes are required"); return; }
    setSaving(true); setError(null);
    try {
      const delta = mode === "add" ? qty : -qty;
      await api.patch(`/inventory/${item.id}`, { adjust: { delta, reason, type } });
      onToast(`Stock updated — ${item.medicine.name} (Batch ${item.batchNumber})`, "success");
      onDone();
    } catch (err: any) {
      // Keep error inline inside the modal so the user can correct and retry
      setError(getErrorMessage(err, "Failed to adjust stock"));
    } finally { setSaving(false); }
  }

  const newQty = mode === "add" ? item.quantity + qty : item.quantity - qty;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg"
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Adjust Stock</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{item.medicine.name} · Batch {item.batchNumber} · Current: <span className="font-bold text-slate-600">{item.quantity}</span></p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
          {/* Add / Remove toggle */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            {(["add", "remove"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold transition-all",
                  mode === m
                    ? m === "add" ? "bg-emerald-600 text-white" : "bg-red-500 text-white"
                    : "bg-white text-slate-500 hover:bg-slate-50"
                )}>
                {m === "add" ? <PlusCircle className="w-4 h-4" /> : <MinusCircle className="w-4 h-4" />}
                {m === "add" ? "Add Stock" : "Remove Stock"}
              </button>
            ))}
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Quantity</label>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 font-bold">−</button>
                <input type="number" value={qty} min={1} onChange={(e) => setQty(Math.max(1, +e.target.value))}
                  className="w-20 text-center border border-slate-200 rounded-lg px-3 py-2 text-[14px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
                <button type="button" onClick={() => setQty((q) => q + 1)}
                  className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 font-bold">+</button>
              </div>
              <span className="text-[12px] text-slate-400">
                → New qty: <span className={cn("font-bold", newQty < 0 ? "text-red-600" : "text-slate-700")}>{newQty}</span>
              </span>
            </div>
          </div>

          {/* Reason Code */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Reason Code</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ADJUSTMENT_REASONS.map((r) => (
                <button key={r.value} type="button" onClick={() => setType(r.value)}
                  className={cn("text-left border rounded-lg px-2.5 py-2 transition-all",
                    type === r.value ? "border-blue-400 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"
                  )}>
                  <p className="text-[12px] font-semibold text-slate-700">{r.label}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{r.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes *</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="Describe the adjustment…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none" />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || newQty < 0}
              className={cn("px-5 py-2 rounded-lg text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2",
                mode === "add" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-500 hover:bg-red-600"
              )}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Confirm Adjustment
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
