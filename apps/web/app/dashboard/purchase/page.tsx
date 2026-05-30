"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart,
  Plus,
  Search,
  Eye,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  Package2,
  Calendar,
  IndianRupee,
  X,
  Trash2,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────
type POStatus = "PENDING" | "ORDERED" | "RECEIVED" | "CANCELLED";

interface PurchaseOrderItem {
  quantity: number;
  amount: number;
}

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  invoiceNo?: string;
  status: POStatus;
  totalAmount: number;
  totalGst: number;
  subtotal: number;
  createdAt: string;
  receivedAt?: string;
  supplier: { name: string };
  items: PurchaseOrderItem[];
  notes?: string;
}

interface POListResponse {
  items: PurchaseOrder[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}

interface Supplier {
  id: string;
  name: string;
  phone?: string;
}

interface MedicineHit {
  id: string;
  name: string;
  genericName?: string;
  gstRate: number;
}

// ─── Status config ────────────────────────────────────────────
const STATUS_CONFIG: Record<POStatus, { label: string; color: string; icon: React.ElementType }> = {
  PENDING:   { label: "Pending",   color: "bg-amber-100 text-amber-700",   icon: Clock        },
  ORDERED:   { label: "Ordered",   color: "bg-blue-100 text-blue-700",     icon: Truck        },
  RECEIVED:  { label: "Received",  color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "bg-red-100 text-red-600",       icon: XCircle      },
};

const FILTER_OPTIONS: { label: string; value: POStatus | "all" }[] = [
  { label: "All",       value: "all"       },
  { label: "Pending",   value: "PENDING"   },
  { label: "Ordered",   value: "ORDERED"   },
  { label: "Received",  value: "RECEIVED"  },
  { label: "Cancelled", value: "CANCELLED" },
];

const PAGE_SIZE = 20;

// ─── Order detail modal ───────────────────────────────────────
function OrderDetailModal({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const { label, color, icon: StatusIcon } = STATUS_CONFIG[order.status];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-black text-slate-800">{order.orderNumber}</p>
            <p className="text-xs text-slate-400">{order.supplier.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full", color)}>
              <StatusIcon className="w-3 h-3" strokeWidth={2} />
              {label}
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400 font-semibold mb-0.5">Invoice No</p>
              <p className="font-semibold text-slate-700">{order.invoiceNo ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold mb-0.5">Date</p>
              <p className="font-semibold text-slate-700">
                {new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold mb-0.5">Items</p>
              <p className="font-semibold text-slate-700">{order.items.length} lines</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-semibold mb-0.5">Total Items Qty</p>
              <p className="font-semibold text-slate-700">{order.items.reduce((s, i) => s + i.quantity, 0)}</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>₹{order.subtotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>GST</span>
              <span>₹{order.totalGst.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between font-black text-slate-800 pt-1 border-t border-slate-200">
              <span>Total</span>
              <span>₹{order.totalAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
          </div>
          {order.notes && (
            <p className="text-xs text-slate-500 italic">{order.notes}</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── New Purchase Order Modal ─────────────────────────────────
interface LineItem {
  medicineId: string;
  medicineName: string;
  gstRate: number;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  purchaseRate: string;
  mrp: string;
}

function emptyLine(): LineItem {
  return { medicineId: "", medicineName: "", gstRate: 12, batchNumber: "", expiryDate: "", quantity: "", purchaseRate: "", mrp: "" };
}

function NewOrderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [supplierId, setSupplierId]   = useState("");
  const [orderNumber, setOrderNumber] = useState(`PO-${Date.now().toString().slice(-6)}`);
  const [invoiceNo, setInvoiceNo]     = useState("");
  const [notes, setNotes]             = useState("");
  const [lines, setLines]             = useState<LineItem[]>([emptyLine()]);
  const [suppliers, setSuppliers]     = useState<Supplier[]>([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Medicine search state per line
  const [medQuery, setMedQuery]       = useState<Record<number, string>>({});
  const [medHits, setMedHits]         = useState<Record<number, MedicineHit[]>>({});
  const [medOpen, setMedOpen]         = useState<Record<number, boolean>>({});
  const debounceRef                   = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    api.get<{ success: boolean; data: { items: Supplier[] } }>("/suppliers?limit=100")
      .then(r => setSuppliers(r.data.data.items))
      .catch(() => {});
  }, []);

  function searchMedicine(idx: number, q: string) {
    setMedQuery(prev => ({ ...prev, [idx]: q }));
    if (debounceRef.current[idx]) clearTimeout(debounceRef.current[idx]);
    if (!q.trim()) { setMedHits(prev => ({ ...prev, [idx]: [] })); setMedOpen(prev => ({ ...prev, [idx]: false })); return; }
    debounceRef.current[idx] = setTimeout(async () => {
      try {
        const res = await api.get<{ success: boolean; data: MedicineHit[] }>(`/medicines/search?q=${encodeURIComponent(q)}&limit=8`);
        setMedHits(prev => ({ ...prev, [idx]: res.data.data }));
        setMedOpen(prev => ({ ...prev, [idx]: true }));
      } catch { /* ignore */ }
    }, 250);
  }

  function pickMedicine(idx: number, hit: MedicineHit) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, medicineId: hit.id, medicineName: hit.name, gstRate: hit.gstRate } : l));
    setMedQuery(prev => ({ ...prev, [idx]: hit.name }));
    setMedOpen(prev => ({ ...prev, [idx]: false }));
  }

  function setLineField<K extends keyof LineItem>(idx: number, field: K, value: LineItem[K]) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  function addLine() { setLines(prev => [...prev, emptyLine()]); }
  function removeLine(idx: number) { setLines(prev => prev.filter((_, i) => i !== idx)); }

  const lineTotal = (l: LineItem) => {
    const qty = parseFloat(l.quantity) || 0;
    const rate = parseFloat(l.purchaseRate) || 0;
    const base = qty * rate;
    const gst = base * l.gstRate / 100;
    return base + gst;
  };

  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supplierId) { setError("Select a supplier"); return; }
    if (!orderNumber.trim()) { setError("Order number is required"); return; }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.medicineId) { setError(`Line ${i + 1}: select a medicine`); return; }
      if (!l.batchNumber.trim()) { setError(`Line ${i + 1}: batch number required`); return; }
      if (!l.expiryDate) { setError(`Line ${i + 1}: expiry date required`); return; }
      if (!l.quantity || parseFloat(l.quantity) <= 0) { setError(`Line ${i + 1}: valid quantity required`); return; }
      if (!l.purchaseRate || parseFloat(l.purchaseRate) <= 0) { setError(`Line ${i + 1}: valid purchase rate required`); return; }
      if (!l.mrp || parseFloat(l.mrp) <= 0) { setError(`Line ${i + 1}: valid MRP required`); return; }
    }

    setSaving(true);
    try {
      await api.post("/suppliers/purchase-orders", {
        supplierId,
        orderNumber: orderNumber.trim(),
        invoiceNo: invoiceNo.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines.map(l => ({
          medicineId:   l.medicineId,
          medicineName: l.medicineName,
          batchNumber:  l.batchNumber.trim(),
          expiryDate:   `${l.expiryDate}T00:00:00Z`,
          quantity:     parseInt(l.quantity, 10),
          purchaseRate: parseFloat(l.purchaseRate),
          mrp:          parseFloat(l.mrp),
          gstRate:      l.gstRate,
        })),
      });
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Failed to create purchase order");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4 text-brand-600" strokeWidth={1.8} />
            </div>
            <h2 className="text-base font-black text-slate-800">New Purchase Order</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Supplier + Order # */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  Supplier <span className="text-red-500">*</span>
                </label>
                <select
                  value={supplierId}
                  onChange={e => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 bg-white"
                >
                  <option value="">Select supplier…</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  Order Number <span className="text-red-500">*</span>
                </label>
                <input
                  value={orderNumber}
                  onChange={e => setOrderNumber(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
                />
              </div>
            </div>

            {/* Invoice No + Notes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Invoice No</label>
                <input
                  value={invoiceNo}
                  onChange={e => setInvoiceNo(e.target.value)}
                  placeholder="Supplier invoice number"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Notes</label>
                <input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional notes"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
                />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Items</label>
                <button
                  type="button"
                  onClick={addLine}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Line
                </button>
              </div>

              <div className="space-y-3">
                {lines.map((line, idx) => (
                  <div key={idx} className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-2">
                    {/* Medicine search */}
                    <div className="relative">
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white">
                        <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <input
                          value={medQuery[idx] ?? ""}
                          onChange={e => searchMedicine(idx, e.target.value)}
                          onFocus={() => medHits[idx]?.length && setMedOpen(prev => ({ ...prev, [idx]: true }))}
                          placeholder="Search medicine…"
                          className="flex-1 text-sm text-slate-700 placeholder-slate-300 bg-transparent outline-none"
                        />
                      </div>
                      {medOpen[idx] && (medHits[idx]?.length ?? 0) > 0 && (
                        <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
                          {medHits[idx].map(hit => (
                            <button
                              key={hit.id}
                              type="button"
                              onMouseDown={() => pickMedicine(idx, hit)}
                              className="w-full flex items-center justify-between px-3 py-2 hover:bg-brand-50 transition-colors text-left"
                            >
                              <div>
                                <p className="text-sm font-semibold text-slate-800">{hit.name}</p>
                                {hit.genericName && <p className="text-xs text-slate-400">{hit.genericName}</p>}
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono">GST {hit.gstRate}%</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Batch + Expiry + Qty + Rate + MRP */}
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { label: "Batch #", key: "batchNumber" as const, placeholder: "BATCH001", type: "text" },
                        { label: "Expiry",  key: "expiryDate"  as const, placeholder: "",          type: "date" },
                        { label: "Qty",     key: "quantity"    as const, placeholder: "100",       type: "number" },
                        { label: "P.Rate",  key: "purchaseRate" as const, placeholder: "0.00",    type: "number" },
                        { label: "MRP",     key: "mrp"         as const, placeholder: "0.00",     type: "number" },
                      ].map(({ label, key, placeholder, type }) => (
                        <div key={key}>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
                          <input
                            type={type}
                            value={(line[key] as string) ?? ""}
                            onChange={e => setLineField(idx, key, e.target.value)}
                            placeholder={placeholder}
                            min={type === "number" ? "0" : undefined}
                            step={type === "number" && key !== "quantity" ? "0.01" : undefined}
                            className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Line total + remove */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        Line total: <span className="font-bold text-slate-700">₹{lineTotal(line).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                        <span className="text-slate-400 ml-1">(incl. GST {line.gstRate}%)</span>
                      </p>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="p-1 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex-shrink-0">
            <div>
              <p className="text-xs text-slate-400 font-semibold">Grand Total (incl. GST)</p>
              <p className="text-lg font-black text-slate-800">₹{grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-bold shadow-sm transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {saving ? "Saving…" : "Receive Order"}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function PurchasePage() {
  const [orders, setOrders]     = useState<PurchaseOrder[]>([]);
  const [total, setTotal]       = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState<POStatus | "all">("all");
  const [loading, setLoading]   = useState(true);
  const [showNew, setShowNew]   = useState(false);
  const [detailOrder, setDetailOrder] = useState<PurchaseOrder | null>(null);

  const load = useCallback(async (pg: number, status: POStatus | "all") => {
    setLoading(true);
    try {
      const statusParam = status !== "all" ? `&status=${status}` : "";
      const res = await api.get<{ success: boolean; data: POListResponse }>(
        `/suppliers/purchase-orders?page=${pg}&limit=${PAGE_SIZE}${statusParam}`
      );
      setOrders(res.data.data.items);
      setTotal(res.data.data.total);
      setTotalPages(res.data.data.totalPages);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page, filter); }, [page, filter, load]);

  const filtered = search
    ? orders.filter(o =>
        o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
        o.supplier.name.toLowerCase().includes(search.toLowerCase()) ||
        o.invoiceNo?.toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  const stats = {
    pending:  orders.filter(o => o.status === "PENDING").length,
    ordered:  orders.filter(o => o.status === "ORDERED").length,
    received: orders.filter(o => o.status === "RECEIVED").length,
    spend:    orders.filter(o => o.status !== "CANCELLED").reduce((a, o) => a + o.totalAmount, 0),
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800">Purchase Orders</h1>
            <p className="text-sm text-slate-400 mt-0.5">{total} order{total !== 1 ? "s" : ""} total</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white text-sm font-bold shadow-sm transition-all duration-75"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
            New Order
          </button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Pending",     value: stats.pending,  icon: Clock,        iconBg: "bg-amber-50",   iconColor: "text-amber-600"   },
            { label: "Ordered",     value: stats.ordered,  icon: Truck,        iconBg: "bg-blue-50",    iconColor: "text-blue-600"    },
            { label: "Received",    value: stats.received, icon: CheckCircle2, iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
            { label: "Total Spend", value: `₹${(stats.spend / 1000).toFixed(1)}k`, icon: IndianRupee, iconBg: "bg-brand-50", iconColor: "text-brand-600" },
          ].map(({ label, value, icon: Icon, iconBg, iconColor }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
                <Icon className={cn("w-4 h-4", iconColor)} strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-xl font-black text-slate-800">{value}</p>
                <p className="text-[11px] text-slate-500 font-semibold">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by PO number, supplier, or invoice…"
              className="flex-1 text-sm text-slate-700 placeholder-slate-300 bg-transparent outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-slate-300 hover:text-slate-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 flex-shrink-0">
            {FILTER_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => { setFilter(value); setPage(1); }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  filter === value
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-[1fr_1.6fr_80px_110px_110px_60px] gap-4 px-5 py-3 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
            <span>PO Number</span>
            <span>Supplier</span>
            <span>Items</span>
            <span>Amount</span>
            <span>Status</span>
            <span></span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-300">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <ShoppingCart className="w-10 h-10 mb-3 opacity-30" strokeWidth={1.4} />
              <p className="text-sm font-semibold">No orders found</p>
              {total === 0 && <p className="text-xs text-slate-300 mt-1">Create your first purchase order</p>}
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {filtered.map((po) => {
                const { label, color, icon: StatusIcon } = STATUS_CONFIG[po.status];
                const itemCount = po.items.reduce((s, it) => s + it.quantity, 0);
                return (
                  <div
                    key={po.id}
                    className="grid grid-cols-[1fr_1.6fr_80px_110px_110px_60px] gap-4 items-center px-5 py-3.5 hover:bg-slate-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                        <Package2 className="w-3.5 h-3.5 text-brand-600" strokeWidth={1.8} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{po.orderNumber}</p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(po.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          {po.invoiceNo && ` · ${po.invoiceNo}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <p className="text-sm font-medium text-slate-700 truncate">{po.supplier.name}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-700">{po.items.length} <span className="text-[10px] text-slate-400 font-normal">lines</span></p>
                      <p className="text-[10px] text-slate-400">{itemCount} units</p>
                    </div>
                    <p className="text-sm font-bold text-slate-800">₹{po.totalAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
                    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full w-fit", color)}>
                      <StatusIcon className="w-3 h-3" strokeWidth={2} />
                      {label}
                    </span>
                    <button
                      onClick={() => setDetailOrder(po)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      title="View details"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/50">
              <p className="text-xs text-slate-400">Page {page} of {totalPages} · {total} orders</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-white transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-white transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showNew && (
          <NewOrderModal
            onClose={() => setShowNew(false)}
            onSaved={() => { setShowNew(false); load(1, filter); setPage(1); }}
          />
        )}
        {detailOrder && (
          <OrderDetailModal order={detailOrder} onClose={() => setDetailOrder(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
