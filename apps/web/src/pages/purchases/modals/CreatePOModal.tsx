import { useState, useEffect, useRef } from "react";
import { Plus, Loader2, FileText, Trash2, FileSpreadsheet } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "framer-motion";
import type { Supplier, Medicine, POLineItem, FullSupplier } from "../types";
import { GST_RATES } from "../types";
import { currency, csvToPOItems, resolveMedicinesByName, normalizeMedicineName, describeImportResolution } from "../utils";
import { MedicineCombobox } from "../components/MedicineCombobox";
import { ImportPanel } from "../components/ImportPanel";
import { ModalShell, ErrorBanner, FieldLabel, FInput, SmartAddBar, SmartReorderPanel } from "./shared";
import { QuickAddHint } from "./SupplierFormModal";

export function CreatePOModal({ suppliers: initialSuppliers, onClose, onDone, initialMedicine }: {
  suppliers: Supplier[]; onClose: () => void; onDone: (newSupplier?: FullSupplier) => void;
  initialMedicine?: { id: string; name: string; gstRate: number };
}) {
  const [suppliers,    setSuppliers]    = useState<Supplier[]>(initialSuppliers);
  // See CreateGRNModal's identical effect for why this is needed — initialSuppliers
  // can still be empty at mount if the parent's suppliers query hasn't resolved yet.
  useEffect(() => {
    setSuppliers((prev) => {
      const known = new Set(prev.map((s) => s.id));
      const added = initialSuppliers.filter((s) => !known.has(s.id));
      return added.length ? [...prev, ...added] : prev;
    });
  }, [initialSuppliers]);
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
  const [importBanner, setImportBanner] = useState<{ msg: string; tone: "error" | "success" | "info" } | null>(null);
  const [resolving,    setResolving]    = useState(false);
  // Why each still-unlinked imported row is unlinked, keyed by normalized name:
  // "not-found" (searched, genuinely absent) vs "failed" (the lookup errored). Drives
  // per-row wording and whether a Retry is worth offering. See resolveMedicinesByName.
  const [matchIssues,  setMatchIssues]  = useState<Map<string, "not-found" | "failed">>(new Map());
  const [sourceUploadId, setSourceUploadId] = useState<string | undefined>(undefined);
  const [pdfFileName,    setPdfFileName]    = useState<string | null>(null);
  const [pdfUploading,   setPdfUploading]   = useState(false);
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

  // Always uploads the PDF and attaches it to the PO, regardless of whether
  // text extraction below finds a usable item table.
  async function handlePdfSelected(file: File) {
    setPdfUploading(true);
    setImportBanner(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<{ data: { id: string } }>("/uploads/po-pdf", fd);
      setSourceUploadId(data.data.id);
      setPdfFileName(file.name);
    } catch (err) {
      // The PO can still be created without the attachment — but staying silent left
      // the user wondering why their file never attached (e.g. a 12MB scan over the
      // 10MB limit). Surface the server's reason.
      setImportBanner({
        msg: getErrorMessage(err, "Couldn't attach that file — you can still create the PO without it."),
        tone: "error",
      });
    } finally {
      setPdfUploading(false);
    }
  }

  async function handleCSVImport(raw: string) {
    setImportBanner(null);
    const { items: parsed, errors } = csvToPOItems(raw);
    if (parsed.length === 0) {
      setImportBanner({
        msg: errors.length > 0 ? errors.slice(0, 3).join(" · ") : "No valid rows found in the imported data.",
        tone: "error",
      });
      return;
    }
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

    let added: POLineItem[] = [];
    setItems((prev) => {
      const existing = new Set(prev.map((x) => normalizeMedicineName(x.medicineName)));
      added = toAdd.filter((i) => !existing.has(normalizeMedicineName(i.medicineName)));
      return [...prev, ...added];
    });
    setShowImport(false);

    if (added.length === 0) {
      // Everything in the import was already on the order — nothing new to link.
      setImportBanner({
        msg: errors.length > 0
          ? `No new medicines added — they were already on this order. ${errors.length} row(s) skipped.`
          : "Those medicines are already on this order.",
        tone: "info",
      });
      return;
    }

    // An import carries names only. Link them to catalogue entries now so the user
    // isn't handed a table that looks complete but can't be submitted; whatever
    // doesn't resolve is flagged per-row, distinguishing "not in catalogue" from a
    // failed lookup so the message tells them what to actually do.
    const r = await linkImportedRows(added.map((i) => i.medicineName));
    const hasProblem = r.notInCatalogue.length > 0 || r.lookupFailed.length > 0;
    const msg = describeImportResolution({
      imported: added.length,
      skipped: errors.length,
      notInCatalogue: r.notInCatalogue.length,
      lookupFailed: r.lookupFailed.length,
    });
    // error if any row needs the user to act; info if the only caveat was unreadable
    // (skipped) rows; success when everything landed cleanly.
    if (hasProblem) setImportBanner({ msg: msg!, tone: "error" });
    else if (msg) setImportBanner({ msg, tone: "info" });
    else setImportBanner({ msg: `All ${added.length} imported medicine${added.length === 1 ? "" : "s"} matched to your catalogue.`, tone: "success" });
  }

  /**
   * Resolve the given names against the catalogue and link every match onto its row.
   * Shared by the initial import and the Retry action; updates matchIssues so the rows
   * that stay unlinked show the right reason. Returns the raw result for the caller to
   * phrase its own message.
   */
  async function linkImportedRows(names: string[]) {
    setResolving(true);
    try {
      const result = await resolveMedicinesByName(names);
      if (result.resolved.size > 0) {
        setItems((prev) => prev.map((i) => {
          if (i.medicineId) return i;
          const m = result.resolved.get(normalizeMedicineName(i.medicineName));
          return m ? { ...i, medicineId: m.id, gstRate: m.gstRate ?? i.gstRate } : i;
        }));
      }
      setMatchIssues((prev) => {
        const next = new Map(prev);
        result.resolved.forEach((_, n) => next.delete(n));
        result.notInCatalogue.forEach((n) => next.set(n, "not-found"));
        result.lookupFailed.forEach((n) => next.set(n, "failed"));
        return next;
      });
      return result;
    } finally {
      setResolving(false);
    }
  }

  async function retryMatching() {
    const names = items.filter((i) => !i.medicineId).map((i) => i.medicineName);
    if (names.length === 0) return;
    const r = await linkImportedRows(names);
    const stillFailed = r.lookupFailed.length;
    const stillMissing = r.notInCatalogue.length;
    if (stillFailed === 0 && stillMissing === 0) {
      setImportBanner({ msg: "All imported medicines are now matched to your catalogue.", tone: "success" });
    } else {
      setImportBanner({ msg: describeImportResolution({ notInCatalogue: stillMissing, lookupFailed: stillFailed })!, tone: "error" });
    }
  }

  function linkRow(idx: number, m: Medicine) {
    const prevName = items[idx]?.medicineName ?? "";
    setItems((p) => {
      const n = [...p];
      n[idx] = { ...n[idx]!, medicineId: m.id, medicineName: m.name, gstRate: m.gstRate ?? n[idx]!.gstRate };
      return n;
    });
    setMatchIssues((prev) => {
      const key = normalizeMedicineName(prevName);
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setError(null);
  }

  function upd(idx: number, key: keyof POLineItem, val: string | number) {
    setItems((p) => { const n = [...p]; (n[idx] as any)[key] = val; return n; });
  }

  const unlinkedCount = items.filter((i) => !i.medicineId).length;
  // Live count of unlinked rows whose lookup FAILED (vs genuinely not-found) — only these
  // are worth a retry, so the button is offered only when at least one exists.
  const lookupFailedCount = items.filter(
    (i) => !i.medicineId && matchIssues.get(normalizeMedicineName(i.medicineName)) === "failed",
  ).length;

  const totals = items.reduce((a, i) => {
    const sub = i.purchaseRate * i.quantity;
    return { sub: a.sub + sub, gst: a.gst + (sub * i.gstRate) / 100 };
  }, { sub: 0, gst: 0 });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Select a supplier"); return; }
    if (items.length === 0) { setError("Add at least one medicine"); return; }
    // Catch unlinked rows here rather than letting the API reject the whole order with
    // one "items[N].medicineId: must not be blank" per row — 15 of those in a row is
    // unreadable and doesn't say which medicines are actually the problem.
    const unlinked = items.filter((i) => !i.medicineId);
    if (unlinked.length > 0) {
      const names = unlinked.slice(0, 3).map((i) => i.medicineName || "unnamed row").join(", ");
      const more = unlinked.length > 3 ? ` and ${unlinked.length - 3} more` : "";
      // If any are unlinked only because their lookup failed, point at Retry — telling
      // someone to "add it to the catalogue" when it may already be there is wrong.
      const fix = lookupFailedCount > 0
        ? "Use \"Retry matching\", pick each one from the Medicine column, or add it on the Medicines page first."
        : "Pick each one from the dropdown in the Medicine column, or add it on the Medicines page first.";
      setError(`${unlinked.length} item${unlinked.length > 1 ? "s aren't" : " isn't"} linked to your medicine catalogue: ${names}${more}. ${fix}`);
      return;
    }
    setSaving(true); setError(null);
    try {
      await api.post("/purchases/orders", {
        supplierId, invoiceNo: invoiceNo || undefined, notes: notes || undefined,
        expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
        sourceUploadId,
        // Send batch/expiry only when they have real values; API fills in placeholders otherwise.
        // expiryDate may come from pasted/CSV-imported text that isn't a parseable date —
        // guard against that instead of letting toISOString() throw and silently abort the
        // whole submit before any request is even sent.
        items: items.map(({ expiryDate, batchNumber, ...rest }) => {
          const expiryMs = expiryDate ? new Date(expiryDate).getTime() : NaN;
          return {
            ...rest,
            ...(batchNumber ? { batchNumber } : {}),
            ...(!isNaN(expiryMs) ? { expiryDate: new Date(expiryMs).toISOString() } : {}),
          };
        }),
      });
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      setError(getErrorMessage(err, "Failed to create purchase order"));
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
              <ImportPanel type="po" onImport={handleCSVImport} onClose={() => setShowImport(false)}
                allowPdf onPdfSelected={handlePdfSelected} />
            )}
            {(pdfUploading || pdfFileName) && (
              <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-2">
                {pdfUploading ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />Attaching {pdfFileName ?? "PDF"}…</>
                ) : (
                  <><FileSpreadsheet className="w-3 h-3 text-blue-400" />Attached: {pdfFileName} — will be saved with this PO</>
                )}
              </div>
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
            {resolving && (
              <p className="flex items-center gap-2 text-[12px] text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Matching imported medicines to your catalogue…
              </p>
            )}
            {importBanner && (
              <div className="flex items-start gap-3">
                <div className="flex-1"><ErrorBanner msg={importBanner.msg} tone={importBanner.tone} /></div>
                {lookupFailedCount > 0 && !resolving && (
                  <button type="button" onClick={retryMatching}
                    className="flex-shrink-0 mt-0.5 px-3 py-2 rounded-lg border border-orange-300 text-orange-700 text-[12px] font-semibold hover:bg-orange-50 whitespace-nowrap">
                    Retry matching
                  </button>
                )}
              </div>
            )}

            <FieldLabel>Search &amp; Add Medicine (one by one)</FieldLabel>
            <MedicineCombobox onSelect={addMedicine} onClearError={() => setError(null)} />
          </div>

          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Medicine", "Qty", "Est. Buy Rate ₹", "Est. MRP ₹", "GST %", "Est. Amount", ""].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const amt = item.purchaseRate * item.quantity * (1 + item.gstRate / 100);
                    return (
                      <tr key={idx} className={cn("border-b border-slate-100 last:border-0",
                        item.medicineId
                          ? "hover:bg-blue-50/20"
                          : matchIssues.get(normalizeMedicineName(item.medicineName)) === "failed"
                            ? "bg-orange-50/60 hover:bg-orange-50"
                            : "bg-amber-50/50 hover:bg-amber-50")}>
                        <td className="px-3 py-2 max-w-[180px]">
                          <p className="text-[12px] font-semibold text-slate-800 truncate" title={item.medicineName}>{item.medicineName}</p>
                          {!item.medicineId && (() => {
                            // Imported name with no catalogue link — unusable until linked, so
                            // offer the picker inline. Say WHICH problem it is: a failed lookup
                            // ("couldn't check") is transient and retryable; genuinely absent
                            // ("not in catalogue") needs a pick or a catalogue add.
                            const failed = matchIssues.get(normalizeMedicineName(item.medicineName)) === "failed";
                            return (
                              <div className="mt-1">
                                <p className={cn("text-[10px] font-semibold mb-1", failed ? "text-orange-700" : "text-amber-700")}>
                                  {failed ? "Couldn't check catalogue — pick manually or Retry" : "Not in catalogue — pick a match"}
                                </p>
                                <MedicineCombobox onSelect={(m) => linkRow(idx, m)} />
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-2 w-16">
                          <input type="number" value={item.quantity} min={1} onChange={(e) => upd(idx, "quantity", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] text-center focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-24">
                          <input type="number" value={item.purchaseRate || ""} placeholder="Optional" step="0.01" min={0}
                            onChange={(e) => upd(idx, "purchaseRate", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-24">
                          <input type="number" value={item.mrp || ""} placeholder="Optional" step="0.01" min={0}
                            onChange={(e) => upd(idx, "mrp", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-16">
                          <select value={item.gstRate} onChange={(e) => upd(idx, "gstRate", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-1 py-1.5 text-[12px] bg-white focus:outline-none focus:border-blue-400">
                            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-[12px] font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                          {amt > 0 ? currency(amt) : <span className="text-slate-300">—</span>}
                        </td>
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
                    <td colSpan={5} className="px-3 py-2.5 text-right text-[12px] text-slate-500">
                      {totals.sub > 0 ? <>
                        Subtotal <span className="font-semibold text-slate-700">{currency(totals.sub)}</span>
                        {"  ·  "}GST <span className="font-semibold text-slate-700">{currency(totals.gst)}</span>
                        {"  ·  "}Est. Total
                      </> : <span className="italic">Add rates above for estimated order value</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[14px] font-bold text-slate-900 tabular-nums">
                      {totals.sub > 0 ? currency(totals.sub + totals.gst) : ""}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {error && <ErrorBanner msg={error} />}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <span className="text-[12px] text-slate-400">
            {items.length} line item{items.length !== 1 ? "s" : ""}
            {unlinkedCount > 0 && (
              <span className="ml-2 text-amber-700 font-semibold">· {unlinkedCount} need{unlinkedCount === 1 ? "s" : ""} a catalogue match</span>
            )}
          </span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 font-medium">Cancel</button>
            <button type="submit" disabled={saving || resolving || items.length === 0 || unlinkedCount > 0}
              title={unlinkedCount > 0 ? "Link every item to a catalogue medicine first" : undefined}
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
