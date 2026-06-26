

import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle2, RefreshCcw,
  Minus, Plus, Info,
} from "lucide-react";
import { format } from "date-fns";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceItem = {
  id:           string;
  medicineName: string;
  hsnCode:      string | null;
  batchNumber:  string;
  expiryDate:   string;
  quantity:     number;
  mrp:          number;
  rate:         number;
  discount:     number;
  gstRate:      number;
  amount:       number;
};

type Invoice = {
  id:            string;
  invoiceNumber: string;
  createdAt:     string;
  totalAmount:   number;
  returnedAmount: number;
  status:        string;
  isCancelled:   boolean;
  customer:      { name: string; phone: string | null } | null;
  user:          { name: string };
  items:         InvoiceItem[];
  returns:       { id: string; returnNumber: string; totalAmount: number; createdAt: string }[];
};

type ReturnQty = Record<string, number>; // invoiceItemId → qty to return

// ─── Helper ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CreateReturnPage() {
  const { id }  = useParams<{ id: string }>();

  const [invoice,    setInvoice]    = useState<Invoice | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [returnQtys,    setReturnQtys]    = useState<ReturnQty>({});
  const [dispositions,  setDispositions]  = useState<Record<string, "RESTOCK" | "WRITEOFF">>({});
  const [reason,        setReason]        = useState("");
  const [submitting,    setSubmitting]    = useState(false);
  const [submitError,   setSubmitError]   = useState<string | null>(null);
  const [success,       setSuccess]       = useState<{ returnNumber: string; totalAmount: number } | null>(null);

  // Idempotency key — prevents duplicate returns on double-click or network retry
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  // ── Fetch invoice ────────────────────────────────────────────────────────
  const fetchInvoice = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await api.get(`/billing/${id}`);
      setInvoice(data.data);
      // Initialise return quantities to 0 for all items
      const initial: ReturnQty = {};
      for (const item of (data.data as Invoice).items) {
        initial[item.id] = 0;
      }
      setReturnQtys(initial);
    } catch {
      setFetchError("Invoice not found or you don't have access.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  // ── Qty helpers ──────────────────────────────────────────────────────────
  function setQty(itemId: string, val: number, max: number) {
    setReturnQtys((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(max, val)) }));
  }

  function selectAll() {
    if (!invoice) return;
    const all: ReturnQty = {};
    for (const item of invoice.items) {
      all[item.id] = item.quantity;
    }
    setReturnQtys(all);
  }

  function clearAll() {
    if (!invoice) return;
    const clear: ReturnQty = {};
    for (const item of invoice.items) { clear[item.id] = 0; }
    setReturnQtys(clear);
  }

  // ── Computed totals ──────────────────────────────────────────────────────
  const selectedItems = invoice?.items.filter((i) => (returnQtys[i.id] ?? 0) > 0) ?? [];
  const returnTotal   = selectedItems.reduce((sum, item) => {
    const qty   = returnQtys[item.id] ?? 0;
    const ratio = qty / item.quantity;
    return sum + item.amount * ratio;
  }, 0);

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (selectedItems.length === 0) {
      setSubmitError("Select at least one item to return.");
      return;
    }
    if (!reason.trim()) {
      setSubmitError("Return reason is required.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await api.post(`/billing/${id}/returns`, {
        reason,
        idempotencyKey: idempotencyKeyRef.current,
        items: selectedItems.map((item) => ({
          invoiceItemId: item.id,
          quantity:      returnQtys[item.id],
          disposition:   dispositions[item.id] ?? "RESTOCK",
        })),
      });
      setSuccess({ returnNumber: data.data.returnNumber, totalAmount: data.data.totalAmount });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSubmitError(msg ?? "Failed to process return. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        <p className="text-slate-400 text-[13px] mt-3">Loading invoice…</p>
      </div>
    );
  }

  if (fetchError || !invoice) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-white gap-3">
        <AlertCircle className="w-10 h-10 text-red-300" />
        <p className="text-slate-600 text-[14px] font-medium">{fetchError ?? "Invoice not found"}</p>
        <Link to="/dashboard/billing" className="text-blue-600 text-[13px] hover:underline flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Sales
        </Link>
      </div>
    );
  }

  if (invoice.isCancelled || invoice.status === "CANCELLED") {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-white gap-3">
        <AlertCircle className="w-10 h-10 text-slate-300" />
        <p className="text-slate-600 text-[14px] font-medium">Cancelled invoices cannot be returned.</p>
        <Link to={`/dashboard/billing/${id}`} className="text-blue-600 text-[13px] hover:underline flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Invoice
        </Link>
      </div>
    );
  }

  if (invoice.status === "RETURNED") {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-white gap-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-300" />
        <p className="text-slate-600 text-[14px] font-medium">This invoice has already been fully returned.</p>
        <Link to={`/dashboard/billing/${id}`} className="text-blue-600 text-[13px] hover:underline flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Invoice
        </Link>
      </div>
    );
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-white gap-5">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <div className="text-center">
            <h2 className="text-[18px] font-bold text-slate-900">Return Processed</h2>
            <p className="text-[14px] text-slate-500 mt-1">
              Credit Note <span className="font-semibold text-slate-700">{success.returnNumber}</span> created
            </p>
            <p className="text-[22px] font-bold text-rose-600 mt-2">
              − ₹{success.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="flex gap-3 mt-2">
            <Link to="/dashboard/billing?tab=returns"
              className="px-5 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-600 hover:bg-slate-50 transition-colors">
              View All Returns
            </Link>
            <Link to={`/dashboard/billing/${id}`}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-[13px] text-white font-semibold transition-colors">
              Back to Invoice
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  const remainingAmount = invoice.totalAmount - invoice.returnedAmount;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full bg-[#f7f9fc] overflow-auto"
    >
      {/* Sub-nav */}
      <div className="flex items-center justify-between px-5 h-[52px] bg-white border-b border-slate-200 flex-shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Link to={`/dashboard/billing/${id}`} className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            {invoice.invoiceNumber}
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5">
            <RefreshCcw className="w-3.5 h-3.5 text-rose-500" />
            Return
          </span>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <span>Patient: <strong className="text-slate-700">{invoice.customer?.name ?? "Walk-in"}</strong></span>
          <span className="text-slate-300">·</span>
          <span>Bill Total: <strong className="text-slate-700">₹{invoice.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>
          {invoice.returnedAmount > 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-rose-600">Already Returned: <strong>₹{invoice.returnedAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 p-5 max-w-5xl mx-auto w-full">

        {/* Info bar */}
        {invoice.status === "PARTIALLY_RETURNED" && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-[13px] text-amber-700">
            <Info className="w-4 h-4 flex-shrink-0" />
            This invoice has been partially returned. Remaining: <strong>₹{remainingAmount.toFixed(2)}</strong>. You may return the remaining items.
          </div>
        )}

        {/* Item selection table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h2 className="text-[13px] font-bold text-slate-700">Select Items to Return</h2>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-[12px] text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors">
                Select All
              </button>
              <button onClick={clearAll} className="text-[12px] text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-50 transition-colors">
                Clear
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Medicine</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Batch</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Expiry</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600">MRP</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Sold Qty</th>
                  <th className="px-4 py-2.5 text-center font-semibold text-slate-600">Return Qty</th>
                  <th className="px-4 py-2.5 text-center font-semibold text-slate-600 whitespace-nowrap" title="Restock = add back to inventory. Write-off = item is damaged/unusable.">Disposition</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Return Amt.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {invoice.items.map((item) => {
                  const returnQty   = returnQtys[item.id] ?? 0;
                  const ratio       = item.quantity > 0 ? returnQty / item.quantity : 0;
                  const returnAmt   = parseFloat((item.amount * ratio).toFixed(2));
                  const isSelected  = returnQty > 0;

                  return (
                    <tr
                      key={item.id}
                      className={cn("border-b border-slate-50 transition-colors", isSelected ? "bg-blue-50/70" : "bg-white")}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">
                        <div>{item.medicineName}</div>
                        {item.hsnCode && <div className="text-[11px] text-slate-400 font-mono">HSN {item.hsnCode}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-[11px]">{item.batchNumber}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {format(new Date(item.expiryDate), "MM/yy")}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{fmt(item.mrp)}</td>
                      <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setQty(item.id, returnQty - 1, item.quantity)}
                            className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors disabled:opacity-40"
                            disabled={returnQty === 0}
                          >
                            <Minus className="w-3 h-3 text-slate-600" />
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={item.quantity}
                            value={returnQty === 0 ? "" : returnQty}
                            onChange={(e) => setQty(item.id, Number(e.target.value) || 0, item.quantity)}
                            onFocus={(e) => e.target.select()}
                            placeholder="0"
                            className={cn(
                              "w-14 text-center text-[14px] font-bold tabular-nums border rounded-md px-1.5 py-1",
                              "focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400",
                              isSelected
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-600"
                            )}
                          />
                          <button
                            onClick={() => setQty(item.id, returnQty + 1, item.quantity)}
                            className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors disabled:opacity-40"
                            disabled={returnQty >= item.quantity}
                          >
                            <Plus className="w-3 h-3 text-slate-600" />
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 text-center mt-0.5">max {item.quantity}</p>
                      </td>
                      {/* Disposition toggle — only shown when item is selected */}
                      <td className="px-4 py-3">
                        {isSelected ? (
                          <div className="flex rounded-lg border border-slate-200 overflow-hidden mx-auto w-fit">
                            {(["RESTOCK", "WRITEOFF"] as const).map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setDispositions((prev) => ({ ...prev, [item.id]: d }))}
                                className={cn(
                                  "px-2.5 py-1 text-[10px] font-bold transition-all whitespace-nowrap",
                                  (dispositions[item.id] ?? "RESTOCK") === d
                                    ? d === "RESTOCK"
                                      ? "bg-emerald-600 text-white"
                                      : "bg-red-500 text-white"
                                    : "bg-white text-slate-400 hover:text-slate-600",
                                )}
                              >
                                {d === "RESTOCK" ? "↩ Restock" : "✕ Write-off"}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-[12px] text-center block">—</span>
                        )}
                      </td>
                      <td className={cn(
                        "px-4 py-3 text-right font-semibold tabular-nums",
                        isSelected ? "text-rose-600" : "text-slate-300"
                      )}>
                        {isSelected ? `− ${fmt(returnAmt)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Reason + Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Reason input */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <label className="text-[12px] font-semibold text-slate-600 uppercase tracking-wide block mb-2">
              Return Reason <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Patient didn't need the medicine, wrong medicine dispensed, damaged packaging…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 resize-none"
            />
          </div>

          {/* Return summary */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-[12px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Return Summary</p>

            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between text-slate-600">
                <span>Selected Items</span>
                <span className="font-semibold">{selectedItems.length} medicine{selectedItems.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Total Qty to Return</span>
                <span className="font-semibold tabular-nums">
                  {selectedItems.reduce((s, i) => s + (returnQtys[i.id] ?? 0), 0)}
                </span>
              </div>
              <div className="border-t border-slate-100 pt-2 flex justify-between font-bold text-[15px]">
                <span className="text-slate-700">Refund Amount</span>
                <span className={cn("tabular-nums", selectedItems.length > 0 ? "text-rose-600" : "text-slate-300")}>
                  − {fmt(parseFloat(returnTotal.toFixed(2)))}
                </span>
              </div>
            </div>

            {/* Error */}
            <AnimatePresence>
              {submitError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2 mt-3 p-3 bg-red-50 border border-red-100 rounded-lg text-[12px] text-red-700">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {submitError}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={handleSubmit}
              disabled={submitting || selectedItems.length === 0 || !reason.trim()}
              className={cn(
                "w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-bold transition-colors",
                submitting || selectedItems.length === 0 || !reason.trim()
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-rose-600 hover:bg-rose-700 text-white"
              )}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? "Processing Return…" : `Process Return − ${fmt(parseFloat(returnTotal.toFixed(2)))}`}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
