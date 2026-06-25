import { useState } from "react";
import { Loader2, CheckCircle2, FileText, AlertTriangle } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Supplier } from "../types";
import { SlidePanel } from "./AutoSuggestPanel";

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

export function QuickCreditNotePanel({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [amount,     setAmount]     = useState("");
  const [notes,      setNotes]      = useState("");
  const [saving,     setSaving]     = useState(false);
  const [success,    setSuccess]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || !amount) { setError("Select a supplier and enter amount"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/supplier-credit-notes", {
        supplierId, amount: +amount, notes: notes || undefined,
      });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to create credit note"));
    } finally { setSaving(false); }
  }

  return (
    <SlidePanel title="Raise Credit Note" subtitle="Track credit issued by a supplier" onClose={onClose}>
      <div className="px-5 py-4">
        {success ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-7 h-7 text-blue-600" />
            </div>
            <p className="text-[15px] font-bold text-slate-800">Credit Note Created!</p>
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
              <FieldLabel>Credit Amount (₹) *</FieldLabel>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" step="0.01" min={0}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            <div>
              <FieldLabel>Notes</FieldLabel>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Reason for credit note…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            {error && <ErrorBanner msg={error} />}
            <button type="submit" disabled={saving}
              className={cn("w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold py-2.5 rounded-lg disabled:opacity-60 transition-colors")}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Create Credit Note
            </button>
          </form>
        )}
      </div>
    </SlidePanel>
  );
}
