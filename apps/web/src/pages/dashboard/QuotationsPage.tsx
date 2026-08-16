import { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText, Plus, Send, CheckCircle2, XCircle, ArrowRight,
  Loader2, ChevronDown, Trash2, Clock, BadgeCheck, X, Search,
  Package2, IndianRupee, ShoppingCart, GitCompare, Download,
  AlertTriangle, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, getErrorMessage } from "@/lib/api-client";
import { downloadCsv } from "@/lib/export";
import { useToast } from "@/hooks/useToast";
import { GridSkeletonRows } from "@/components/Skeleton";

// ─── Types ────────────────────────────────────────────────────────
type QStatus = "DRAFT" | "SENT" | "RECEIVED" | "EXPIRED" | "CONVERTED";

interface QuotationItem {
  id:           string;
  medicineId:   string;
  medicineName: string;
  quantity:     number;
  quotedRate:   number | null;
  mrp:          number | null;
  gstRate:      number;
  discount:     number;
  notes:        string | null;
  medicine:     { name: string; genericName: string | null; hsnCode: string | null } | null;
}
interface Quotation {
  id:              string;
  quotationNumber: string;
  status:          QStatus;
  validUntil:      string | null;
  notes:           string | null;
  createdAt:       string;
  supplier:        { id: string; name: string; phone?: string | null; email?: string | null };
  items?:          QuotationItem[];
  _count?:         { items: number };
}
interface Supplier { id: string; name: string; phone: string | null; }
interface MedicineResult {
  id: string; name: string; genericName: string | null; hsnCode: string | null;
}

// ─── Status config ────────────────────────────────────────────────
const STATUS_CFG: Record<QStatus, { label: string; bg: string; text: string; dot: string }> = {
  DRAFT:     { label: "Draft",     bg: "bg-slate-100",   text: "text-slate-600",  dot: "bg-slate-400"  },
  SENT:      { label: "Sent",      bg: "bg-blue-50",     text: "text-blue-700",   dot: "bg-blue-500"   },
  RECEIVED:  { label: "Received",  bg: "bg-emerald-50",  text: "text-emerald-700",dot: "bg-emerald-500"},
  EXPIRED:   { label: "Expired",   bg: "bg-red-50",      text: "text-red-600",    dot: "bg-red-400"    },
  CONVERTED: { label: "Converted", bg: "bg-violet-50",   text: "text-violet-700", dot: "bg-violet-500" },
};

// ─── Helpers ──────────────────────────────────────────────────────
function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function toInputDate(d: Date) { return d.toISOString().slice(0, 10); }
function effectiveRate(quotedRate: number, discount: number) {
  return parseFloat((quotedRate * (1 - discount / 100)).toFixed(2));
}

