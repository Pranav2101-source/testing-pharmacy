import { useState, useEffect, useRef } from "react";
import { Plus, Loader2, Truck, Trash2, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import type { Supplier, Medicine, GRNLineItem, FullSupplier } from "../types";
import { GST_RATES } from "../types";
import { currency } from "../utils";
import { MedicineCombobox } from "../components/MedicineCombobox";
import { BulkImportPanel } from "../components/BulkImportPanel";
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
  poId: string, notes: string, items: GRNLineItem[], allowNearExpiry: boolean,
  sourceUploadId?: string,
) {
  return {
    supplierId,
    supplierInvoiceNo:   invNo   || undefined,
    supplierInvoiceDate: invDate ? new Date(invDate).toISOString() : undefined,
    purchaseOrderId:     poId    || undefined,
    notes:               notes   || undefined,
    allowNearExpiry,
    sourceUploadId,
    items: items.map((i) => ({ ...i, expiryDate: new Date(i.expiryDate).toISOString() })),
  };
}

function isTabularText(text: string): boolean {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines.length >= 2 && (text.includes("\t") || (lines[0]?.split(",").length ?? 0) >= 3);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CreateGRNModal({ suppliers: initialSuppliers, onClose, onDone }: {
  suppliers: Supplier[]; onClose: () => void; onDone: (newSupplier?: FullSupplier) => void;
}) {
  const [suppliers,      setSuppliers]     = useState<Supplier[]>(initialSuppliers);
  const [supplierId,     setSupplierId]    = useState("");
  const [invNo,          setInvNo]         = useState("");
  const [invDate,        setInvDate]       = useState("");
  const [poId,           setPoId]          = useState("");
  const [notes,          setNotes]         = useState("");
  const [items,          setItems]         = useState<GRNLineItem[]>([]);
  const [saving,         setSaving]        = useState(false);
  const [error,          setError]         = useState<string | null>(null);
  const [showBulkImport, setShowBulkImport]= useState(false);
  const [pasteRaw,       setPasteRaw]      = useState("");
  const [copyLoading,    setCopyLoading]   = useState(false);
  const [poLoading,      setPoLoading]     = useState(false);
  const [poOptions,      setPoOptions]     = useState<{ id: string; orderNumber: string; itemCount: number }[]>([]);
  const [nearExpiryHits, setNearExpiryHits]= useState<NearExpiryHit[]>([]);
  const [sourceUploadId, setSourceUploadId]= useState<string | undefined>(undefined);
  const [pdfFileName,    setPdfFileName]   = useState<string | null>(null);
  const [pdfUploading,   setPdfUploading]  = useState(false);
  const lastAddedSupplier = useRef<FullSupplier | undefined>(undefined);

  const nearExpiryNames = new Set(nearExpiryHits.map((h) => h.name.toLowerCase()));

  // ── Global Ctrl+V handler (Option B) ──────────────────────────────────────
  // When the user presses Ctrl+V anywhere in the modal (not inside a text
  // input), and the clipboard looks like tabular data (Excel/Sheets copy),
  // we capture it and open the BulkImportPanel pre-loaded with that data.

  useEffect(() => {
    function onGlobalPaste(e: ClipboardEvent) {
      const tag = (e.target as Element)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!isTabularText(text)) return;
      e.preventDefault();
      setPasteRaw(text);
      setShowBulkImport(true);
    }
    document.addEventListener("paste", onGlobalPaste);
    return () => document.removeEventListener("paste", onGlobalPaste);
  }, []);

  // ── Load pending POs when supplier changes ────────────────────────────────

  function loadPOOptions(sid: string) {
    if (!sid) { setPoOptions([]); return; }
    api.get("/purchases/orders", { params: { supplierId: sid, status: "PENDING", limit: 20 } })
      .then(({ data }) => setPoOptions((data.data.items ?? []).map((po: any) => ({
        id: po.id, orderNumber: po.orderNumber, itemCount: po._count?.items ?? 0,
      }))))
      .catch(() => setPoOptions([]));
  }

  // ── Add helpers ───────────────────────────────────────────────────────────

  function addMed(m: Medicine) {
    setItems((p) => [...p, {
      medicineId: m.id, medicineName: m.name,
      batchNumber: "", expiryDate: "",
      orderedQty: 0, receivedQty: 1, freeQty: 0,
      purchaseRate: 0, mrp: 0, discount: 0, gstRate: m.gstRate,
    }]);
  }

  // Always uploads the PDF and attaches it to the GRN, regardless of whether
  // text extraction below finds a usable item table — per design, a PDF
  // (even a scanned one we can't parse) is never just discarded.
  async function handlePdfSelected(file: File) {
    setPdfUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<{ data: { id: string } }>("/uploads/grn-pdf", fd);
      setSourceUploadId(data.data.id);
      setPdfFileName(file.name);
    } catch {
      // Non-fatal — GRN creation still works without the attachment.
    } finally {
      setPdfUploading(false);
    }
  }

  function handleBulkImport(incoming: GRNLineItem[]) {
    setItems((prev) => {
      const existing = new Set(prev.map((x) => `${x.medicineName.toLowerCase()}::${x.batchNumber}`));
      const fresh = incoming.filter(
        (i) => !existing.has(`${i.medicineName.toLowerCase()}::${i.batchNumber}`),
      );
      return [...prev, ...fresh];
    });
    setShowBulkImport(false);
    setPasteRaw("");
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

  function upd(idx: number, key: keyof GRNLineItem, val: string | number) {
    setItems((p) => { const n = [...p]; (n[idx] as any)[key] = val; return n; });
    if (nearExpiryHits.length > 0) setNearExpiryHits([]);
  }

  const totals = items.reduce((a, i) => {
    const sub = i.purchaseRate * i.receivedQty * (1 - i.discount / 100);
    return { sub: a.sub + sub, gst: a.gst + (sub * i.gstRate) / 100 };
  }, { sub: 0, gst: 0 });

  // ── Validation ────────────────────────────────────────────────────────────

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

  // ── Submit (normal) ───────────────────────────────────────────────────────

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (errs.length > 0) { setError(errs.join("  ·  ")); return; }

    setSaving(true); setError(null); setNearExpiryHits([]);
    try {
      await api.post("/purchases/grn", buildPayload(supplierId, invNo, invDate, poId, notes, items, false, sourceUploadId));
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      const msg: string = err?.response?.data?.error ?? "";
      if (msg.includes("expire within")) {
        const threshold = new Date(Date.now() + NEAR_EXPIRY_DAYS * 86_400_000);
        const hits = items
          .filter((i) => i.expiryDate && new Date(i.expiryDate) <= threshold)
          .map((i) => ({ name: i.medicineName, date: i.expiryDate, days: daysUntil(i.expiryDate) }));
        setNearExpiryHits(hits);
      } else {
        setError(msg || getErrorMessage(err, "Failed to create GRN"));
      }
    } finally { setSaving(false); }
  }

  // ── Submit with near-expiry override ─────────────────────────────────────

  async function submitWithNearExpiry() {
    const errs = validate();
    if (errs.length > 0) { setNearExpiryHits([]); setError(errs.join("  ·  ")); return; }

    setSaving(true); setNearExpiryHits([]); setError(null);
    try {
      await api.post("/purchases/grn", buildPayload(supplierId, invNo, invDate, poId, notes, items, true, sourceUploadId));
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to create GRN"));
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
              <QuickAddHint suppliers={suppliers} onAdded={(s) => {
                lastAddedSupplier.current = s;
                setSuppliers((p) => [...p, s]);
                setSupplierId(s.id);
                loadPOOptions(s.id);
              }} />
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

          {/* ── Smart add bar ──────────────────────────────────────────── */}
          <SmartAddBar
            type="grn"
            supplierId={supplierId}
            onImportCSV={() => { setPasteRaw(""); setShowBulkImport((v) => !v); }}
            onCopyLast={copyLastPurchase}
            onLoadFromPO={loadFromPO}
            poOptions={poOptions}
            selectedPoId={poId}
            onPoChange={(id) => setPoId(id)}
            onScan={handleBarcodeScan}
            loadingCopy={copyLoading}
            loadingPO={poLoading}
          />

          {/* ── Bulk import panel (Option A + B) ───────────────────────── */}
          {showBulkImport && (
            <BulkImportPanel
              initialRaw={pasteRaw}
              onImport={handleBulkImport}
              onClose={() => { setShowBulkImport(false); setPasteRaw(""); }}
              onPdfSelected={handlePdfSelected}
            />
          )}

          {/* ── Attached supplier PDF indicator ────────────────────────── */}
          {(pdfUploading || pdfFileName) && (
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              {pdfUploading ? (
                <><Loader2 className="w-3 h-3 animate-spin" />Attaching {pdfFileName ?? "PDF"}…</>
              ) : (
                <><FileSpreadsheet className="w-3 h-3 text-blue-400" />Attached: {pdfFileName} — will be saved with this GRN</>
              )}
            </div>
          )}

          {/* ── Ctrl+V hint (shown when panel is closed + items exist) ─── */}
          {!showBulkImport && items.length === 0 && (
            <button type="button"
              onClick={() => setShowBulkImport(true)}
              className="w-full flex items-center justify-center gap-2.5 border-2 border-dashed border-blue-200 rounded-xl py-5 text-blue-500 hover:border-blue-400 hover:bg-blue-50/40 transition-colors group">
              <FileSpreadsheet className="w-5 h-5 text-blue-400 group-hover:text-blue-500" />
              <div className="text-left">
                <p className="text-[13px] font-semibold">Import from Excel, CSV or paste</p>
                <p className="text-[11px] text-blue-400 font-normal mt-0.5">
                  Or press <kbd className="px-1 py-0.5 bg-blue-100 border border-blue-200 rounded text-[10px] font-mono">Ctrl+V</kbd> anywhere with Excel cells copied
                </p>
              </div>
            </button>
          )}

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
                    const sub       = item.purchaseRate * item.receivedQty * (1 - item.discount / 100);
                    const amt       = sub + (sub * item.gstRate) / 100;
                    const isNearExp = nearExpiryNames.has(item.medicineName.toLowerCase());
                    const missBatch = !item.batchNumber.trim();
                    const missExp   = !item.expiryDate;
                    return (
                      <tr key={idx} className={`border-b border-slate-100 last:border-0 transition-colors ${
                        isNearExp ? "bg-orange-50 hover:bg-orange-50/80" : "hover:bg-emerald-50/20"
                      }`}>
                        <td className="px-2 py-2 max-w-[110px]">
                          <div className="flex items-center gap-1.5">
                            {isNearExp && <AlertTriangle className="w-3 h-3 text-orange-500 flex-shrink-0" />}
                            <p className="text-[11px] font-semibold text-slate-800 truncate">{item.medicineName}</p>
                          </div>
                        </td>
                        <td className="px-1.5 py-2 w-20">
                          <input value={item.batchNumber} onChange={(e) => upd(idx, "batchNumber", e.target.value)}
                            placeholder="Batch"
                            className={`w-full border rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400 ${
                              missBatch ? "border-amber-300 bg-amber-50 placeholder-amber-400" : "border-slate-200"
                            }`} />
                        </td>
                        <td className="px-1.5 py-2 w-28">
                          <input type="date" value={item.expiryDate} onChange={(e) => upd(idx, "expiryDate", e.target.value)}
                            className={`w-full border rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400 ${
                              isNearExp ? "border-orange-300 bg-orange-50" :
                              missExp   ? "border-amber-300 bg-amber-50"   : "border-slate-200"
                            }`} />
                        </td>
                        {[{k:"orderedQty",mn:0},{k:"receivedQty",mn:1},{k:"freeQty",mn:0}].map(({k,mn}) => (
                          <td key={k} className="px-1.5 py-2 w-12">
                            <input type="number" value={(item as any)[k]||""} min={mn}
                              onChange={(e) => upd(idx, k as keyof GRNLineItem, +e.target.value)}
                              className="w-full border border-slate-200 rounded px-1 py-1.5 text-[11px] text-center focus:outline-none focus:border-blue-400" />
                          </td>
                        ))}
                        {[{k:"purchaseRate",step:"0.01"},{k:"mrp",step:"0.01"},{k:"discount",step:"0.5"}].map(({k,step}) => (
                          <td key={k} className="px-1.5 py-2 w-20">
                            <input type="number" value={(item as any)[k]||""} step={step} min={0}
                              onChange={(e) => upd(idx, k as keyof GRNLineItem, +e.target.value)}
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
                  These batches will appear in your near-expiry report automatically.
                </p>
                <button type="button" onClick={submitWithNearExpiry} disabled={saving}
                  className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-[12px] font-bold shadow-sm disabled:opacity-60 transition-colors">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Accept &amp; Save GRN
                </button>
              </div>
            </div>
          )}

          {error && <ErrorBanner msg={error} />}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-slate-400">{items.length} line item{items.length !== 1 ? "s" : ""}</span>
            {items.length > 0 && !showBulkImport && (
              <button type="button" onClick={() => { setPasteRaw(""); setShowBulkImport(true); }}
                className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-700 font-medium">
                <FileSpreadsheet className="w-3 h-3" />Add more via import
              </button>
            )}
          </div>
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
