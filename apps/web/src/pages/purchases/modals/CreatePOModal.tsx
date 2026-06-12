import { useState, useRef } from "react";
import { Plus, Loader2, FileText, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { AnimatePresence } from "framer-motion";
import type { Supplier, Medicine, POLineItem, FullSupplier } from "../types";
import { GST_RATES } from "../types";
import { currency, csvToPOItems } from "../utils";
import { MedicineCombobox } from "../components/MedicineCombobox";
import { ImportPanel } from "../components/ImportPanel";
import { ModalShell, ErrorBanner, FieldLabel, FInput, SmartAddBar, SmartReorderPanel } from "./shared";
import { QuickAddHint } from "./SupplierFormModal";

export function CreatePOModal({ suppliers: initialSuppliers, onClose, onDone, initialMedicine }: {
  suppliers: Supplier[]; onClose: () => void; onDone: (newSupplier?: FullSupplier) => void;
  initialMedicine?: { id: string; name: string; gstRate: number };
}) {
  const [suppliers,    setSuppliers]    = useState<Supplier[]>(initialSuppliers);
  const [supplierId,   setSupplierId]   = useState("");
  const [invoiceNo,    setInvoiceNo]    = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes,        setNotes]        = useState("");
  const [items,        setItems]        = useState<POLineItem[]>(() =>
    initialMedicine
      ? [{ medicineId: initialMedicine.id, medicineName: initialMedicine.name, batchNumber: "", expiryDate: "", quantity: 1, purchaseRate: 0, mrp: 0, gstRate: initialMedicine.gstRate }]
      : [],
  );
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [showImport,   setShowImport]   = useState(false);
  const [showSuggest,  setShowSuggest]  = useState(false);
  const [copyLoading,  setCopyLoading]  = useState(false);
  const [importError,  setImportError]  = useState<string | null>(null);
  const lastAddedSupplier               = useRef<FullSupplier | undefined>(undefined);

  function addMedicine(m: Medicine) {
    setItems((p) => [...p, { medicineId: m.id, medicineName: m.name, batchNumber: "", expiryDate: "", quantity: 1, purchaseRate: 0, mrp: 0, gstRate: m.gstRate }]);
  }

  async function handleBarcodeScan(code: string) {
    try {
      const { data } = await api.get(`/medicines/barcode/${encodeURIComponent(code)}`);
      addMedicine(data.data);
    } catch { setError("No medicine found for this barcode"); }
  }

  async function copyLastOrder() {
    if (!supplierId) return;
    setCopyLoading(true);
    try {
      const { data } = await api.get("/purchases/orders", {
        params: { supplierId, status: "RECEIVED", limit: 1 },
      });
      const last = data.data.items?.[0];
      if (!last) { setError("No previous orders found for this distributor"); return; }
      const { data: poData } = await api.get(`/purchases/orders/${last.id}`);
      const poItems: POLineItem[] = (poData.data.items ?? []).map((i: any) => ({
        medicineId:   i.medicineId ?? "",
        medicineName: i.medicineName,
        batchNumber:  "",
        expiryDate:   "",
        quantity:     i.quantity,
        purchaseRate: i.purchaseRate,
        mrp:          i.mrp,
        gstRate:      i.gstRate,
      }));
      setItems((p) => {
        const existing = new Set(p.map((x) => x.medicineName.toLowerCase()));
        return [...p, ...poItems.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
      });
    } catch { setError("Failed to load previous order"); }
    finally { setCopyLoading(false); }
  }

  function handleCSVImport(raw: string) {
    setImportError(null);
    const { items: parsed, errors } = csvToPOItems(raw);
    if (errors.length > 0) { setImportError(errors.slice(0, 3).join(" · ")); return; }
    const toAdd: POLineItem[] = parsed.map((p) => ({
      medicineId:   "",
      medicineName: p.medicineName ?? "",
      batchNumber:  p.batchNumber  ?? "",
      expiryDate:   p.expiryDate   ?? "",
      quantity:     p.quantity     ?? 1,
      purchaseRate: p.purchaseRate ?? 0,
      mrp:          p.mrp          ?? 0,
      gstRate:      p.gstRate      ?? 12,
    }));
    setItems((prev) => {
      const existing = new Set(prev.map((x) => x.medicineName.toLowerCase()));
      return [...prev, ...toAdd.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
    });
    setShowImport(false);
  }

  function upd(idx: number, key: keyof POLineItem, val: string | number) {
    setItems((p) => { const n = [...p]; (n[idx] as any)[key] = val; return n; });
  }

  const totals = items.reduce((a, i) => {
    const sub = i.purchaseRate * i.quantity;
    return { sub: a.sub + sub, gst: a.gst + (sub * i.gstRate) / 100 };
  }, { sub: 0, gst: 0 });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Select a supplier"); return; }
    if (items.length === 0) { setError("Add at least one medicine"); return; }
    const bad = items.find((i) => !i.batchNumber || !i.expiryDate || i.purchaseRate <= 0 || i.mrp <= 0);
    if (bad) { setError("Fill all item fields (batch, expiry, rates)"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/purchases/orders", {
        supplierId, invoiceNo: invoiceNo || undefined, notes: notes || undefined,
        expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
        items: items.map((i) => ({ ...i, expiryDate: new Date(i.expiryDate).toISOString() })),
      });
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create purchase order");
    } finally { setSaving(false); }
  }

  return (
    <ModalShell icon={<FileText className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-50"
      title="New Purchase Order" desc="Created as DRAFT — send to supplier when ready" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <FieldLabel>Distributor / Supplier *</FieldLabel>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <QuickAddHint suppliers={suppliers} onAdded={(s) => { lastAddedSupplier.current = s; setSuppliers((p) => [...p, s]); setSupplierId(s.id); }} />
            </div>
            <div>
              <FieldLabel>Ref Invoice No.</FieldLabel>
              <FInput value={invoiceNo} onChange={setInvoiceNo} placeholder="Optional" />
            </div>
            <div>
              <FieldLabel>Expected Delivery</FieldLabel>
              <FInput type="date" value={expectedDate} onChange={setExpectedDate} />
            </div>
          </div>

          <div>
            <SmartAddBar
              type="po"
              supplierId={supplierId}
              onImportCSV={() => { setShowImport((v) => !v); setShowSuggest(false); }}
              onCopyLast={copyLastOrder}
              onScan={handleBarcodeScan}
              onAutoSuggest={() => { setShowSuggest((v) => !v); setShowImport(false); }}
              loadingCopy={copyLoading}
            />
            {showImport && (
              <ImportPanel type="po" onImport={handleCSVImport} onClose={() => setShowImport(false)} />
            )}
            {showSuggest && (
              <SmartReorderPanel
                supplierId={supplierId}
                onAdd={(suggested) => {
                  setItems((prev) => {
                    const existing = new Set(prev.map((x) => x.medicineName.toLowerCase()));
                    return [...prev, ...suggested.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
                  });
                  setShowSuggest(false);
                }}
                onClose={() => setShowSuggest(false)}
              />
            )}
            {importError && <ErrorBanner msg={importError} />}

            <FieldLabel>Search &amp; Add Medicine (one by one)</FieldLabel>
            <MedicineCombobox onSelect={addMedicine} onClearError={() => setError(null)} />
          </div>

          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Medicine", "Batch No.", "Expiry Date", "Qty", "Buy Rate ₹", "MRP ₹", "GST %", "Amount", ""].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const amt = item.purchaseRate * item.quantity * (1 + item.gstRate / 100);
                    return (
                      <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/20">
                        <td className="px-3 py-2 max-w-[140px]">
                          <p className="text-[12px] font-semibold text-slate-800 truncate">{item.medicineName}</p>
                        </td>
                        <td className="px-2 py-2 w-24">
                          <input value={item.batchNumber} onChange={(e) => upd(idx, "batchNumber", e.target.value)} placeholder="Batch"
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-32">
                          <input type="date" value={item.expiryDate} onChange={(e) => upd(idx, "expiryDate", e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-16">
                          <input type="number" value={item.quantity} min={1} onChange={(e) => upd(idx, "quantity", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] text-center focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-24">
                          <input type="number" value={item.purchaseRate || ""} placeholder="0.00" step="0.01" min={0}
                            onChange={(e) => upd(idx, "purchaseRate", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-24">
                          <input type="number" value={item.mrp || ""} placeholder="0.00" step="0.01" min={0}
                            onChange={(e) => upd(idx, "mrp", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-16">
                          <select value={item.gstRate} onChange={(e) => upd(idx, "gstRate", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-1 py-1.5 text-[12px] bg-white focus:outline-none focus:border-blue-400">
                            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-[12px] font-semibold text-slate-700 tabular-nums whitespace-nowrap">{currency(amt)}</td>
                        <td className="px-2 py-2">
                          <button type="button" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                            className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center text-slate-300 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={7} className="px-3 py-2.5 text-right text-[12px] text-slate-500">
                      Subtotal <span className="font-semibold text-slate-700">{currency(totals.sub)}</span>
                      {"  ·  "}GST <span className="font-semibold text-slate-700">{currency(totals.gst)}</span>
                      {"  ·  "}Total
                    </td>
                    <td className="px-3 py-2.5 text-[14px] font-bold text-slate-900 tabular-nums">{currency(totals.sub + totals.gst)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {error && <ErrorBanner msg={error} />}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <span className="text-[12px] text-slate-400">{items.length} line item{items.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 font-medium">Cancel</button>
            <button type="submit" disabled={saving || items.length === 0}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create PO
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
