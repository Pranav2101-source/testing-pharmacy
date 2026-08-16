import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Plus, Search, Phone, Mail, MapPin, CreditCard,
  Loader2, FileX, AlertCircle, X, Check, RefreshCw,
  History,
} from "lucide-react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api-client";
import { INDIAN_STATES, stateFromGstin, normaliseState } from "@/lib/indianStates";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { queryKeys } from "@/lib/queryKeys";
import { TableSkeletonRows } from "@/components/Skeleton";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Supplier = {
  id:           string;
  name:         string;
  gstin:        string | null;
  dlNumber:     string | null;
  phone:        string | null;
  email:        string | null;
  address:      string | null;
  city:         string | null;
  state:        string | null;
  creditLimit:  number;
  creditDays:   number;
  paymentTerms: string | null;
  isActive:     boolean;
  _count:       { purchaseOrders: number };
};

type HistoryData = {
  orders: {
    items: {
      id: string; orderNumber: string; status: string;
      totalAmount: number; orderedAt: string; _count: { items: number };
    }[];
  };
  recentGRNs: { id: string; grnNumber: string; status: string; totalAmount: number; createdAt: string }[];
  summary:    { totalOrders: number; totalSpend: number };
};

type FormState = {
  name: string; gstin: string; dlNumber: string; phone: string;
  email: string; address: string; city: string; state: string;
  creditLimit: string; creditDays: string; paymentTerms: string;
};

const BLANK: FormState = {
  name: "", gstin: "", dlNumber: "", phone: "", email: "",
  address: "", city: "", state: "", creditLimit: "0", creditDays: "30", paymentTerms: "",
};

// ─── History Modal ─────────────────────────────────────────────────────────────

function HistoryModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [data,    setData]    = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/suppliers/${supplier.id}/history`)
      .then(({ data }) => setData(data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  function fmtAmt(n: number) { return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`; }
  function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[86vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Purchase History</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{supplier.name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
          ) : !data ? (
            <div className="text-center py-16 text-slate-400">Failed to load history</div>
          ) : (
            <div className="space-y-5">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide">Total Orders</p>
                  <p className="text-[24px] font-black text-blue-700 mt-1">{data.summary.totalOrders}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">Total Spend</p>
                  <p className="text-[24px] font-black text-emerald-700 mt-1">{fmtAmt(data.summary.totalSpend)}</p>
                </div>
              </div>

              {/* Credit info */}
              {(supplier.creditLimit > 0 || supplier.creditDays > 0) && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="text-[12px] font-bold text-amber-600 mb-2 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />Credit Terms</p>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-[10px] text-amber-500 font-semibold uppercase">Limit</p>
                      <p className="text-[15px] font-bold text-amber-800">{fmtAmt(supplier.creditLimit)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-amber-500 font-semibold uppercase">Days</p>
                      <p className="text-[15px] font-bold text-amber-800">{supplier.creditDays}d</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-amber-500 font-semibold uppercase">Terms</p>
                      <p className="text-[13px] font-semibold text-amber-700">{supplier.paymentTerms || "—"}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Recent GRNs */}
              {data.recentGRNs.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-2">Recent Receipts</p>
                  <div className="space-y-1.5">
                    {data.recentGRNs.map((grn) => (
                      <div key={grn.id} className="flex items-center justify-between bg-emerald-50/50 border border-emerald-100 rounded-lg px-3 py-2.5">
                        <div>
                          <p className="text-[13px] font-bold text-emerald-700">{grn.grnNumber}</p>
                          <p className="text-[11px] text-slate-400">{fmtDate(grn.createdAt)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-semibold text-slate-700">{fmtAmt(grn.totalAmount)}</p>
                          <p className={cn("text-[10px] font-bold", grn.status === "CONFIRMED" ? "text-emerald-600" : "text-amber-600")}>{grn.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Orders */}
              {data.orders.items.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-2">Purchase Orders</p>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200">
                          {["Order No","Items","Status","Amount","Date"].map((h) => (
                            <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.orders.items.map((o) => (
                          <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2.5 text-[12px] font-bold text-blue-600">{o.orderNumber}</td>
                            <td className="px-3 py-2.5 text-[12px] text-slate-500 tabular-nums">{o._count.items}</td>
                            <td className="px-3 py-2.5">
                              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border",
                                o.status === "RECEIVED"  ? "bg-emerald-50 text-emerald-700 border-emerald-200"  :
                                o.status === "PENDING"   ? "bg-amber-50  text-amber-700   border-amber-200"   :
                                o.status === "CANCELLED" ? "bg-red-50    text-red-600     border-red-200"     :
                                                           "bg-slate-100 text-slate-600   border-slate-200"
                              )}>{o.status}</span>
                            </td>
                            <td className="px-3 py-2.5 text-[12px] font-semibold text-slate-700 tabular-nums">{fmtAmt(o.totalAmount)}</td>
                            <td className="px-3 py-2.5 text-[11px] text-slate-400">{fmtDate(o.orderedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Supplier Modal ────────────────────────────────────────────────────────────

function SupplierModal({ supplier, onClose, onSaved }: {
  supplier: Supplier | null; onClose: () => void; onSaved: (s: Supplier) => void;
}) {
  const [form,   setForm]   = useState<FormState>(supplier ? {
    name:         supplier.name,
    gstin:        supplier.gstin        ?? "",
    dlNumber:     supplier.dlNumber     ?? "",
    phone:        supplier.phone        ?? "",
    email:        supplier.email        ?? "",
    address:      supplier.address      ?? "",
    city:         supplier.city         ?? "",
    // Legacy rows hold free text ("karnataka"); resolve to the canonical name so the select
    // shows the value rather than appearing blank and inviting a needless re-pick.
    state:        normaliseState(supplier.state)?.name ?? supplier.state ?? "",
    creditLimit:  String(supplier.creditLimit),
    creditDays:   String(supplier.creditDays),
    paymentTerms: supplier.paymentTerms ?? "",
  } : BLANK);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * State is a fixed list, never free text.
   *
   * <p>It decides whether purchases from this supplier attract IGST or CGST+SGST, and that
   * decision is made by comparing it against the pharmacy's own state — so a typo is not a
   * cosmetic problem, it silently books tax under the wrong head. Live data had one
   * supplier's state recorded as "cjd9949".
   */
  function StateField() {
    const derived = stateFromGstin(form.gstin);
    const mismatch = derived && form.state && derived.name !== form.state;
    return (
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
          State <span className="text-red-500">*</span>
        </label>
        <select
          value={form.state}
          onChange={(e) => set("state")(e.target.value)}
          className={cn(
            "w-full border rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors",
            mismatch ? "border-red-300 text-red-700" : form.state ? "border-slate-200 text-slate-800" : "border-slate-200 text-slate-400"
          )}
        >
          <option value="">Select a state…</option>
          {INDIAN_STATES.map(st => (
            <option key={st.code} value={st.name}>{st.name}</option>
          ))}
        </select>
        {mismatch ? (
          <p className="text-[10px] text-red-600 mt-1">
            This GSTIN belongs to {derived.name}. The two must agree — correct whichever is wrong.
          </p>
        ) : derived ? (
          <p className="text-[10px] text-emerald-600 mt-1">Matches the GSTIN.</p>
        ) : (
          <p className="text-[10px] text-slate-400 mt-1">Decides IGST vs CGST+SGST on purchases.</p>
        )}
      </div>
    );
  }

  function F({ label, k, placeholder, type = "text" }: { label: string; k: keyof FormState; placeholder?: string; type?: string }) {
    return (
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
        <input type={type} value={form[k]} onChange={(e) => set(k)(e.target.value)} placeholder={placeholder}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors" />
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Supplier name is required"); return; }
    if (!form.state.trim()) {
      setError("Pick the supplier's state — it decides whether their invoices carry IGST or CGST+SGST.");
      return;
    }
    const gstinState = stateFromGstin(form.gstin);
    if (gstinState && gstinState.name !== form.state.trim()) {
      setError(`This GSTIN belongs to ${gstinState.name}, but the state is set to ${form.state.trim()}. They must agree.`);
      return;
    }
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
        creditLimit:  Number(form.creditLimit),
        creditDays:   Number(form.creditDays),
        paymentTerms: form.paymentTerms.trim() || undefined,
      };
      const { data } = supplier
        ? await api.patch(`/suppliers/${supplier.id}`, body)
        : await api.post("/suppliers", body);
      onSaved(data.data);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to save supplier"));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-[16px] font-bold text-slate-900">{supplier ? "Edit Supplier" : "Add Supplier"}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          {/* Basic info */}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Basic Information</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><F label="Supplier Name *" k="name" placeholder="e.g. Sun Pharma Distributors" /></div>
              <F label="GSTIN"       k="gstin"    placeholder="22AAAAA0000A1Z5" />
              <F label="Drug License" k="dlNumber" placeholder="DL No." />
              <F label="Phone"       k="phone"    placeholder="+91 98765 43210" />
              <F label="Email"       k="email"    placeholder="contact@supplier.com" type="email" />
            </div>
          </div>

          {/* Address */}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Address</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-3"><F label="Street Address" k="address" placeholder="123, MG Road" /></div>
              <F label="City"  k="city"  placeholder="Mumbai" />
              <StateField />
            </div>
          </div>

          {/* Credit terms */}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" />Credit Terms
            </p>
            <div className="grid grid-cols-3 gap-4">
              <F label="Credit Limit (₹)"  k="creditLimit"  placeholder="0" type="number" />
              <F label="Credit Days"        k="creditDays"   placeholder="30" type="number" />
              <F label="Payment Terms"      k="paymentTerms" placeholder="e.g. Net 30" />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {supplier ? "Save Changes" : "Add Supplier"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState("");
  const [modal,      setModal]      = useState<"add" | "edit" | null>(null);
  const [editing,    setEditing]    = useState<Supplier | null>(null);
  const [history,    setHistory]    = useState<Supplier | null>(null);
  const queryClient = useQueryClient();

  const dSearch = useDebounce(search, 350);

  // Same query key shape as the Purchases module's Distributors tab — both
  // tables read the exact same /suppliers list, so they now share one cache
  // entry instead of each re-fetching on every visit.
  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: queryKeys.suppliers.list({ page, search: dSearch }),
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (dSearch.trim()) params.search = dSearch.trim();
      const { data } = await api.get("/suppliers", { params });
      return data.data as { items: Supplier[]; total: number };
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const suppliers  = data?.items ?? [];
  const total       = data?.total ?? 0;
  const totalPages  = Math.ceil(total / 20) || 1;
  const loading     = isPending;

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ["suppliers", "list"] });
    setModal(null); setEditing(null);
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-bold text-slate-900 leading-none">Suppliers</h1>
          <button onClick={() => { setEditing(null); setModal("add"); }}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />Add Supplier
          </button>
        </div>
        <span className="text-[12px] text-slate-400">{total} suppliers</span>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0">
        <div className="flex items-center border border-slate-200 rounded-md bg-white overflow-hidden h-[30px] shadow-sm flex-1 max-w-[300px]">
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search supplier name…"
            className="px-3 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-full h-full text-[13px]" />
          <span className="px-2.5 text-slate-400"><Search className="w-3.5 h-3.5" /></span>
        </div>
        <button onClick={() => refetch()} className="w-[30px] h-[30px] rounded-md border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:border-slate-300 shadow-sm transition-all">
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {["Supplier","Contact","Location","GSTIN","Drug Lic.","Credit Limit","Credit Days","POs",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeletonRows columns={9} widths={["w-28","w-20","w-20","w-16","w-12","w-16","w-10","w-8","w-6"]} />
            ) : isError ? (
              <tr><td colSpan={9} className="py-16 text-center"><AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" /><p className="text-red-500 text-[13px]">Failed to load suppliers</p></td></tr>
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={9} className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">No suppliers yet</p></td></tr>
            ) : suppliers.map((s) => (
              <tr key={s.id} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors group">
                <td className="px-4 py-3">
                  <p className="text-[13px] font-bold text-slate-800">{s.name}</p>
                  {!s.isActive && <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 ml-1">Inactive</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">
                  {s.phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3" />{s.phone}</p>}
                  {s.email && <p className="flex items-center gap-1 truncate max-w-[150px]"><Mail className="w-3 h-3" />{s.email}</p>}
                  {!s.phone && !s.email && <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">
                  {(s.city || s.state) ? <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{[s.city, s.state].filter(Boolean).join(", ")}</span> : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-[11px] font-mono text-slate-500">{s.gstin ?? "—"}</td>
                <td className="px-4 py-3 text-[11px] text-slate-500">{s.dlNumber ?? "—"}</td>
                <td className="px-4 py-3 text-[12px] text-slate-700 tabular-nums">
                  {s.creditLimit > 0 ? `₹${s.creditLimit.toLocaleString("en-IN")}` : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-700 tabular-nums">
                  {s.creditDays > 0 ? `${s.creditDays}d` : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{s._count.purchaseOrders}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditing(s); setModal("edit"); }}
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded-md px-2 py-1 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => setHistory(s)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-md px-2 py-1 transition-colors">
                      <History className="w-3 h-3" />History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && total > 20 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
          <span className="text-[12px] text-slate-500">Showing <span className="font-semibold text-slate-700">{Math.min((page-1)*20+1,total)}–{Math.min(page*20,total)}</span> of <span className="font-semibold text-slate-700">{total}</span></span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1,p-1))} disabled={page===1} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
            <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {(modal === "add" || modal === "edit") && (
          <SupplierModal
            supplier={modal === "edit" ? editing : null}
            onClose={() => { setModal(null); setEditing(null); }}
            onSaved={handleSaved}
          />
        )}
        {history && <HistoryModal supplier={history} onClose={() => setHistory(null)} />}
      </AnimatePresence>
    </div>
  );
}
