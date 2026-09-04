/**
 * Internal modal primitives — ModalShell, ErrorBanner, FieldLabel, FInput,
 * SmartAddBar, SmartReorderPanel, InventoryBatchPicker.
 * Not exported from the module barrel — imported directly by modal files.
 */

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  X, Check, Plus, Search, Loader2, Trash2, Lightbulb,
  FileSpreadsheet, Package, ArrowRight, AlertTriangle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { BarcodeInput } from "@/components/BarcodeInput";
import type { Medicine, POLineItem, SRLineItem, AutoSuggestion, InventoryBatch } from "../types";

// ─── ModalShell ────────────────────────────────────────────────────────────────

export function ModalShell({ icon, iconBg, title, desc, onClose, children }: {
  icon: React.ReactNode; iconBg: string; title: string; desc: string;
  onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", iconBg)}>{icon}</div>
            <div>
              <h2 className="text-[16px] font-bold text-slate-900 leading-tight">{title}</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

// ─── ErrorBanner ───────────────────────────────────────────────────────────────

/**
 * Inline banner. Defaults to the error tone (every existing caller relies on that);
 * "success" (green) for positive confirmations and "info" (blue) for neutral notices,
 * so a "nothing to do" or "all matched" message doesn't shout in red.
 */
export function ErrorBanner({ msg, tone = "error" }: { msg: string; tone?: "error" | "success" | "info" }) {
  const styles = tone === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : tone === "info" ? "bg-blue-50 border-blue-200 text-blue-700"
    : "bg-red-50 border-red-200 text-red-600";
  const Icon = tone === "success" ? Check : tone === "info" ? Lightbulb : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 border rounded-lg px-3 py-2.5 text-[13px] ${styles}`}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-px" />{msg}
    </div>
  );
}

// ─── FieldLabel ────────────────────────────────────────────────────────────────

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{children}</label>;
}

// ─── FInput ────────────────────────────────────────────────────────────────────

export function FInput({ value, onChange, placeholder, type = "text", className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string;
}) {
  return (
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={cn("w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors", className)} />
  );
}

// ─── ActionBtn ─────────────────────────────────────────────────────────────────

export function ActionBtn({ onClick, disabled, icon: Icon, label, cls }: {
  onClick: () => void; disabled?: boolean; icon: React.ElementType;
  label: string; cls: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("flex items-center gap-1 text-[11px] font-semibold border rounded-md px-2 py-1 transition-colors disabled:opacity-50", cls)}>
      <Icon className="w-3 h-3" />{label}
    </button>
  );
}

// ─── SmartReorderPanel ────────────────────────────────────────────────────────

export function SmartReorderPanel({ supplierId, onAdd, onClose }: {
  supplierId: string;
  onAdd: (items: POLineItem[]) => void;
  onClose: () => void;
}) {
  const [loading,    setLoading]    = useState(true);
  const [suggestions,setSuggestions]= useState<AutoSuggestion[]>([]);
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setFetchError(null);
    const params: Record<string, any> = { daysThreshold: 30 };
    if (supplierId) params.supplierId = supplierId;
    api.get("/purchases/suggestions", { params })
      .then(({ data }) => {
        setSuggestions(data.data);
        const initQty: Record<string, number> = {};
        for (const s of (data.data as AutoSuggestion[])) initQty[s.medicineId] = s.suggestedQuantity;
        setQuantities(initQty);
        setSelected(new Set((data.data as AutoSuggestion[]).map((s) => s.medicineId)));
      })
      .catch(() => setFetchError("Failed to load suggestions"))
      .finally(() => setLoading(false));
  }, [supplierId]);

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(suggestions.map((s) => s.medicineId)) : new Set());
  }
  function toggle(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function handleAdd() {
    const items: POLineItem[] = suggestions
      .filter((s) => selected.has(s.medicineId))
      .map((s) => ({
        medicineId: s.medicineId, medicineName: s.medicineName,
        batchNumber: "", expiryDate: "",
        quantity: quantities[s.medicineId] ?? s.suggestedQuantity,
        purchaseRate: 0, mrp: 0, gstRate: 12,
      }));
    onAdd(items);
  }

  const selCount = selected.size;
  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
          <Lightbulb className="w-4 h-4 text-amber-500" />Smart Reorder — Low Stock Suggestions
        </p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
          <span className="text-[12px] text-slate-500">Analysing stock levels…</span>
        </div>
      ) : fetchError ? (
        <ErrorBanner msg={fetchError} />
      ) : suggestions.length === 0 ? (
        <p className="text-[13px] text-slate-500 text-center py-6">All medicines are sufficiently stocked. No reorder needed right now.</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">
            {suggestions.length} medicine{suggestions.length !== 1 ? "s" : ""} need restocking. Select the ones to add — you'll still need to fill batch, expiry, and rates below.
          </p>
          <div className="border border-amber-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-[12px]">
              <thead className="bg-amber-50 border-b border-amber-100">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={selCount === suggestions.length && suggestions.length > 0}
                      onChange={(e) => toggleAll(e.target.checked)} className="rounded border-slate-300" />
                  </th>
                  {["Medicine","In Stock","Avg Daily","Days Left","Order Qty"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.medicineId} className={cn("border-b border-slate-100 last:border-0", selected.has(s.medicineId) ? "bg-amber-50/30" : "opacity-50")}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(s.medicineId)}
                        onChange={() => toggle(s.medicineId)} className="rounded border-slate-300" />
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{s.medicineName}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{s.currentStock}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{s.avgDailySales}</td>
                    <td className="px-3 py-2">
                      <span className={cn("font-semibold tabular-nums", s.daysOfStock < 7 ? "text-red-600" : s.daysOfStock < 14 ? "text-amber-600" : "text-slate-600")}>
                        {s.daysOfStock >= 999 ? "—" : s.daysOfStock}
                      </span>
                    </td>
                    <td className="px-3 py-2 w-20">
                      <input type="number" value={quantities[s.medicineId] ?? s.suggestedQuantity} min={1}
                        onChange={(e) => setQuantities((p) => ({ ...p, [s.medicineId]: +e.target.value }))}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] text-center focus:outline-none focus:border-amber-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selCount > 0 && (
            <button type="button" onClick={handleAdd}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors">
              <Plus className="w-4 h-4" />Add {selCount} medicine{selCount !== 1 ? "s" : ""} to PO
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── InventoryBatchPicker ─────────────────────────────────────────────────────

export function InventoryBatchPicker({ onAdd, onClose }: {
  onAdd: (items: SRLineItem[]) => void;
  onClose: () => void;
}) {
  const [search,   setSearch]   = useState("");
  const [batches,  setBatches]  = useState<InventoryBatch[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (search.length < 2) { setBatches([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/inventory", {
          params: { search, inStock: true, status: "ACTIVE", limit: 20 },
        });
        setBatches(data.data.items ?? []);
      } catch {/* */} finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function toggle(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function handleAdd() {
    const toAdd: SRLineItem[] = batches
      .filter((b) => selected.has(b.id))
      .map((b) => ({
        inventoryId:  b.id,
        medicineId:   b.medicine.id,
        medicineName: b.medicine.name,
        batchNumber:  b.batchNumber,
        expiryDate:   new Date(b.expiryDate).toISOString().split("T")[0]!,
        quantity:     1,
        purchaseRate: b.purchaseRate,
        reason:       "DAMAGED" as const,
      }));
    onAdd(toAdd);
  }

  const selCount = selected.size;
  return (
    <div className="border border-violet-200 bg-violet-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
          <Package className="w-4 h-4 text-violet-600" />Select Batches from Inventory
        </p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden h-9">
        <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 flex-shrink-0" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Type medicine name or batch number…"
          autoFocus
          className="flex-1 px-2 text-[13px] placeholder-slate-400 focus:outline-none h-full bg-transparent" />
        {loading && <Loader2 className="w-3.5 h-3.5 text-slate-400 mx-2.5 animate-spin" />}
      </div>
      {batches.length > 0 && (
        <>
          <div className="border border-violet-100 rounded-lg overflow-hidden bg-white max-h-56 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-violet-50 border-b border-violet-100 sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  {["Medicine","Batch","Expiry","In Stock","Buy Rate ₹"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const fmtDateLocal = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
                  return (
                    <tr key={b.id} onClick={() => toggle(b.id)}
                      className={cn("border-b border-slate-100 last:border-0 cursor-pointer hover:bg-violet-50/50", selected.has(b.id) && "bg-violet-50")}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)}
                          onClick={(e) => e.stopPropagation()} className="rounded border-slate-300" />
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-800 max-w-[140px] truncate">{b.medicine.name}</td>
                      <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">{b.batchNumber}</td>
                      <td className="px-3 py-2 text-slate-500">{fmtDateLocal(b.expiryDate)}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">{b.quantity}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">{b.purchaseRate.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selCount > 0 && (
            <button type="button" onClick={handleAdd}
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors">
              <Plus className="w-4 h-4" />Add {selCount} batch{selCount !== 1 ? "es" : ""} to return
            </button>
          )}
        </>
      )}
      {search.length >= 2 && !loading && batches.length === 0 && (
        <p className="text-[12px] text-slate-400 text-center py-4">No active batches found for "{search}"</p>
      )}
    </div>
  );
}

// ─── SmartAddBar ──────────────────────────────────────────────────────────────

export function SmartAddBar({ type, supplierId, onImportCSV, onCopyLast, onLoadFromPO, poOptions, selectedPoId, onPoChange, onScan, onAutoSuggest, loadingCopy, loadingPO }: {
  type:            "grn" | "po" | "return";
  supplierId:      string;
  onImportCSV:     () => void;
  onCopyLast?:     () => void;
  onLoadFromPO?:   () => void;
  poOptions?:      { id: string; orderNumber: string; itemCount: number }[];
  selectedPoId?:   string;
  onPoChange?:     (id: string) => void;
  onScan?:         (code: string) => void;
  onAutoSuggest?:  () => void;
  loadingCopy?:    boolean;
  loadingPO?:      boolean;
}) {
  const [scanMode, setScanMode] = useState(false);
  const [scanLoad, setScanLoad] = useState(false);

  async function handleScan(code: string) {
    if (!onScan) return;
    setScanLoad(true);
    try { onScan(code); } finally { setScanLoad(false); }
  }

  return (
    <div className="space-y-2">
      {type === "grn" && poOptions !== undefined && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <FieldLabel>Link to Purchase Order (optional)</FieldLabel>
            <select
              value={selectedPoId ?? ""}
              onChange={(e) => onPoChange?.(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
              <option value="">— No PO (direct purchase) —</option>
              {poOptions.map((po) => (
                <option key={po.id} value={po.id}>{po.orderNumber} ({po.itemCount} items)</option>
              ))}
            </select>
          </div>
          {selectedPoId && (
            <div className="self-end">
              <button type="button" onClick={onLoadFromPO} disabled={loadingPO}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold h-9 px-3 rounded-lg disabled:opacity-60 transition-colors whitespace-nowrap">
                {loadingPO ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                Load items from PO
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Add medicines via:</span>

        {onCopyLast && (
          <button type="button" onClick={onCopyLast} disabled={!supplierId || loadingCopy}
            title={!supplierId ? "Select a distributor first" : ""}
            className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-semibold h-8 px-3 rounded-lg disabled:opacity-40 transition-colors">
            {loadingCopy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {type === "po" ? "Copy Last Order" : "Copy Last Purchase"}
          </button>
        )}

        {type === "po" && onAutoSuggest && (
          <button type="button" onClick={onAutoSuggest}
            className="flex items-center gap-1.5 border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
            <Lightbulb className="w-3.5 h-3.5" />Smart Reorder
          </button>
        )}

        <button type="button" onClick={() => setScanMode((v) => !v)}
          className={cn("flex items-center gap-1.5 border text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors",
            scanMode ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600")}>
          <Search className="w-3.5 h-3.5" />
          {scanMode ? "Hide Scanner" : "Scan Barcode"}
        </button>

        <button type="button" onClick={onImportCSV}
          className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Import CSV / Sheet
        </button>
      </div>

      {scanMode && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Search className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <BarcodeInput onScan={handleScan} loading={scanLoad} placeholder="Scan or type barcode…" />
          </div>
          <p className="text-[11px] text-amber-600 font-medium whitespace-nowrap">Scan to add medicine</p>
        </div>
      )}
    </div>
  );
}
