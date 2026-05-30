"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus, Search, Loader2, FileX, AlertCircle, X, Check,
  AlertTriangle, Calendar, Package2, ChevronDown, SlidersHorizontal,
  TrendingDown, TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type InventoryItem = {
  id:           string;
  batchNumber:  string;
  expiryDate:   string;
  quantity:     number;
  minimumStock: number;
  mrp:          number;
  purchaseRate: number;
  location:     string | null;
  medicine: {
    name:        string;
    genericName: string | null;
    form:        string | null;
  };
};

type Tab = "all" | "inStock" | "lowStock" | "nearExpiry";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function daysLeft(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function ExpiryBadge({ date }: { date: string }) {
  const days = daysLeft(date);
  if (days <= 0)  return <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Expired</span>;
  if (days <= 30) return <span className="text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">{days}d left</span>;
  if (days <= 90) return <span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{days}d left</span>;
  return <span className="text-[13px] text-slate-600">{formatDate(date)}</span>;
}

// ─── Add Stock Modal ──────────────────────────────────────────────────────────

type StockForm = {
  medicineSearch: string;
  medicineId:     string;
  medicineName:   string;
  batchNumber:    string;
  expiryDate:     string;
  quantity:       string;
  mrp:            string;
  purchaseRate:   string;
  location:       string;
  minimumStock:   string;
};

const BLANK_FORM: StockForm = {
  medicineSearch: "", medicineId: "", medicineName: "",
  batchNumber: "", expiryDate: "", quantity: "",
  mrp: "", purchaseRate: "", location: "", minimumStock: "10",
};

// ── Shared modal shell ────────────────────────────────────────────────────────

function ModalShell({
  title, icon: Icon, iconBg, onClose, children,
}: {
  title:   string;
  icon:    React.ElementType;
  iconBg:  string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.96, y: 10  }}
        transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", iconBg)}>
              <Icon className="w-4 h-4" />
            </div>
            <h2 className="text-[16px] font-bold text-slate-900">{title}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

// Inline warning banner used inside forms
function FormWarning({ message }: { message: string }) {
  return (
    <div className="col-span-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-[12px] text-amber-800">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
      <span>{message}</span>
    </div>
  );
}

// ── Add Stock Modal ──────────────────────────────────────────────────────────

function AddStockModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form,       setForm]       = useState<StockForm>(BLANK_FORM);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [medResults, setMedResults] = useState<{ id: string; name: string; genericName: string | null }[]>([]);
  const [medOpen,    setMedOpen]    = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  function set(k: keyof StockForm) { return (v: string) => setForm((f) => ({ ...f, [k]: v })); }

  const qty          = Number(form.quantity)     || 0;
  const mrp          = Number(form.mrp)          || 0;
  const purchaseRate = Number(form.purchaseRate) || 0;
  const expiryInPast = form.expiryDate
    ? new Date(form.expiryDate) < new Date(new Date().toDateString())
    : false;

  useEffect(() => {
    if (!form.medicineSearch.trim()) { setMedResults([]); setMedOpen(false); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get("/medicines/search", { params: { q: form.medicineSearch, limit: 6 } });
        setMedResults(data.data);
        setMedOpen(data.data.length > 0);
      } catch { setMedResults([]); }
    }, 300);
  }, [form.medicineSearch]);

  function selectMed(med: { id: string; name: string }) {
    setForm((f) => ({ ...f, medicineId: med.id, medicineName: med.name, medicineSearch: med.name }));
    setMedOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.medicineId)  { setError("Select a medicine from the list."); return; }
    if (!form.batchNumber) { setError("Batch number is required."); return; }
    if (!form.expiryDate)  { setError("Expiry date is required."); return; }
    if (qty <= 0)          { setError("Quantity must be > 0."); return; }
    if (mrp <= 0)          { setError("MRP must be > 0."); return; }
    if (purchaseRate <= 0) { setError("Purchase rate must be > 0."); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/inventory", {
        medicineId:   form.medicineId,
        batchNumber:  form.batchNumber,
        expiryDate:   new Date(form.expiryDate).toISOString(),
        quantity:     qty,
        mrp,
        purchaseRate,
        location:     form.location.trim() || undefined,
        minimumStock: Number(form.minimumStock) || 10,
      });
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      setError(e?.response?.data?.error ?? e?.response?.data?.message ?? "Failed to add stock.");
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="Add Stock" icon={Package2} iconBg="bg-blue-50 text-blue-600" onClose={onClose}>
      <form onSubmit={submit} className="px-6 py-5 grid grid-cols-2 gap-4">
        {/* Medicine search */}
        <div className="col-span-2 relative">
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Medicine *</label>
          <div className="relative">
            <input
              value={form.medicineSearch}
              onChange={(e) => set("medicineSearch")(e.target.value)}
              placeholder="Search medicine name…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
            <AnimatePresence>
              {medOpen && (
                <motion.ul
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
                >
                  {medResults.map((m) => (
                    <li key={m.id} onMouseDown={() => selectMed(m)}
                      className="px-4 py-2.5 text-[13px] cursor-pointer hover:bg-blue-50 flex flex-col border-b border-slate-50 last:border-0"
                    >
                      <span className="font-semibold text-slate-800">{m.name}</span>
                      {m.genericName && <span className="text-[11px] text-slate-400">{m.genericName}</span>}
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        </div>

        {[
          { label: "Batch Number *",    key: "batchNumber",  type: "text",   placeholder: "e.g. BT2024001" },
          { label: "Expiry Date *",     key: "expiryDate",   type: "date",   placeholder: "" },
          { label: "Quantity *",        key: "quantity",     type: "number", placeholder: "e.g. 100" },
          { label: "MRP (₹) *",         key: "mrp",          type: "number", placeholder: "e.g. 45.00" },
          { label: "Purchase Rate ₹ *", key: "purchaseRate", type: "number", placeholder: "e.g. 38.00" },
          { label: "Min. Stock",        key: "minimumStock", type: "number", placeholder: "10" },
          { label: "Location / Rack",   key: "location",     type: "text",   placeholder: "e.g. Rack A-3" },
        ].map(({ label, key, type, placeholder }) => (
          <div key={key}>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
            <input
              type={type}
              step={type === "number" ? "any" : undefined}
              min={type === "number" ? "0" : undefined}
              value={form[key as keyof StockForm]}
              onChange={(e) => set(key as keyof StockForm)(e.target.value)}
              placeholder={placeholder}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
          </div>
        ))}

        {/* ── Data quality warnings ─────────────────────────────── */}
        {qty > 500 && (
          <FormWarning
            message={`You're adding ${qty.toLocaleString()} units — unusually large. Verify this is correct before saving.`}
          />
        )}
        {purchaseRate > 0 && mrp > 0 && purchaseRate > mrp && (
          <FormWarning
            message={`Purchase rate (₹${purchaseRate}) exceeds MRP (₹${mrp}). Selling below cost — verify before saving.`}
          />
        )}
        {expiryInPast && (
          <FormWarning
            message="This expiry date is in the past. Only add expired stock for record-keeping purposes."
          />
        )}

        {error && (
          <div className="col-span-2 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[13px] text-red-600">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        <div className="col-span-2 flex justify-end gap-3 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors disabled:opacity-60 flex items-center gap-2">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Add Stock
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Adjust Stock Modal ────────────────────────────────────────────────────────

const ADJUSTMENT_TYPES = [
  { value: "CORRECTION",      label: "Stock Correction",   desc: "Fix wrong opening stock or data entry error"  },
  { value: "DAMAGE",          label: "Damage / Wastage",   desc: "Write off damaged or unusable stock"          },
  { value: "EXPIRY_WRITEOFF", label: "Expiry Write-off",   desc: "Remove expired stock from inventory"          },
  { value: "OPENING_BALANCE", label: "Opening Balance",    desc: "Set initial stock for a new batch"            },
  { value: "TRANSFER",        label: "Inter-rack Transfer", desc: "Move stock between locations"                },
] as const;

type AdjustForm = {
  deltaAbs: string;
  direction: "add" | "remove";
  type:   string;
  reason: string;
};

function AdjustStockModal({
  item,
  onClose,
  onSaved,
}: {
  item:    InventoryItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form,    setForm]    = useState<AdjustForm>({ deltaAbs: "", direction: "remove", type: "CORRECTION", reason: "" });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const deltaAbs  = Number(form.deltaAbs) || 0;
  const delta     = form.direction === "add" ? deltaAbs : -deltaAbs;
  const newQty    = item.quantity + delta;
  const wouldGo0  = newQty === 0;
  const wouldGoNeg = newQty < 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (deltaAbs <= 0)          { setError("Enter a quantity greater than zero."); return; }
    if (!form.reason.trim())    { setError("Reason is required."); return; }
    if (wouldGoNeg)             { setError("Adjustment would result in negative stock."); return; }
    setSaving(true); setError(null);
    try {
      await api.patch(`/inventory/${item.id}/adjust`, {
        delta,
        reason: form.reason,
        type:   form.type,
      });
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      setError(e?.response?.data?.error ?? e?.response?.data?.message ?? "Adjustment failed.");
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="Adjust Stock" icon={SlidersHorizontal} iconBg="bg-amber-50 text-amber-600" onClose={onClose}>
      <form onSubmit={submit} className="px-6 py-5 space-y-4">

        {/* Current stock summary */}
        <div className="flex items-center gap-4 bg-slate-50 rounded-xl p-4 border border-slate-200">
          <div className="flex-1">
            <p className="text-[13px] font-bold text-slate-800 truncate">{item.medicine.name}</p>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">Batch {item.batchNumber}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide">Current Stock</p>
            <p className="text-[20px] font-black text-slate-900 tabular-nums leading-none">{item.quantity}</p>
          </div>
        </div>

        {/* Direction toggle */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Adjustment Type</label>
          <div className="flex gap-2">
            {(["remove", "add"] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setForm((f) => ({ ...f, direction: dir }))}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[13px] font-semibold transition-colors",
                  form.direction === dir
                    ? dir === "remove"
                      ? "bg-red-50 border-red-300 text-red-700"
                      : "bg-emerald-50 border-emerald-300 text-emerald-700"
                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                )}
              >
                {dir === "remove"
                  ? <><TrendingDown className="w-4 h-4" /> Remove Stock</>
                  : <><TrendingUp   className="w-4 h-4" /> Add Stock</>
                }
              </button>
            ))}
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Quantity *</label>
          <input
            type="number" min="1" value={form.deltaAbs}
            onChange={(e) => setForm((f) => ({ ...f, deltaAbs: e.target.value }))}
            placeholder="e.g. 10"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
          />
          {deltaAbs > 0 && (
            <p className={cn(
              "text-[12px] font-semibold mt-1.5",
              wouldGoNeg ? "text-red-600" :
              wouldGo0   ? "text-amber-600" : "text-slate-500"
            )}>
              {item.quantity} → {newQty < 0 ? "negative ⚠" : newQty} units
              {wouldGoNeg && " — cannot go below zero"}
              {wouldGo0   && " — stock will reach zero"}
            </p>
          )}
        </div>

        {/* Reason type */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Adjustment Reason</label>
          <div className="relative">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full appearance-none border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white"
            >
              {ADJUSTMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {ADJUSTMENT_TYPES.find((t) => t.value === form.type)?.desc}
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Notes / Details *</label>
          <textarea
            rows={2}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="Describe the reason for this adjustment…"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[13px] text-red-600">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50 transition-colors">Cancel</button>
          <button
            type="submit"
            disabled={saving || wouldGoNeg}
            className={cn(
              "px-6 py-2 rounded-lg text-white text-[13px] font-semibold transition-colors disabled:opacity-60 flex items-center gap-2",
              form.direction === "remove" ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"
            )}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Confirm Adjustment
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "all",        label: "All Stock"   },
  { key: "inStock",    label: "In Stock"    },
  { key: "lowStock",   label: "Low Stock"   },
  { key: "nearExpiry", label: "Near Expiry" },
];

export default function InventoryPage() {
  const [items,      setItems]      = useState<InventoryItem[]>([]);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [tab,        setTab]        = useState<Tab>("all");
  const [search,     setSearch]     = useState("");
  const [showModal,  setShowModal]  = useState(false);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params: Record<string, string | number | boolean> = { page, limit: 20 };
      if (search.trim())          params.search     = search.trim();
      if (tab === "inStock")      params.inStock     = true;
      if (tab === "lowStock")     params.lowStock    = true;
      if (tab === "nearExpiry")   params.nearExpiry  = true;
      const { data } = await api.get("/inventory", { params });
      setItems(data.data.items);
      setTotal(data.data.total);
      setTotalPages(Math.ceil(data.data.total / 20));
    } catch { setError("Failed to load inventory."); }
    finally { setLoading(false); }
  }, [page, search, tab]);

  useEffect(() => {
    const delay = search ? 350 : 0;
    const t = setTimeout(fetch, delay);
    return () => clearTimeout(t);
  }, [fetch]);

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-bold text-slate-900 leading-none">Inventory</h1>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            Add Stock
          </button>
        </div>
        <span className="text-[12px] text-slate-400">{total} batches</span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0">
        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTab(key); setPage(1); }}
              className={cn(
                "px-3 py-1 rounded-md text-[12px] font-semibold transition-colors whitespace-nowrap",
                tab === key ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center border border-slate-200 rounded-md bg-white overflow-hidden h-[30px] shadow-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search medicine name…"
            className="px-3 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-48 h-full text-[13px]"
          />
          <span className="px-2.5 text-slate-400 flex items-center h-full">
            <Search className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {["Medicine", "Generic", "Batch", "Expiry", "Qty", "Min Stock", "MRP", "P.Rate", "Location", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="py-24 text-center">
                <Loader2 className="w-7 h-7 animate-spin text-blue-400 mx-auto" />
                <p className="text-slate-400 text-[13px] mt-3">Loading inventory…</p>
              </td></tr>
            ) : error ? (
              <tr><td colSpan={10} className="py-24 text-center">
                <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-3" />
                <p className="text-red-500 text-[13px] font-medium">{error}</p>
                <button onClick={fetch} className="mt-3 text-blue-600 text-[12px] hover:underline">Try again</button>
              </td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={10} className="py-24 text-center">
                <FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 text-[14px] font-medium">No stock found</p>
                <p className="text-slate-400 text-[12px] mt-1">
                  {tab !== "all" ? "No items match this filter" : "Add your first stock batch to get started"}
                </p>
              </td></tr>
            ) : (
              items.map((item) => {
                const isLow     = item.quantity <= item.minimumStock;
                const days      = daysLeft(item.expiryDate);
                const isExpired = days <= 0;
                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b border-slate-100 hover:bg-blue-50/30 transition-colors",
                      (isLow || isExpired) && "bg-red-50/20",
                    )}
                  >
                    <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 max-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        {(isLow || isExpired) && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                        <span className="truncate">{item.medicine.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-slate-400 max-w-[120px] truncate">{item.medicine.genericName ?? "—"}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 font-mono whitespace-nowrap">{item.batchNumber}</td>
                    <td className="px-4 py-3 whitespace-nowrap"><ExpiryBadge date={item.expiryDate} /></td>
                    <td className={cn("px-4 py-3 text-[14px] font-bold whitespace-nowrap tabular-nums", isLow ? "text-red-600" : "text-slate-900")}>
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-500 whitespace-nowrap tabular-nums">{item.minimumStock}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 whitespace-nowrap tabular-nums">₹{item.mrp.toFixed(2)}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-500 whitespace-nowrap tabular-nums">₹{item.purchaseRate.toFixed(2)}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 whitespace-nowrap">{item.location ?? "—"}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setAdjustItem(item)}
                        title="Adjust stock"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-[11px] font-semibold transition-colors"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        Adjust
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0"
        >
            <span className="text-[12px] text-slate-500">
              Showing <span className="font-semibold text-slate-700">{Math.min((page-1)*20+1,total)}–{Math.min(page*20,total)}</span> of <span className="font-semibold text-slate-700">{total}</span> batches
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
              <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
            </div>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showModal  && <AddStockModal   onClose={() => setShowModal(false)}  onSaved={() => { setShowModal(false);  fetch(); }} />}
        {adjustItem && <AdjustStockModal item={adjustItem} onClose={() => setAdjustItem(null)} onSaved={() => { setAdjustItem(null); fetch(); }} />}
      </AnimatePresence>
    </div>
  );
}
