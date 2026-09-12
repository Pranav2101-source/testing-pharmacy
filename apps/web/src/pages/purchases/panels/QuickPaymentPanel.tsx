import { useState } from "react";
import { Loader2, CheckCircle2, Banknote, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Supplier } from "../types";
import { SlidePanel } from "./AutoSuggestPanel";

// A payment can clear a GRN's overdue status and always moves the distributor's
// outstanding balance, so every cached view of either must be refreshed —
// otherwise the Overdue Bills badge (and Distributors tab balances) keep
// showing pre-payment numbers until an unrelated action happens to invalidate them.
function invalidatePaymentEffects(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["purchases", "summary"] });
  queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "purchases" && q.queryKey[1] === "grn" });
  queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "suppliers" });
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{children}</label>;
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[13px] text-red-600">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />{msg}
    </div>
  );
}

function FInput({ value, onChange, placeholder, type = "text", className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string;
}) {
  return (
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={cn("w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors", className)} />
  );
}

export function QuickPaymentPanel({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const [supplierId,   setSupplierId]   = useState("");
  const [amount,       setAmount]       = useState("");
  const [paymentMode,  setPaymentMode]  = useState("CASH");
  const [reference,    setReference]    = useState("");
  const [saving,       setSaving]       = useState(false);
  const [success,      setSuccess]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const queryClient = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || !amount) { setError("Select a supplier and enter amount"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/supplier-payments", {
        supplierId, amount: +amount, paymentMode,
        reference: reference || undefined,
      });
      invalidatePaymentEffects(queryClient);
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to record payment"));
    } finally { setSaving(false); }
  }

  return (
    <SlidePanel title="Record Payment" subtitle="Log a payment made to a distributor" onClose={onClose}>
      <div className="px-5 py-4">
        {success ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <p className="text-[15px] font-bold text-slate-800">Payment Recorded!</p>
            <p className="text-[12px] text-slate-400 mt-1">Closing panel…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <FieldLabel>Distributor *</FieldLabel>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Amount (₹) *</FieldLabel>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" step="0.01" min={0}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            <div>
              <FieldLabel>Payment Mode</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {["CASH", "UPI", "CARD", "CREDIT", "WALLET", "CHEQUE"].map((mode) => (
                  <button key={mode} type="button" onClick={() => setPaymentMode(mode)}
                    className={cn("py-2 rounded-lg text-[12px] font-semibold border transition-colors",
                      paymentMode === mode ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>Reference / UTR No.</FieldLabel>
              <FInput value={reference} onChange={setReference} placeholder="Optional — cheque no., UTR, etc." />
            </div>
            {error && <ErrorBanner msg={error} />}
            <button type="submit" disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-[13px] font-semibold py-2.5 rounded-lg disabled:opacity-60 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
              Record Payment
            </button>
          </form>
        )}
      </div>
    </SlidePanel>
  );
}
