import { useState, useRef } from "react";
import { Plus, Loader2, Truck, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Supplier, Medicine, GRNLineItem, FullSupplier } from "../types";
import { GST_RATES } from "../types";
import { currency, csvToGRNItems } from "../utils";
import { MedicineCombobox } from "../components/MedicineCombobox";
import { ImportPanel } from "../components/ImportPanel";
import { ModalShell, ErrorBanner, FieldLabel, FInput, SmartAddBar } from "./shared";
import { QuickAddHint } from "./SupplierFormModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type NearExpiryHit = { name: string; date: string; days: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

const NEAR_EXPIRY_DAYS = 90;

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function buildPayload(
  supplierId: string, invNo: string, invDate: string,
  poId: string, notes: string, items: GRNLineItem[],
  allowNearExpiry: boolean,
) {
  return {
    supplierId,
    supplierInvoiceNo:   invNo   || undefined,
    supplierInvoiceDate: invDate ? new Date(invDate).toISOString() : undefined,
    purchaseOrderId:     poId    || undefined,
    notes:               notes   || undefined,
    allowNearExpiry,
    items: items.map((i) => ({ ...i, expiryDate: new Date(i.expiryDate).toISOString() })),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CreateGRNModal({ suppliers: initialSuppliers, onClose, onDone }: {
  suppliers: Supplier[]; onClose: () => void; onDone: (newSupplier?: FullSupplier) => void;
}) {
  const [suppliers,     setSuppliers]    = useState<Supplier[]>(initialSuppliers);
  const [supplierId,    setSupplierId]   = useState("");
  const [invNo,         setInvNo]        = useState("");
  const [invDate,       setInvDate]      = useState("");
  const [poId,          setPoId]         = useState("");
  const [notes,         setNotes]        = useState("");
  const [items,         setItems]        = useState<GRNLineItem[]>([]);
  const [saving,        setSaving]       = useState(false);
  const [error,         setError]        = useState<string | null>(null);
  const [showImport,    setShowImport]   = useState(false);
  const [copyLoading,   setCopyLoading]  = useState(false);
  const [poLoading,     setPoLoading]    = useState(false);
  const [poOptions,     setPoOptions]    = useState<{ id: string; orderNumber: string; itemCount: number }[]>([]);
  const [importError,   setImportError]  = useState<string | null>(null);
  // Near-expiry override state — set when API returns the 90-day guard error
  const [nearExpiryHits, setNearExpiryHits] = useState<NearExpiryHit[]>([]);
  const lastAddedSupplier                    = useRef<FullSupplier | undefined>(undefined);

  // Derived: set of medicine names (lowercase) currently flagged as near-expiry
  const nearExpiryNames = new Set(nearExpiryHits.map((h) => h.name.toLowerCase()));

  // Load PENDING POs whenever supplier changes
  function loadPOOptions(sid: string) {
    if (!sid) { setPoOptions([]); return; }
    api.get("/purchases/orders", { params: { supplierId: sid, status: "PENDING", limit: 20 } })
      .then(({ data }) => setPoOptions((data.data.items ?? []).map((po: any) => ({
        id: po.id, orderNumber: po.orderNumber, itemCount: po._count?.items ?? 0,
      })))
      ).catch(() => setPoOptions([]));
  }

  function addMed(m: Medicine) {
    setItems((p) => [...p, { medicineId: m.id, medicineName: m.name, batchNumber: "", expiryDate: "", orderedQty: 0, receivedQty: 1, freeQty: 0, purchaseRate: 0, mrp: 0, discount: 0, gstRate: m.gstRate }]);
  }

  async function loadFromPO() {
    if (!poId) return;
    setPoLoading(true);
    try {
      const { data } = await api.get(`/purchases/orders/${poId}`);
      const poItems: GRNLineItem[] = (data.data.items ?? []).map((i: any) => ({
        medicineId: i.medicineId ?? "", medicineName: i.medicineName,
        batchNumber: "", expiryDate: "",
        orderedQty: i.quantity, receivedQty: i.quantity,
        freeQty: 0, purchaseRate: i.purchaseRate, mrp: i.mrp, discount: 0, gstRate: i.gstRate,
      }));
      setItems((p) => {
        const existing = new Set(p.map((x) => x.medicineName.toLowerCase()));
        return [...p, ...poItems.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
      });
    } catch { setError("Failed to load PO items"); }
    finally { setPoLoading(false); }
  }

  async function copyLastPurchase() {
    if (!supplierId) return;
    setCopyLoading(true);
    try {
      const { data } = await api.get("/purchases/grn", { params: { supplierId, status: "CONFIRMED", limit: 1 } });
      const last = data.data.items?.[0];
      if (!last) { setError("No previous purchases found for this distributor"); return; }
      const { data: grnData } = await api.get(`/purchases/grn/${last.id}`);
      const grnItems: GRNLineItem[] = (grnData.data.items ?? []).map((i: any) => ({
        medicineId: i.medicineId ?? "", medicineName: i.medicineName,
        batchNumber: "", expiryDate: "",
        orderedQty: i.receivedQty, receivedQty: i.receivedQty,
        freeQty: 0, purchaseRate: i.purchaseRate, mrp: i.mrp, discount: i.discount, gstRate: i.gstRate,
      }));
      setItems((p) => {
        const existing = new Set(p.map((x) => x.medicineName.toLowerCase()));
        return [...p, ...grnItems.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
      });
    } catch { setError("Failed to load previous purchase"); }
    finally { setCopyLoading(false); }
  }

  async function handleBarcodeScan(code: string) {
    try {
      const { data } = await api.get(`/medicines/barcode/${encodeURIComponent(code)}`);
      addMed(data.data);
    } catch { setError("No medicine found for this barcode"); }
  }

  function handleCSVImport(raw: string) {
    setImportError(null);
    const { items: parsed, errors } = csvToGRNItems(raw);
    if (errors.length > 0) setImportError(`${errors.length} row(s) skipped:\n${errors.join("\n")}`);
    if (parsed.length === 0) return;
    const toAdd: GRNLineItem[] = parsed.map((p) => ({
      medicineId: "", medicineName: p.medicineName ?? "",
      batchNumber: p.batchNumber ?? "", expiryDate: p.expiryDate ?? "",
      orderedQty: 0, receivedQty: p.receivedQty ?? 1, freeQty: p.freeQty ?? 0,
      purchaseRate: p.purchaseRate ?? 0, mrp: p.mrp ?? 0, discount: p.discount ?? 0,
      gstRate: p.gstRate ?? 12,
    }));
    setItems((prev) => {
      const existing = new Set(prev.map((x) => `${x.medicineName.toLowerCase()}::${x.batchNumber}`));
      return [...prev, ...toAdd.filter((i) => !existing.has(`${i.medicineName.toLowerCase()}::${i.batchNumber}`))];
    });
    if (errors.length === 0) setShowImport(false);
  }

  function upd(idx: number, key: keyof GRNLineItem, val: string | number) {
    setItems((p) => { const n = [...p]; (n[idx] as any)[key] = val; return n; });
    // Clear the near-expiry warning whenever the user edits anything — they may have fixed the dates
    if (nearExpiryHits.length > 0) setNearExpiryHits([]);
  }

  const totals = items.reduce((a, i) => {
    const sub = i.purchaseRate * i.receivedQty * (1 - i.discount / 100);
    return { sub: a.sub + sub, gst: a.gst + (sub * i.gstRate) / 100 };
  }, { sub: 0, gst: 0 });

  // ── Validate form before any network call ─────────────────────────────────

  function validate(): string[] {
    const errs: string[] = [];
    if (!supplierId) errs.push("Select a supplier");
    if (items.length === 0) errs.push("Add at least one medicine");
    for (let idx = 0; idx < items.length; idx++) {
      const i = items[idx]!;
      const row = `Row ${idx + 1} (${i.medicineName})`;
      if (!i.batchNumber.trim()) errs.push(`${row}: Batch number is required`);
      if (!i.expiryDate)         errs.push(`${row}: Expiry date is required`);
      else if (isNaN(new Date(i.expiryDate).getTime())) errs.push(`${row}: Expiry date is invalid`);
      if (i.receivedQty <= 0)    errs.push(`${row}: Received qty must be > 0`);
      if (i.purchaseRate <= 0)   errs.push(`${row}: Purchase rate must be > 0`);
      if (i.mrp <= 0)            errs.push(`${row}: MRP must be > 0`);
    }
    return errs;
  }

  // ── Primary save (allowNearExpiry = false by default) ─────────────────────

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (errs.length > 0) { setError(errs.join("  ·  ")); return; }

    setSaving(true); setError(null); setNearExpiryHits([]);
    try {
      await api.post("/purchases/grn", buildPayload(supplierId, invNo, invDate, poId, notes, items, false));
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      const msg: string = err?.response?.data?.error ?? "";
      if (msg.includes("expire within")) {
        // Identify which items are the culprits from local state
        const threshold = new Date(Date.now() + NEAR_EXPIRY_DAYS * 86_400_000);
        const hits = items
          .filter((i) => i.expiryDate && new Date(i.expiryDate) <= threshold)
          .map((i) => ({ name: i.medicineName, date: i.expiryDate, days: daysUntil(i.expiryDate) }));
        setNearExpiryHits(hits);
      } else {
        setError(msg || "Failed to create GRN");
      }
    } finally { setSaving(false); }
  }

  // ── Override save (allowNearExpiry = true) ────────────────────────────────

  async function submitWithNearExpiry() {
    const errs = validate();
    if (errs.length > 0) { setNearExpiryHits([]); setError(errs.join("  ·  ")); return; }

    setSaving(true); setNearExpiryHits([]); setError(null);
    try {
      await api.post("/purchases/grn", buildPayload(supplierId, invNo, invDate, poId, notes, items, true));
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create GRN");
    } finally { setSaving(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ModalShell icon={<Truck className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-50"
      title="Gate Inward — New GRN" desc="DRAFT — confirm later to update stock" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

          {/* ── Header fields ──────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <FieldLabel>Distributor / Supplier *</FieldLabel>
              <select value={supplierId}
                onChange={(e) => { setSupplierId(e.target.value); loadPOOptions(e.target.value); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <QuickAddHint suppliers={suppliers} onAdded={(s) => { lastAddedSupplier.current = s; setSuppliers((p) => [...p, s]); setSupplierId(s.id); loadPOOptions(s.id); }} />
            </div>
            <div>
              <FieldLabel>Supplier Invoice No.</FieldLabel>
              <FInput value={invNo} onChange={setInvNo} placeholder="e.g. INV-1234" />
            </div>
            <div>
              <FieldLabel>Invoice Date</FieldLabel>
              <FInput type="date" value={invDate} onChange={setInvDate} />
            </div>
          </div>

          {/* ── Smart add bar (PO load / copy last / CSV / scan) ───────── */}
          <SmartAddBar
            type="grn"
            supplierId={supplierId}
            onImportCSV={() => setShowImport((v) => !v)}
            onCopyLast={copyLastPurchase}
            onLoadFromPO={loadFromPO}
            poOptions={poOptions}
            selectedPoId={poId}
            onPoChange={(id) => setPoId(id)}
            onScan={handleBarcodeScan}
            loadingCopy={copyLoading}
            loadingPO={poLoading}
          />
          {showImport && (
            <ImportPanel type="grn" onImport={handleCSVImport} onClose={() => setShowImport(false)} />
          )}
          {importError && <ErrorBanner msg={importError} />}

          {/* ── Medicine search ────────────────────────────────────────── */}
          <div>
            <FieldLabel>Search &amp; Add Medicine (one by one)</FieldLabel>
            <MedicineCombobox onSelect={addMed} onClearError={() => setError(null)} />
          </div>

          {/* ── Line items table ───────────────────────────────────────── */}
          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Medicine","Batch","Expiry","Ord","Rcvd","Free","Buy Rate","MRP","Disc %","GST %","Amount",""].map((h) => (
                      <th key={h} className="px-2 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const sub        = item.purchaseRate * item.receivedQty * (1 - item.discount / 100);
                    const amt        = sub + (sub * item.gstRate) / 100;
                    const isNearExp  = nearExpiryNames.has(item.medicineName.toLowerCase());
                    return (
                      <tr key={idx}
                        className={`border-b border-slate-100 last:border-0 transition-colors ${
                          isNearExp ? "bg-orange-50 hover:bg-orange-50/80" : "hover:bg-emerald-50/20"
                        }`}>
                        <td className="px-2 py-2 max-w-[110px]">
                          <div className="flex items-center gap-1.5">
                            {isNearExp && <AlertTriangle className="w-3 h-3 text-orange-500 flex-shrink-0" />}
                            <p className="text-[11px] font-semibold text-slate-800 truncate">{item.medicineName}</p>
                          </div>
                        </td>
                        <td className="px-1.5 py-2 w-20">
                          <input value={item.batchNumber} onChange={(e) => upd(idx, "batchNumber", e.target.value)} placeholder="Batch"
                            className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-1.5 py-2 w-28">
                          <input type="date" value={item.expiryDate} onChange={(e) => upd(idx, "expiryDate", e.target.value)}
                            className={`w-full border rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400 ${
                              isNearExp ? "border-orange-300 bg-orange-50" : "border-slate-200"
                            }`} />
                        </td>
                        {[{k:"orderedQty",mn:0},{k:"receivedQty",mn:1},{k:"freeQty",mn:0}].map(({k,mn}) => (
                          <td key={k} className="px-1.5 py-2 w-12">
                            <input type="number" value={(item as any)[k]||""} min={mn} onChange={(e) => upd(idx, k as keyof GRNLineItem, +e.target.value)}
                              className="w-full border border-slate-200 rounded px-1 py-1.5 text-[11px] text-center focus:outline-none focus:border-blue-400" />
                          </td>
                        ))}
                        {[{k:"purchaseRate",step:"0.01"},{k:"mrp",step:"0.01"},{k:"discount",step:"0.5"}].map(({k,step}) => (
                          <td key={k} className="px-1.5 py-2 w-20">
                            <input type="number" value={(item as any)[k]||""} step={step} min={0} onChange={(e) => upd(idx, k as keyof GRNLineItem, +e.target.value)}
                              className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" />
                          </td>
                        ))}
                        <td className="px-1.5 py-2 w-14">
                          <select value={item.gstRate} onChange={(e) => upd(idx, "gstRate", +e.target.value)}
                            className="w-full border border-slate-200 rounded px-1 py-1.5 text-[11px] bg-white focus:outline-none focus:border-blue-400">
                            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-[11px] font-semibold text-slate-700 tabular-nums whitespace-nowrap">{currency(amt)}</td>
                        <td className="px-1.5 py-2">
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
                    <td colSpan={10} className="px-3 py-2.5 text-right text-[12px] text-slate-500">
                      Subtotal <span className="font-semibold text-slate-700">{currency(totals.sub)}</span>
                      {"  ·  "}GST <span className="font-semibold text-slate-700">{currency(totals.gst)}</span>
                      {"  ·  "}Total
                    </td>
                    <td className="px-2 py-2.5 text-[14px] font-bold text-slate-900 tabular-nums">{currency(totals.sub + totals.gst)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* ── Near-expiry override card ──────────────────────────────── */}
          {nearExpiryHits.length > 0 && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 overflow-hidden">
              <div className="flex gap-3 p-4">
                <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-orange-900">
                    {nearExpiryHits.length === 1 ? "1 medicine expires" : `${nearExpiryHits.length} medicines expire`} within 90 days
                  </p>
                  <p className="text-[12px] text-orange-700 mt-0.5">
                    Fix the expiry dates above, or accept this stock if you bought it at a discount.
                  </p>

                  <ul className="mt-3 space-y-1.5">
                    {nearExpiryHits.map((h, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                        <span className="text-[12px] font-semibold text-orange-900">{h.name}</span>
                        <span className="text-[11px] text-orange-500 ml-auto flex-shrink-0">
                          {h.days <= 0 ? "expired" : `${h.days}d left`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="border-t border-orange-200 bg-orange-100/60 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-orange-600 leading-snug">
                  Common for short-dated discounted stock.<br />
                  Your inventory report will flag these batches automatically.
                </p>
                <button type="button" onClick={submitWithNearExpiry} disabled={saving}
                  className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-[12px] font-bold shadow-sm disabled:opacity-60 transition-colors">
                  {saving
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Accept &amp; Save GRN
                </button>
              </div>
            </div>
          )}

          {/* ── Generic error banner ───────────────────────────────────── */}
          {error && <ErrorBanner msg={error} />}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-white">
          <span className="text-[12px] text-slate-400">{items.length} line item{items.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 font-medium">
              Cancel
            </button>
            <button type="submit" disabled={saving || items.length === 0}
              className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Save GRN
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
