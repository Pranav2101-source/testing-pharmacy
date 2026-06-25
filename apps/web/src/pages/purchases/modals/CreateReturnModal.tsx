import { useState, useRef } from "react";
import { Plus, Loader2, RotateCcw, Trash2, FileSpreadsheet, RefreshCw, Package } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { AnimatePresence } from "framer-motion";
import { BarcodeInput } from "@/components/BarcodeInput";
import { cn } from "@/lib/utils";
import type { Supplier, SRLineItem, FullSupplier } from "../types";
import { SR_REASONS } from "../types";
import { csvToReturnItems } from "../utils";
import { ImportPanel } from "../components/ImportPanel";
import { ModalShell, ErrorBanner, FieldLabel, InventoryBatchPicker } from "./shared";
import { QuickAddHint } from "./SupplierFormModal";

export function CreateReturnModal({ suppliers: initialSuppliers, onClose, onDone }: {
  suppliers: Supplier[]; onClose: () => void; onDone: (newSupplier?: FullSupplier) => void;
}) {
  const [suppliers,   setSuppliers]   = useState<Supplier[]>(initialSuppliers);
  const [supplierId,  setSupplierId]  = useState("");
  const [debitNoteNo, setDebitNoteNo] = useState("");
  const [notes,       setNotes]       = useState("");
  const [items,       setItems]       = useState<SRLineItem[]>([]);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [scanLoading,     setScanLoading]     = useState(false);
  const [copyLoading,     setCopyLoading]     = useState(false);
  const [showImport,      setShowImport]      = useState(false);
  const [showBatchPicker, setShowBatchPicker] = useState(false);
  const lastAddedSupplier                     = useRef<FullSupplier | undefined>(undefined);

  async function onScan(code: string) {
    setScanLoading(true);
    try {
      const { data } = await api.get(`/medicines/barcode/${encodeURIComponent(code)}`);
      setItems((p) => [...p, { inventoryId: "", medicineId: data.data.id, medicineName: data.data.name, batchNumber: "", expiryDate: "", quantity: 1, purchaseRate: 0, reason: "DAMAGED" }]);
    } catch { setError("No medicine found for this barcode"); } finally { setScanLoading(false); }
  }

  async function copyFromLastPurchase() {
    if (!supplierId) return;
    setCopyLoading(true);
    try {
      const { data } = await api.get("/purchases/grn", { params: { supplierId, status: "CONFIRMED", limit: 1 } });
      const last = data.data.items?.[0];
      if (!last) { setError("No recent purchases found for this distributor"); return; }
      const { data: grnData } = await api.get(`/purchases/grn/${last.id}`);
      const newItems: SRLineItem[] = (grnData.data.items ?? []).map((i: any) => ({
        inventoryId:  i.inventoryId ?? "",
        medicineId:   i.medicineId  ?? "",
        medicineName: i.medicineName,
        batchNumber:  i.batchNumber ?? "",
        expiryDate:   i.expiryDate  ? new Date(i.expiryDate).toISOString().split("T")[0]! : "",
        quantity:     1,
        purchaseRate: i.purchaseRate,
        reason:       "DAMAGED" as const,
      }));
      setItems((p) => [...p, ...newItems.filter((n) =>
        !p.some((x) => x.medicineName.toLowerCase() === n.medicineName.toLowerCase())
      )]);
    } catch { setError("Failed to load previous purchase"); } finally { setCopyLoading(false); }
  }

  function handleCSVImport(raw: string) {
    setError(null);
    const { items: parsed, errors } = csvToReturnItems(raw);
    if (parsed.length === 0) {
      setError(errors.length > 0 ? errors.slice(0, 3).join(" · ") : "No valid rows found.");
      return;
    }
    const toAdd: SRLineItem[] = parsed.map((p) => ({
      inventoryId:  "",
      medicineId:   "",
      medicineName: p.medicineName ?? "",
      batchNumber:  p.batchNumber  ?? "",
      expiryDate:   p.expiryDate   ?? "",
      quantity:     p.quantity     ?? 1,
      purchaseRate: p.purchaseRate ?? 0,
      reason:       "DAMAGED" as const,
    }));
    setItems((prev) => [...prev, ...toAdd.filter((i) =>
      !prev.some((x) => x.medicineName.toLowerCase() === i.medicineName.toLowerCase())
    )]);
    setShowImport(false);
    if (errors.length > 0) setError(`${toAdd.length} items added. ${errors.length} row(s) skipped.`);
  }

  function upd(idx: number, key: string, val: string | number) {
    setItems((p) => { const n = [...p]; (n[idx] as any)[key] = val; return n; });
  }

  const total = items.reduce((s, i) => s + i.purchaseRate * i.quantity, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Select a supplier"); return; }
    if (items.length === 0) { setError("Add at least one item"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/supplier-returns", {
        supplierId, debitNoteNo: debitNoteNo || undefined, notes: notes || undefined,
        items: items.map((i) => ({ ...i, expiryDate: new Date(i.expiryDate).toISOString() })),
      });
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to create return"));
    } finally { setSaving(false); }
  }

  return (
    <ModalShell icon={<RotateCcw className="w-4 h-4 text-red-500" />} iconBg="bg-red-50"
      title="New Supplier Return" desc="DRAFT — confirm to deduct inventory stock" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>Distributor / Supplier *</FieldLabel>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
                <option value="">Select…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <QuickAddHint suppliers={suppliers} onAdded={(s) => { lastAddedSupplier.current = s; setSuppliers((p) => [...p, s]); setSupplierId(s.id); }} />
            </div>
            <div>
              <FieldLabel>Debit Note No.</FieldLabel>
              <input value={debitNoteNo} onChange={(e) => setDebitNoteNo(e.target.value)} placeholder="Optional"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors" />
            </div>
            <div>
              <FieldLabel>Scan Barcode</FieldLabel>
              <BarcodeInput onScan={onScan} loading={scanLoading} placeholder="Scan item barcode…" />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Add items via:</span>
            <button type="button" onClick={() => { setShowBatchPicker((v) => !v); setShowImport(false); }}
              className={cn("flex items-center gap-1.5 border text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors",
                showBatchPicker ? "bg-violet-100 border-violet-300 text-violet-700" : "border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700")}>
              <Package className="w-3.5 h-3.5" />Select from Inventory
            </button>
            <button type="button" onClick={copyFromLastPurchase} disabled={!supplierId || copyLoading}
              title={!supplierId ? "Select a distributor first" : ""}
              className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-semibold h-8 px-3 rounded-lg disabled:opacity-40 transition-colors">
              {copyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              From Last Purchase
            </button>
            <button type="button" onClick={() => { setShowImport((v) => !v); setShowBatchPicker(false); }}
              className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
              <FileSpreadsheet className="w-3.5 h-3.5" />Import CSV / Sheet
            </button>
          </div>
          {showBatchPicker && (
            <InventoryBatchPicker
              onAdd={(picked) => {
                setItems((prev) => {
                  const existing = new Set(prev.map((x) => x.batchNumber.toLowerCase()));
                  return [...prev, ...picked.filter((i) => !existing.has(i.batchNumber.toLowerCase()))];
                });
                setShowBatchPicker(false);
              }}
              onClose={() => setShowBatchPicker(false)}
            />
          )}
          {showImport && (
            <ImportPanel type="return" onImport={handleCSVImport} onClose={() => setShowImport(false)} />
          )}

          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Medicine","Inventory ID","Batch","Expiry","Qty","Buy Rate","Reason","Amount",""].map((h) => (
                      <th key={h} className="px-2 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2 max-w-[110px]"><p className="text-[11px] font-semibold text-slate-800 truncate">{item.medicineName}</p></td>
                      <td className="px-1.5 py-2 w-28"><input value={item.inventoryId} onChange={(e) => upd(idx,"inventoryId",e.target.value)} placeholder="Inventory ID" className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-20"><input value={item.batchNumber} onChange={(e) => upd(idx,"batchNumber",e.target.value)} placeholder="Batch" className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-28"><input type="date" value={item.expiryDate} onChange={(e) => upd(idx,"expiryDate",e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-14"><input type="number" value={item.quantity} min={1} onChange={(e) => upd(idx,"quantity",+e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1.5 text-[11px] text-center focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-20"><input type="number" value={item.purchaseRate||""} step="0.01" min={0} onChange={(e) => upd(idx,"purchaseRate",+e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-32">
                        <select value={item.reason} onChange={(e) => upd(idx,"reason",e.target.value)} className="w-full border border-slate-200 rounded px-1 py-1.5 text-[11px] bg-white focus:outline-none focus:border-blue-400">
                          {SR_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2 text-[11px] font-semibold text-slate-700 tabular-nums">₹{(item.purchaseRate * item.quantity).toFixed(2)}</td>
                      <td className="px-1.5 py-2">
                        <button type="button" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center text-slate-300 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr><td colSpan={7} className="px-3 py-2.5 text-right text-[12px] text-slate-500">Total Return Value</td><td className="px-2 py-2.5 text-[14px] font-bold text-slate-900">₹{total.toFixed(2)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}

          {error && <ErrorBanner msg={error} />}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <span className="text-[12px] text-slate-400">{items.length} item{items.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 font-medium">Cancel</button>
            <button type="submit" disabled={saving || items.length === 0}
              className="px-6 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create Return
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
