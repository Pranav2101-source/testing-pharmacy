import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Banknote, Check, X } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Supplier } from "../types";
import { currency, fmtDate, daysUntil } from "../utils";
import { SlidePanel } from "./AutoSuggestPanel";

export function OverdueBillsPanel({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const [items,   setItems]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [payFor,  setPayFor]  = useState<any | null>(null);
  const [amount,  setAmount]  = useState("");
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    api.get("/purchases/grn", { params: { overdue: true, status: "CONFIRMED", limit: 50 } })
      .then(({ data }) => setItems(data.data.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  async function pay(grn: any) {
    if (!amount || isNaN(+amount) || +amount <= 0) return;
    setSaving(true);
    try {
      await api.post("/supplier-payments", {
        supplierId:  grn.supplier.id,
        grnId:       grn.id,
        amount:      +amount,
        paymentMode: "CASH",
      });
      setItems((p) => p.filter((i) => i.id !== grn.id));
      setPayFor(null); setAmount("");
    } catch {/* */} finally { setSaving(false); }
  }

  return (
    <SlidePanel title="Overdue Bills" subtitle="GRNs past their payment due date" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-300 mb-3" />
            <p className="text-[14px] font-semibold text-slate-700">No overdue payments</p>
            <p className="text-[12px] text-slate-400">All bills are within their credit period.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{items.length} overdue bill{items.length !== 1 ? "s" : ""}</p>
            {items.map((grn) => {
              const overdueDays = Math.abs(daysUntil(grn.paymentDueDate) ?? 0);
              return (
                <div key={grn.id} className="border border-red-200 bg-red-50/30 rounded-xl p-3.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-slate-800">{grn.supplier.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{grn.grnNumber} · {grn.supplierInvoiceNo ?? "No invoice no."}</p>
                      <p className="text-[11px] text-red-600 font-semibold mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />{overdueDays} days overdue · Due {fmtDate(grn.paymentDueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[15px] font-black text-slate-800">{currency(grn.totalAmount)}</p>
                    </div>
                  </div>
                  {payFor?.id === grn.id ? (
                    <div className="mt-3 flex items-center gap-2">
                      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                        placeholder="Amount ₹" className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-400" />
                      <button onClick={() => pay(grn)} disabled={saving}
                        className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Pay
                      </button>
                      <button onClick={() => setPayFor(null)} className="text-slate-400 hover:text-slate-600 p-1.5"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <button onClick={() => { setPayFor(grn); setAmount(String(grn.totalAmount.toFixed(2))); }}
                      className="mt-2.5 w-full flex items-center justify-center gap-1.5 border border-green-200 text-green-700 hover:bg-green-50 text-[12px] font-semibold rounded-lg py-1.5 transition-colors">
                      <Banknote className="w-3.5 h-3.5" />Record Payment
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </SlidePanel>
  );
}