function StatusBadge({ status }: { status: QStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold", cfg.bg, cfg.text)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── Medicine search (for quotation items) ───────────────────────
function MedicineSearch({ onSelect }: { onSelect: (m: MedicineResult) => void }) {
  const [q, setQ]           = useState("");
  const [results, setResults] = useState<MedicineResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler, { passive: true });
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ success: boolean; data: MedicineResult[] }>(
          `/medicines/search?q=${encodeURIComponent(q)}&limit=8`
        );
        setResults(r.data.data ?? []);
        setOpen(true);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function select(m: MedicineResult) {
    onSelect(m);
    setQ("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-blue-400/30 focus-within:border-blue-400">
        <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <input
          type="text" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search medicine to add…"
          className="flex-1 text-[13px] text-slate-700 placeholder-slate-300 bg-transparent focus:outline-none min-w-0"
        />
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
          {results.map(m => (
            <button key={m.id} onClick={() => select(m)}
              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
              <p className="text-[13px] font-semibold text-slate-800">{m.name}</p>
              {m.genericName && <p className="text-[11px] text-slate-400">{m.genericName}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Editable item row ────────────────────────────────────────────
interface ItemDraft {
  medicineId:   string;
  medicineName: string;
  quantity:     number;
  quotedRate:   string;  // string for controlled input
  mrp:          string;
  gstRate:      number;
  discount:     number;
  notes:        string;
}

function ItemRow({ item, idx, onChange, onRemove }: {
  item: ItemDraft;
  idx: number;
  onChange: (idx: number, patch: Partial<ItemDraft>) => void;
  onRemove: (idx: number) => void;
}) {
  const rate = parseFloat(item.quotedRate) || 0;
  const eff  = rate > 0 ? effectiveRate(rate, item.discount) : null;
  return (
    <div className="grid grid-cols-[2fr_0.7fr_0.9fr_0.9fr_0.7fr_0.7fr_36px] gap-2 items-center px-4 py-2.5 hover:bg-slate-50/50 border-b border-slate-100">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{item.medicineName}</p>
        {item.notes !== undefined && (
          <input type="text" value={item.notes} placeholder="Note…"
            onChange={e => onChange(idx, { notes: e.target.value })}
            className="mt-0.5 w-full text-[11px] text-slate-400 placeholder-slate-300 bg-transparent focus:outline-none border-b border-transparent focus:border-slate-200" />
        )}
      </div>
      <input type="number" min={1} value={item.quantity}
        onChange={e => onChange(idx, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
        className="w-full text-[12px] text-slate-700 text-right bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400/30 tabular-nums" />
      <input type="number" min={0} step={0.01} value={item.quotedRate} placeholder="—"
        onChange={e => onChange(idx, { quotedRate: e.target.value })}
        className="w-full text-[12px] text-slate-700 text-right bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400/30 tabular-nums" />
      <input type="number" min={0} step={0.01} value={item.mrp} placeholder="—"
        onChange={e => onChange(idx, { mrp: e.target.value })}
        className="w-full text-[12px] text-slate-700 text-right bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400/30 tabular-nums" />
      <input type="number" min={0} max={100} step={0.5} value={item.discount}
        onChange={e => onChange(idx, { discount: parseFloat(e.target.value) || 0 })}
        className="w-full text-[12px] text-slate-700 text-right bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400/30 tabular-nums" />
      <p className={cn("text-[12px] font-bold text-right tabular-nums", eff ? "text-emerald-700" : "text-slate-300")}>
        {eff ? `₹${fmt(eff)}` : "—"}
      </p>
      <button onClick={() => onRemove(idx)} className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Create / Edit Drawer ─────────────────────────────────────────
function QuotationFormDrawer({ suppliers, editing, onClose, onSaved }: {
  suppliers:  Supplier[];
  editing:    Quotation | null;
  onClose:    () => void;
  onSaved:    () => void;
}) {
  const [supplierId,   setSupplierId]   = useState(editing?.supplier.id ?? "");
  const [validUntil,   setValidUntil]   = useState(editing?.validUntil ? editing.validUntil.slice(0, 10) : "");
  const [notes,        setNotes]        = useState(editing?.notes ?? "");
  const [items,        setItems]        = useState<ItemDraft[]>(
    editing?.items?.map(i => ({
      medicineId: i.medicineId, medicineName: i.medicineName,
      quantity: i.quantity, quotedRate: String(i.quotedRate ?? ""),
      mrp: String(i.mrp ?? ""), gstRate: i.gstRate, discount: i.discount, notes: i.notes ?? "",
    })) ?? []
  );
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [suppSearch, setSuppSearch] = useState(
    editing ? editing.supplier.name : ""
  );
  const [suppOpen,   setSuppOpen]   = useState(false);
  const suppRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (suppRef.current && !suppRef.current.contains(e.target as Node)) setSuppOpen(false);
    };
    document.addEventListener("mousedown", h, { passive: true });
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filteredSuppliers = suppSearch.trim().length > 0
    ? suppliers.filter(s => s.name.toLowerCase().includes(suppSearch.toLowerCase()))
    : suppliers;

  function addMedicine(m: MedicineResult) {
    if (items.some(i => i.medicineId === m.id)) return;
    setItems(prev => [...prev, {
      medicineId: m.id, medicineName: m.name, quantity: 1,
      quotedRate: "", mrp: "", gstRate: 12, discount: 0, notes: "",
    }]);
  }

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    if (!supplierId) { setError("Select a supplier"); return; }
    if (items.length === 0) { setError("Add at least one medicine"); return; }
    setSaving(true); setError(null);
    try {
      const body = {
        supplierId,
        validUntil: validUntil ? new Date(validUntil + "T23:59:59+05:30").toISOString() : undefined,
        notes: notes || undefined,
        items: items.map(i => ({
          medicineId:   i.medicineId,
          medicineName: i.medicineName,
          quantity:     i.quantity,
          quotedRate:   parseFloat(i.quotedRate) || undefined,
          mrp:          parseFloat(i.mrp) || undefined,
          gstRate:      i.gstRate,
          discount:     i.discount,
          notes:        i.notes || undefined,
        })),
      };
      if (editing) {
        await api.patch(`/quotations/${editing.id}`, body);
      } else {
        await api.post("/quotations", body);
      }
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to save");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-black text-slate-800">{editing ? `Edit ${editing.quotationNumber}` : "New Quotation"}</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Request prices from a supplier</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Supplier + meta */}
          <div className="grid grid-cols-2 gap-4 px-6 py-4 border-b border-slate-100">
            {/* Supplier */}
            <div ref={suppRef} className="relative col-span-2 md:col-span-1">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Supplier *</label>
              <div className="relative">
                <input
                  type="text"
                  value={suppSearch}
                  onChange={e => { setSuppSearch(e.target.value); setSuppOpen(true); }}
                  onFocus={() => setSuppOpen(true)}
                  placeholder="Search supplier…"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400"
                />
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
              {suppOpen && filteredSuppliers.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                  {filteredSuppliers.map(s => (
                    <button key={s.id} onClick={() => { setSupplierId(s.id); setSuppSearch(s.name); setSuppOpen(false); }}
                      className={cn("w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0",
                        supplierId === s.id && "bg-blue-50")}>
                      <p className="text-[13px] font-semibold text-slate-800">{s.name}</p>
                      {s.phone && <p className="text-[11px] text-slate-400">{s.phone}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Valid Until */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Valid Until</label>
              <input type="date" value={validUntil} min={toInputDate(new Date())}
                onChange={e => setValidUntil(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
            </div>

            {/* Notes */}
            <div className="col-span-2">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Any special instructions for the supplier…"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 resize-none" />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 bg-slate-50/40">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Medicines ({items.length})</p>
            </div>

            {/* Add medicine search */}
            <div className="px-4 py-3 border-b border-slate-100">
              <MedicineSearch onSelect={addMedicine} />
            </div>

            {/* Table header */}
            {items.length > 0 && (
              <div className="grid grid-cols-[2fr_0.7fr_0.9fr_0.9fr_0.7fr_0.7fr_36px] gap-2 px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                <span>Medicine</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Rate (₹)</span>
                <span className="text-right">MRP (₹)</span>
                <span className="text-right">Disc %</span>
                <span className="text-right">Eff. Rate</span>
                <span />
              </div>
            )}

            {items.map((item, i) => (
              <ItemRow key={item.medicineId} idx={i} item={item} onChange={updateItem} onRemove={removeItem} />
            ))}

            {items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-slate-300">
                <Package2 className="w-8 h-8 mb-2" strokeWidth={1.2} />
                <p className="text-[12px]">Search above to add medicines</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-200 bg-white">
          {error && (
            <p className="text-[12px] text-red-600 mb-3 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </p>
          )}
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-400">{items.length} medicine{items.length !== 1 ? "s" : ""} · {supplierId ? suppliers.find(s => s.id === supplierId)?.name : "No supplier"}</p>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving || items.length === 0 || !supplierId}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[13px] font-bold transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {editing ? "Save Changes" : "Create Quotation"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────
function QuotationDetailDrawer({ q, onClose, onAction, onEdit }: {
  q:        Quotation;
  onClose:  () => void;
  onAction: (action: "send" | "receive" | "expire" | "convert") => void;
  onEdit:   () => void;
}) {
  const [converting, setConverting]     = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const toast = useToast();

  const total = (q.items ?? []).reduce((s, i) => {
    const rate = i.quotedRate != null ? effectiveRate(i.quotedRate, i.discount) : 0;
    return s + rate * i.quantity;
  }, 0);

  // Both of these are WRITES. They previously swallowed failures entirely (the
  // `/* toast */` below was a note for a toast that was never wired), so a failed
  // status change or PO conversion looked identical to a successful one: the
  // spinner stopped and nothing else happened. The user's natural response is to
  // click again, which is exactly how duplicates get created.
  async function doAction(action: "send" | "receive" | "expire") {
    setActionLoading(action);
    try {
      await api.patch(`/quotations/${q.id}/${action}`);
      onAction(action);
    } catch (e) {
      toast.error(getErrorMessage(e, `Could not ${action} this quotation. Please try again.`));
    } finally {
      setActionLoading(null);
    }
  }

  async function convertToPO() {
    setConverting(true);
    try {
      await api.post(`/quotations/${q.id}/convert-to-po`, {});
      onAction("convert");
    } catch (e) {
      toast.error(getErrorMessage(e, "Could not convert this quotation to a purchase order. Please try again."));
    } finally {
      setConverting(false);
    }
  }

  const canEdit    = ["DRAFT", "SENT"].includes(q.status);
  const canSend    = q.status === "DRAFT";
  const canReceive = q.status === "SENT";
  const canExpire  = ["DRAFT", "SENT", "RECEIVED"].includes(q.status);
  const canConvert = q.status === "RECEIVED" && (q.items ?? []).every(i => i.quotedRate != null && i.quotedRate > 0);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl bg-white h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-[15px] font-black text-slate-800">{q.quotationNumber}</h2>
              <StatusBadge status={q.status} />
            </div>
            <p className="text-[12px] text-slate-400">{q.supplier.name} · Created {fmtDate(q.createdAt)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Meta */}
        {(q.validUntil || q.notes) && (
          <div className="flex flex-wrap gap-3 px-6 py-3 border-b border-slate-100 bg-slate-50/40 text-[12px] text-slate-500">
            {q.validUntil && <span>Valid until <strong className="text-slate-700">{fmtDate(q.validUntil)}</strong></span>}
            {q.notes && <span>{q.notes}</span>}
          </div>
        )}

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-[2fr_0.6fr_0.8fr_0.8fr_0.6fr_0.8fr] gap-2 px-6 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 bg-slate-50/40">
            <span>Medicine</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Rate</span>
            <span className="text-right">MRP</span>
            <span className="text-right">Disc</span>
            <span className="text-right">Eff. Rate</span>
          </div>
          <div className="divide-y divide-slate-50">
            {(q.items ?? []).map(item => {
              const eff = item.quotedRate != null ? effectiveRate(item.quotedRate, item.discount) : null;
              return (
                <div key={item.id} className="grid grid-cols-[2fr_0.6fr_0.8fr_0.8fr_0.6fr_0.8fr] gap-2 items-center px-6 py-3 hover:bg-slate-50/50">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{item.medicineName}</p>
                    {item.medicine?.genericName && <p className="text-[10px] text-slate-400">{item.medicine.genericName}</p>}
                    {item.notes && <p className="text-[10px] text-slate-400 italic">{item.notes}</p>}
                  </div>
                  <p className="text-[12px] text-slate-700 text-right tabular-nums">{item.quantity}</p>
                  <p className="text-[12px] text-slate-700 text-right tabular-nums">{item.quotedRate != null ? `₹${fmt(item.quotedRate)}` : "—"}</p>
                  <p className="text-[12px] text-slate-700 text-right tabular-nums">{item.mrp != null ? `₹${fmt(item.mrp)}` : "—"}</p>
                  <p className="text-[12px] text-slate-500 text-right tabular-nums">{item.discount > 0 ? `${item.discount}%` : "—"}</p>
                  <p className={cn("text-[12px] font-bold text-right tabular-nums", eff ? "text-emerald-700" : "text-slate-300")}>
                    {eff ? `₹${fmt(eff)}` : "—"}
                  </p>
                </div>
              );
            })}
          </div>

          {total > 0 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/40">
              <span className="text-[12px] font-bold text-slate-500">Estimated Total (before GST)</span>
              <span className="text-[14px] font-black text-slate-800 tabular-nums">₹{fmt(total)}</span>
            </div>
          )}

          {!canConvert && q.status === "RECEIVED" && (
            <div className="px-6 py-3 bg-amber-50 border-t border-amber-100">
              <p className="text-[11px] text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Some items have no quoted rate. Fill all rates before converting to PO.
              </p>
            </div>
          )}
        </div>

        {/* Actions footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-200 bg-white space-y-2">
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <button onClick={onEdit}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                <FileText className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {canSend && (
              <button onClick={() => doAction("send")} disabled={actionLoading === "send"}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[12px] font-bold transition-colors">
                {actionLoading === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Mark Sent to Supplier
              </button>
            )}
            {canReceive && (
              <button onClick={() => doAction("receive")} disabled={actionLoading === "receive"}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-[12px] font-bold transition-colors">
                {actionLoading === "receive" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Mark Quote Received
              </button>
            )}
            {canConvert && (
              <button onClick={convertToPO} disabled={converting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-[12px] font-bold transition-colors">
                {converting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                Convert to Purchase Order
              </button>
            )}
            {canExpire && (
              <button onClick={() => doAction("expire")} disabled={actionLoading === "expire"}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 text-[12px] font-semibold text-red-600 hover:bg-red-50 transition-colors">
                {actionLoading === "expire" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Mark Expired
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Compare Modal ────────────────────────────────────────────────
function CompareModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [data, setData]     = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.post<{ success: boolean; data: any }>("/quotations/compare", { quotationIds: ids })
      .then(r => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ids]);

  function exportCsv() {
    if (!data) return;
    const supplierHeaders = data.quotations.map((q: any) => q.supplier.name);
    const rows = [
      ["Medicine", ...supplierHeaders],
      ...data.comparison.map((entry: any) => [
        entry.medicineName,
        ...data.quotations.map((q: any) => {
          const quote = entry.quotes.find((qq: any) => qq.quotationId === q.id);
          if (!quote) return "—";
          const line = quote.effectiveRate != null ? `₹${fmt(quote.effectiveRate)}` : "No rate";
          return quote.isBestPrice ? `${line} ★` : line;
        }),
      ]),
    ];
    // Shared serialiser. This export is the one that suffered most from the old hand-rolled
    // version: every cell carries ₹, ★ or an em dash, and without a byte order mark Excel
    // rendered all three as mojibake.
    downloadCsv("quote-comparison.csv", rows);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-blue-600" strokeWidth={1.8} />
            <h2 className="text-[15px] font-black text-slate-800">Price Comparison</h2>
            <span className="text-[11px] text-slate-400">{ids.length} quotations</span>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <button onClick={exportCsv} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors">
                <Download className="w-3 h-3" /> CSV
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-blue-400" /></div>
          ) : !data ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-[13px]">Failed to load comparison</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-6 py-3 font-bold text-slate-500 text-[11px] uppercase tracking-wide w-48">Medicine</th>
                  {data.quotations.map((q: any) => (
                    <th key={q.id} className="px-4 py-3 text-center font-bold text-slate-700 min-w-[120px]">
                      <p className="text-[12px]">{q.supplier.name}</p>
                      <p className="text-[10px] font-normal text-slate-400">{q.quotationNumber}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.comparison.map((entry: any) => (
                  <tr key={entry.medicineId} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-6 py-3 font-semibold text-slate-800">{entry.medicineName}</td>
                    {data.quotations.map((q: any) => {
                      const quote = entry.quotes.find((qq: any) => qq.quotationId === q.id);
                      if (!quote) return <td key={q.id} className="px-4 py-3 text-center text-slate-300">—</td>;
                      return (
                        <td key={q.id} className={cn("px-4 py-3 text-center", quote.isBestPrice && "bg-emerald-50/60")}>
                          {quote.effectiveRate != null ? (
                            <div>
                              <p className={cn("font-bold tabular-nums", quote.isBestPrice ? "text-emerald-700" : "text-slate-700")}>
                                ₹{fmt(quote.effectiveRate)}
                                {quote.isBestPrice && <span className="ml-1 text-[9px] bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded font-black">BEST</span>}
                              </p>
                              <p className="text-[10px] text-slate-400">×{quote.quantity} · {quote.discount > 0 ? `-${quote.discount}%` : "no disc"}</p>
                            </div>
                          ) : (
                            <p className="text-slate-300">No rate</p>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────
const STATUS_TABS: { id: QStatus | "ALL"; label: string }[] = [
  { id: "ALL",       label: "All"       },
  { id: "DRAFT",     label: "Draft"     },
  { id: "SENT",      label: "Sent"      },
  { id: "RECEIVED",  label: "Received"  },
  { id: "CONVERTED", label: "Converted" },
  { id: "EXPIRED",   label: "Expired"   },
];

export default function QuotationsPage() {
  const [quotations,    setQuotations]    = useState<Quotation[]>([]);
  const [total,         setTotal]         = useState(0);
  const [page,          setPage]          = useState(1);
  const [loading,       setLoading]       = useState(true);
  const [loadError,     setLoadError]     = useState(false);
  const [statusFilter,  setStatusFilter]  = useState<QStatus | "ALL">("ALL");
  const [suppliers,     setSuppliers]     = useState<Supplier[]>([]);
  const [showCreate,    setShowCreate]    = useState(false);
  const [editing,       setEditing]       = useState<Quotation | null>(null);
  const [detail,        setDetail]        = useState<Quotation | null>(null);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [showCompare,   setShowCompare]   = useState(false);

  const LIMIT = 20;

  const load = useCallback(async (pg = 1, status: QStatus | "ALL" = statusFilter) => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(LIMIT) });
      if (status !== "ALL") params.set("status", status);
      const r = await api.get<{ success: boolean; data: { items: Quotation[]; total: number } }>(
        `/quotations?${params}`
      );
      setQuotations(r.data.data.items);
      setTotal(r.data.data.total);
      setPage(pg);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(1, statusFilter); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get<{ success: boolean; data: Supplier[] }>("/suppliers/all")
      .then(r => setSuppliers(r.data.data ?? []))
      .catch(() => {});
  }, []);

  async function openDetail(q: Quotation) {
    try {
      const r = await api.get<{ success: boolean; data: Quotation }>(`/quotations/${q.id}`);
      setDetail(r.data.data);
    } catch { /* drawer stays closed; list row click silently fails */ }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const totalPages = Math.ceil(total / LIMIT);

  const receivedIds = quotations.filter(q => q.status === "RECEIVED").map(q => q.id);
  const compareEligible = selected.size >= 2 && [...selected].every(id =>
    quotations.find(q => q.id === id)?.status === "RECEIVED"
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-50/50">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-black text-slate-800">Quotations</h1>
            <p className="text-[12px] text-slate-400 mt-0.5 font-medium">Request and compare supplier prices before ordering</p>
          </div>
          <div className="flex items-center gap-2">
            {selected.size >= 2 && compareEligible && (
              <button onClick={() => setShowCompare(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-[12px] font-bold hover:bg-blue-100 transition-colors">
                <GitCompare className="w-3.5 h-3.5" />
                Compare ({selected.size})
              </button>
            )}
            <button onClick={() => { setEditing(null); setShowCreate(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-bold transition-colors shadow-sm">
              <Plus className="w-4 h-4" /> New Quotation
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-2xl p-1 w-fit shadow-sm overflow-x-auto no-scrollbar">
          {STATUS_TABS.map(tab => (
            <button key={tab.id} onClick={() => { setStatusFilter(tab.id); setSelected(new Set()); }}
              className={cn(
                "px-4 py-2 rounded-xl text-[12px] font-semibold transition-all whitespace-nowrap",
                statusFilter === tab.id ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              )}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Compare hint */}
        {statusFilter === "RECEIVED" && receivedIds.length >= 2 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-xl text-[12px] text-blue-700">
            <GitCompare className="w-3.5 h-3.5 flex-shrink-0" />
            Select two or more RECEIVED quotations to compare prices side-by-side.
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[40px_1fr_1fr_0.6fr_0.8fr_1fr_120px] gap-4 px-5 py-3 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide bg-slate-50/60">
            <span />
            <span>Quotation</span>
            <span>Supplier</span>
            <span className="text-center">Items</span>
            <span>Valid Until</span>
            <span>Created</span>
            <span>Status</span>
          </div>

          {loading ? (
            <GridSkeletonRows gridClass="grid-cols-[40px_1fr_1fr_0.6fr_0.8fr_1fr_120px]" columns={7} rows={6} />
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <AlertTriangle className="w-8 h-8 text-red-300 mb-3" />
              <p className="text-[14px] font-semibold text-slate-600">Failed to load quotations</p>
              <button onClick={() => load(page)} className="mt-3 text-[12px] text-blue-600 hover:underline font-medium">Retry</button>
            </div>
          ) : quotations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <FileText className="w-10 h-10 text-slate-200 mb-3" strokeWidth={1.2} />
              <p className="text-[14px] font-semibold">No quotations yet</p>
              <p className="text-[12px] mt-1">Create one to start requesting prices from suppliers</p>
              <button onClick={() => { setEditing(null); setShowCreate(true); }}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-colors">
                <Plus className="w-4 h-4" /> New Quotation
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {quotations.map(q => {
                const isSelected = selected.has(q.id);
                return (
                  <div key={q.id}
                    className={cn("grid grid-cols-[40px_1fr_1fr_0.6fr_0.8fr_1fr_120px] gap-4 items-center px-5 py-3.5 hover:bg-slate-50/50 transition-colors cursor-pointer",
                      isSelected && "bg-blue-50/40")}
                    onClick={() => openDetail(q)}>
                    {/* Checkbox — only for RECEIVED for comparison */}
                    <div onClick={e => e.stopPropagation()}>
                      {q.status === "RECEIVED" ? (
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(q.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400/30 cursor-pointer" />
                      ) : (
                        <span />
                      )}
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-slate-800">{q.quotationNumber}</p>
                    </div>
                    <p className="text-[13px] text-slate-600 font-medium truncate">{q.supplier.name}</p>
                    <p className="text-[13px] text-slate-500 text-center tabular-nums">{q._count?.items ?? 0}</p>
                    <p className="text-[12px] text-slate-500">{q.validUntil ? fmtDate(q.validUntil) : "—"}</p>
                    <p className="text-[12px] text-slate-400">{fmtDate(q.createdAt)}</p>
                    <div className="flex items-center justify-between">
                      <StatusBadge status={q.status} />
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/40">
              <p className="text-[11px] text-slate-400">{total} quotations</p>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => load(page - 1)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40 hover:bg-slate-100 transition-colors text-slate-600">
                  ← Prev
                </button>
                <span className="text-[11px] text-slate-400 px-2">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => load(page + 1)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40 hover:bg-slate-100 transition-colors text-slate-600">
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Flow guide — visible when empty / new users */}
        {!loading && quotations.length < 3 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-3">How quotations work</p>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { icon: FileText,    label: "Create",  desc: "List medicines + quantities",  color: "bg-slate-100 text-slate-600"  },
                { icon: Send,        label: "Send",    desc: "Share with supplier",           color: "bg-blue-50 text-blue-600"    },
                { icon: Clock,       label: "Receive", desc: "Supplier fills in prices",      color: "bg-emerald-50 text-emerald-600"},
                { icon: GitCompare,  label: "Compare", desc: "Compare across suppliers",      color: "bg-violet-50 text-violet-600" },
                { icon: ShoppingCart,label: "Order",   desc: "Convert best quote to PO",      color: "bg-amber-50 text-amber-600"  },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className={cn("flex items-center gap-2 px-3 py-2 rounded-xl", step.color)}>
                    <step.icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                    <div>
                      <p className="text-[12px] font-bold leading-tight">{step.label}</p>
                      <p className="text-[10px] opacity-70">{step.desc}</p>
                    </div>
                  </div>
                  {i < 4 && <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Drawers & modals */}
      {(showCreate || editing) && (
        <QuotationFormDrawer
          suppliers={suppliers}
          editing={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); load(1); }}
        />
      )}

      {detail && (
        <QuotationDetailDrawer
          q={detail}
          onClose={() => setDetail(null)}
          onAction={() => { setDetail(null); load(page); }}
          onEdit={() => { setEditing(detail); setDetail(null); setShowCreate(true); }}
        />
      )}

      {showCompare && selected.size >= 2 && (
        <CompareModal ids={[...selected]} onClose={() => setShowCompare(false)} />
      )}
    </div>
  );
}
