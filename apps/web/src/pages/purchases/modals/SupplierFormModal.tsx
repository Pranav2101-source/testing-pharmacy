import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Loader2, Building2, CreditCard, AlertCircle, AlertTriangle } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { FullSupplier, SupplierFormState, Supplier } from "../types";
import { SUPPLIER_BLANK } from "../types";

// ─── Supplier Field ────────────────────────────────────────────────────────────

function SupplierField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors"
      />
    </div>
  );
}

// ─── Supplier Form Modal ───────────────────────────────────────────────────────

export function SupplierFormModal({ supplier, onClose, onSaved }: {
  supplier: FullSupplier | null;
  onClose: () => void;
  onSaved: (s: FullSupplier) => void;
}) {
  const [form,   setForm]   = useState<SupplierFormState>(supplier ? {
    name:         supplier.name,
    gstin:        supplier.gstin        ?? "",
    dlNumber:     supplier.dlNumber     ?? "",
    phone:        supplier.phone        ?? "",
    email:        supplier.email        ?? "",
    address:      supplier.address      ?? "",
    city:         supplier.city         ?? "",
    state:        supplier.state        ?? "",
    creditLimit:  String(supplier.creditLimit),
    creditDays:   String(supplier.creditDays),
    paymentTerms: supplier.paymentTerms ?? "",
  } : SUPPLIER_BLANK);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const set = (k: keyof SupplierFormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!form.name.trim()) { setError("Distributor name is required"); return; }
    setSaving(true); setError(null);
    try {
      const body = {
        name:         form.name.trim(),
        gstin:        form.gstin.trim()        || undefined,
        dlNumber:     form.dlNumber.trim()     || undefined,
        phone:        form.phone.trim()        || undefined,
        email:        form.email.trim()        || undefined,
        address:      form.address.trim()      || undefined,
        city:         form.city.trim()         || undefined,
        state:        form.state.trim()        || undefined,
        creditLimit:  Number(form.creditLimit) || 0,
        creditDays:   Number(form.creditDays)  || 30,
        paymentTerms: form.paymentTerms.trim() || undefined,
      };
      const { data } = supplier
        ? await api.patch(`/suppliers/${supplier.id}`, body)
        : await api.post("/suppliers", body);
      onSaved(data.data);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to save distributor"));
    } finally { setSaving(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-slate-900">
                {supplier ? "Edit Distributor" : "Add New Distributor"}
              </h2>
              <p className="text-[11px] text-slate-400">
                Fill in details to {supplier ? "update" : "register"} the distributor
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Basic Information</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <SupplierField label="Distributor / Company Name *" value={form.name}     onChange={set("name")}     placeholder="e.g. Sun Pharma Distributors Pvt Ltd" />
                </div>
                <SupplierField label="GSTIN"        value={form.gstin}    onChange={set("gstin")}    placeholder="22AAAAA0000A1Z5" />
                <SupplierField label="Drug License" value={form.dlNumber} onChange={set("dlNumber")} placeholder="DL No." />
                <SupplierField label="Phone"        value={form.phone}    onChange={set("phone")}    placeholder="+91 98765 43210" />
                <SupplierField label="Email"        value={form.email}    onChange={set("email")}    placeholder="contact@distributor.com" type="email" />
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Address</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-3">
                  <SupplierField label="Street Address" value={form.address} onChange={set("address")} placeholder="123, Industrial Area" />
                </div>
                <SupplierField label="City"  value={form.city}  onChange={set("city")}  placeholder="Mumbai" />
                <SupplierField label="State" value={form.state} onChange={set("state")} placeholder="Maharashtra" />
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" />Credit Terms
              </p>
              <div className="grid grid-cols-3 gap-4">
                <SupplierField label="Credit Limit (₹)" value={form.creditLimit}  onChange={set("creditLimit")}  placeholder="0"      type="number" />
                <SupplierField label="Credit Days"       value={form.creditDays}   onChange={set("creditDays")}   placeholder="30"     type="number" />
                <SupplierField label="Payment Terms"     value={form.paymentTerms} onChange={set("paymentTerms")} placeholder="Net 30" />
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Credit Days sets the payment due date automatically when a GRN is confirmed.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[13px] text-red-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0 bg-white">
            <button type="button" onClick={onClose}
              className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {supplier ? "Save Changes" : "Add Distributor"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body
  );
}

// ─── Quick Add Hint ───────────────────────────────────────────────────────────

export function QuickAddHint({ suppliers, onAdded }: { suppliers: Supplier[]; onAdded: (s: FullSupplier) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {suppliers.length > 0 ? (
        <p className="text-[11px] text-slate-400 mt-1">
          Not listed?{" "}
          <button type="button" onClick={() => setOpen(true)}
            className="text-blue-600 hover:underline font-semibold">
            + Add new distributor
          </button>
        </p>
      ) : (
        <div className="mt-1.5 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-[12px] text-amber-700">No distributors added yet.</span>
          <button type="button" onClick={() => setOpen(true)}
            className="text-[12px] font-semibold text-blue-600 hover:underline ml-1">
            Add one now →
          </button>
        </div>
      )}

      <AnimatePresence>
        {open && (
          <SupplierFormModal
            supplier={null}
            onClose={() => setOpen(false)}
            onSaved={(s) => { onAdded(s); setOpen(false); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
