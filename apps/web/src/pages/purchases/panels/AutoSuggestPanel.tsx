import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Loader2, CheckCircle2, ShoppingCart, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

// ─── Slide-in Panel Shell ─────────────────────────────────────────────────────

export function SlidePanel({ title, subtitle, onClose, children, width = "w-[480px]" }: {
  title: string; subtitle?: string; onClose: () => void;
  children: React.ReactNode; width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className={cn("relative bg-white shadow-2xl flex flex-col h-full overflow-hidden", width)}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </motion.div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Suggestion {
  medicineId: string;
  medicineName: string;
  currentStock: number;
  avgDailySales: number;
  daysOfStock: number;
  suggestedQuantity: number;
  minimumStock: number;
  lastPurchaseRate: number;
  lastMrp: number;
  lastGstRate: number;
}

interface Supplier { id: string; name: string; }

// ─── Panel: Auto Purchase Suggestions ────────────────────────────────────────

export function AutoSuggestPanel({ onClose }: { onClose: () => void }) {
  const [items,     setItems]     = useState<Suggestion[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [days,      setDays]      = useState(30);
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [creating,  setCreating]  = useState(false);
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    setSelected(new Set());
    api.get<{ data: Suggestion[] }>("/purchases/suggestions", { params: { daysThreshold: days } })
      .then(({ data }) => setItems(data.data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    api.get<{ data: Supplier[] }>("/suppliers?limit=200&isActive=true")
      .then(({ data }) => setSuppliers(data.data ?? []))
      .catch(() => {});
  }, []);

  function toggleAll() {
    if (selected.size === items.length) { setSelected(new Set()); }
    else { setSelected(new Set(items.map(i => i.medicineId))); }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function generatePO() {
    if (!supplierId)       { toast.error("Select a supplier first"); return; }
    if (selected.size === 0) { toast.error("Select at least one item"); return; }

    const selectedItems = items.filter(i => selected.has(i.medicineId));
    const hasNoPricing  = selectedItems.some(i => i.lastPurchaseRate === 0 || i.lastMrp === 0);
    if (hasNoPricing) {
      toast.error("Some items have no prior purchase rate. Set rates before generating PO.");
      return;
    }

    setCreating(true);
    try {
      const payload = {
        supplierId,
        items: selectedItems.map(i => ({
          medicineId:   i.medicineId,
          medicineName: i.medicineName,
          quantity:     i.suggestedQuantity,
          purchaseRate: i.lastPurchaseRate,
          mrp:          i.lastMrp,
          gstRate:      i.lastGstRate,
        })),
      };
      const res = await api.post<{ success: boolean; data: { orderNumber: string } }>("/purchases/orders/from-reorder", payload);
      toast.success(`Draft PO ${res.data.data.orderNumber} created`);
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Failed to create PO");
    } finally { setCreating(false); }
  }

  return (
    <SlidePanel title="Auto Purchase Suggestions" subtitle="Medicines running low — select items to generate a draft PO" onClose={onClose}>
      <div className="flex flex-col h-full">
        {/* Controls */}
        <div className="px-5 py-3 border-b border-slate-100 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-slate-500">Show items that will run out in</span>
            <select value={days} onChange={(e) => setDays(+e.target.value)}
              className="border border-slate-200 rounded-md h-7 px-2 text-[12px] bg-white focus:outline-none">
              <option value={15}>15 days</option>
              <option value={30}>30 days</option>
              <option value={45}>45 days</option>
              <option value={60}>60 days</option>
            </select>
          </div>
          {!loading && items.length > 0 && (
            <button onClick={toggleAll} className="text-[11px] text-blue-600 font-semibold hover:underline">
              {selected.size === items.length ? "Deselect all" : `Select all ${items.length}`}
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-300 mb-3" />
              <p className="text-[14px] font-semibold text-slate-700">All stocked up!</p>
              <p className="text-[12px] text-slate-400">No medicines are below the {days}-day threshold.</p>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{items.length} items need reorder</p>
              {items.map((item) => (
                <div
                  key={item.medicineId}
                  onClick={() => toggle(item.medicineId)}
                  className={cn(
                    "border rounded-xl p-3.5 transition-colors cursor-pointer select-none",
                    selected.has(item.medicineId)
                      ? "border-blue-400 bg-blue-50/60 ring-1 ring-blue-200"
                      : item.daysOfStock < 7  ? "border-red-200 bg-red-50/40 hover:border-red-300"
                      : item.daysOfStock < 14 ? "border-amber-200 bg-amber-50/30 hover:border-amber-300"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      <input type="checkbox" readOnly checked={selected.has(item.medicineId)}
                        className="mt-0.5 w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-slate-800 truncate">{item.medicineName}</p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-[11px] text-slate-500">Stock: <span className="font-semibold text-slate-700">{item.currentStock}</span></span>
                          <span className="text-[11px] text-slate-500">Avg/day: <span className="font-semibold text-slate-700">{item.avgDailySales}</span></span>
                          <span className={cn("text-[11px] font-bold",
                            item.daysOfStock < 7 ? "text-red-600" : item.daysOfStock < 14 ? "text-amber-600" : "text-slate-600")}>
                            ~{item.daysOfStock}d left
                          </span>
                        </div>
                        {item.lastPurchaseRate > 0 ? (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Last rate: ₹{item.lastPurchaseRate} · MRP: ₹{item.lastMrp} · GST: {item.lastGstRate}%
                          </p>
                        ) : (
                          <p className="text-[10px] text-amber-600 font-semibold mt-0.5 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> No prior purchase rate
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] text-slate-400">Order qty</p>
                      <p className="text-[15px] font-black text-blue-600">{item.suggestedQuantity}</p>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer — only show when items are present */}
        {!loading && items.length > 0 && (
          <div className="px-5 py-4 border-t border-slate-100 space-y-3 bg-white flex-shrink-0">
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 bg-white">
              <option value="">Select supplier for PO…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              onClick={generatePO}
              disabled={creating || selected.size === 0 || !supplierId}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[13px] font-bold transition-colors"
            >
              {creating
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ShoppingCart className="w-4 h-4" />}
              Generate Draft PO ({selected.size} item{selected.size !== 1 ? "s" : ""})
            </button>
          </div>
        )}
      </div>
    </SlidePanel>
  );
}
