import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, X, Check, AlertCircle, Search, Pill, PackagePlus, Info,
} from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconGridPicker } from "@/components/IconGridPicker";
import { PACKAGING_UNITS, PRODUCT_CATEGORIES } from "@/lib/product-taxonomy";
import { syncProductClassification } from "@/lib/product-cache";
import type { MedicineSearchResult } from "@pharmacy/types";

// ── Manual "Add Stock" — a guided, non-technical alternative to the CSV
// bulk-import path. Pick a medicine, fill batch details, save. Designed so a
// non-tech operator can add received stock without building a spreadsheet.

type PickedMedicine = Pick<
  MedicineSearchResult,
  "id" | "name" | "genericName" | "manufacturer" | "form" | "strength" | "packSize" | "category" | "unit"
>;

export function AddStockModal({ onClose, onDone, onToast }: {
  onClose: () => void;
  onDone: () => void;
  onToast: (msg: string, variant: "success" | "error") => void;
}) {
  const [picked,       setPicked]       = useState<PickedMedicine | null>(null);
  const [query,        setQuery]        = useState("");
  const [debounced,    setDebounced]    = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [batchNumber,  setBatchNumber]  = useState("");
  const [expiryDate,   setExpiryDate]   = useState("");
  const [quantity,     setQuantity]     = useState(1);
  const [mrp,          setMrp]          = useState("");
  const [purchaseRate, setPurchaseRate] = useState("");
  const [location,     setLocation]     = useState("");
  const [minimumStock, setMinimumStock] = useState(10);

  const [category,     setCategory]     = useState("");
  const [unit,         setUnit]         = useState("");

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  // The stock is saved, but the backend flags this batch as a likely different pack
  // size (see PackSizeGuard) — hold the modal open so the operator actually reads it.
  const [packWarning, setPackWarning] = useState<string | null>(null);

  const canClassify = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");

  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Debounce the medicine search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [], isFetching: searching } = useQuery({
    queryKey: ["medicine-search", debounced],
    queryFn:  () =>
      api.get<{ data: MedicineSearchResult[] }>("/medicines/search", {
        params: { q: debounced, limit: 8 },
      }).then((r) => r.data.data),
    enabled:   debounced.length > 0 && !picked,
    staleTime: 60_000,
  });

  function selectMedicine(m: MedicineSearchResult) {
    setPicked(m);
    setCategory(m.category ?? "");
    setUnit(m.unit ?? "");
    setDropdownOpen(false);
    setQuery("");
    setDebounced("");
    setError(null);
  }

  // Live cross-field hint: buying above MRP is almost always a data-entry slip.
  const mrpNum   = Number(mrp);
  const rateNum  = Number(purchaseRate);
  const rateOverMrp = mrp !== "" && purchaseRate !== "" && rateNum > mrpNum;

  function validate(): string | null {
    if (!picked)                       return "Select a medicine first.";
    if (!batchNumber.trim())           return "Enter the batch number printed on the pack.";
    if (!expiryDate)                   return "Choose the expiry date.";
    // Compare on date only — a batch expiring today is already unsellable.
    const exp = new Date(expiryDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (isNaN(exp.getTime()))          return "That expiry date isn't valid.";
    if (exp <= today)                  return "Expiry date must be in the future — this batch is already expired.";
    if (!Number.isFinite(quantity) || quantity <= 0) return "Quantity must be at least 1.";
    if (mrp === "" || !(mrpNum > 0))            return "Enter the MRP (must be greater than 0).";
    if (purchaseRate === "" || !(rateNum > 0))  return "Enter the purchase rate (must be greater than 0).";
    if (rateNum > mrpNum)              return `Purchase rate (₹${rateNum}) is higher than MRP (₹${mrpNum}). Double-check the figures.`;
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.post("/inventory", {
        medicineId:   picked!.id,
        batchNumber:  batchNumber.trim(),
        expiryDate:   new Date(expiryDate).toISOString(),
        quantity,
        mrp:          mrpNum,
        purchaseRate: rateNum,
        ...(location.trim() ? { location: location.trim() } : {}),
        minimumStock,
      });
      // If the operator set/changed the product's category or packaging, save it
      // too. Non-fatal: the stock is already recorded, so a classification hiccup
      // must never surface as an "add stock failed" error.
      const classChanged = (category || "") !== (picked!.category ?? "") || (unit || "") !== (picked!.unit ?? "");
      if (canClassify && classChanged) {
        try {
          await api.patch(`/medicines/${picked!.id}/classification`, {
            category: category.trim() || null,
            unit: unit.trim() || null,
          });
          // Reflect the new classification everywhere instantly.
          syncProductClassification(queryClient, picked!.id, {
            category: category.trim() || null,
            unit: unit.trim() || null,
          });
        } catch { /* stock already saved — ignore */ }
      }

      const payload = res.data?.data ?? res.data;
      const merged = payload?.merged === true || res.data?.meta?.merged === true;
      onToast(
        merged
          ? `Added ${quantity} to existing batch ${batchNumber.trim()} of ${picked!.name}`
          : `Stock added — ${picked!.name} (Batch ${batchNumber.trim()}, ${quantity} units)`,
        "success",
      );
      if (payload?.warning) {
        // Saved — but make the operator acknowledge the pack-size mismatch before the modal closes.
        setPackWarning(payload.warning as string);
        return;
      }
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't add stock. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }} transition={{ duration: 0.18 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <PackagePlus className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900">Add Stock</h2>
              <p className="text-[12px] text-slate-400 mt-0.5">Record newly received medicine stock</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
          {/* ── Medicine picker ────────────────────────────────────────── */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Medicine *</label>
            {picked ? (
              <div className="flex items-center gap-3 border border-emerald-200 bg-emerald-50/50 rounded-lg px-3 py-2.5">
                <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
                  <Pill className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-slate-800 truncate">{picked.name}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {[picked.genericName, picked.manufacturer, picked.strength].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <button type="button" onClick={() => setPicked(null)}
                  className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 flex-shrink-0">Change</button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400">
                  <span className="pl-3 text-slate-400">
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </span>
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); }}
                    onFocus={() => setDropdownOpen(true)}
                    placeholder="Search by name, generic, or barcode…"
                    className="flex-1 px-2.5 py-2.5 text-[14px] bg-transparent focus:outline-none"
                  />
                </div>
                {dropdownOpen && debounced.length > 0 && (results.length > 0 || !searching) && (
                  <ul className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {results.length === 0 ? (
                      <li className="px-3 py-4 text-center text-[12px] text-slate-400">
                        No medicine matches “{debounced}”. It must exist in the catalogue first.
                      </li>
                    ) : results.map((m) => (
                      <li key={m.id}
                        onClick={() => selectMedicine(m)}
                        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-blue-50/60 border-b border-slate-50 last:border-0">
                        <Pill className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{m.name}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {[m.genericName, m.manufacturer].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ── Category / Packaging (owner+manager; saved with the stock) ── */}
          {picked && canClassify && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Category / Type</label>
                <IconGridPicker value={category} onChange={setCategory} options={PRODUCT_CATEGORIES} title="Product Category" placeholder="Select category" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Packaging</label>
                <IconGridPicker value={unit} onChange={setUnit} options={PACKAGING_UNITS} title="Packaging Type" placeholder="Select packaging" />
              </div>
            </div>
          )}

          {/* ── Batch + Expiry ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Batch No. *</label>
              <input type="text" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="e.g. AB1234"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Expiry *</label>
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
          </div>

          {/* ── Quantity ───────────────────────────────────────────────── */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Quantity *</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 font-bold">−</button>
              <input type="number" value={quantity} min={1} onChange={(e) => setQuantity(Math.max(1, Math.floor(+e.target.value || 1)))}
                className="w-24 text-center border border-slate-200 rounded-lg px-3 py-2 text-[14px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
              <button type="button" onClick={() => setQuantity((q) => q + 1)}
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 text-slate-600 font-bold">+</button>
              <span className="text-[12px] text-slate-400">units</span>
            </div>
          </div>

          {/* ── Pricing ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">MRP (₹) *</label>
              <input type="number" step="0.01" min="0" value={mrp} onChange={(e) => setMrp(e.target.value)}
                placeholder="0.00"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Purchase Rate (₹) *</label>
              <input type="number" step="0.01" min="0" value={purchaseRate} onChange={(e) => setPurchaseRate(e.target.value)}
                placeholder="0.00"
                className={cn("w-full border rounded-lg px-3 py-2 text-[14px] tabular-nums focus:outline-none focus:ring-2",
                  rateOverMrp ? "border-amber-300 focus:ring-amber-100 focus:border-amber-400" : "border-slate-200 focus:ring-blue-100 focus:border-blue-400")} />
            </div>
          </div>
          {rateOverMrp && (
            <div className="flex items-center gap-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              Purchase rate is above MRP — usually a typo. Please verify before saving.
            </div>
          )}

          {/* ── Optional: location + min stock ─────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Shelf / Location</label>
              <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                placeholder="Optional"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Low-stock alert at</label>
              <input type="number" min={0} value={minimumStock} onChange={(e) => setMinimumStock(Math.max(0, Math.floor(+e.target.value || 0)))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Add Stock
            </button>
          </div>
        </form>
      </motion.div>

      {/* Stock is already saved — hold for an acknowledgement when the batch looks
          like a different pack size (see PackSizeGuard). */}
      <ConfirmDialog
        open={!!packWarning}
        tone="warning"
        title="Stock saved — check the pack size"
        body={packWarning}
        confirmLabel="Got it"
        cancelLabel={null}
        onConfirm={onDone}
        onCancel={onDone}
      />
    </div>
  );
}
