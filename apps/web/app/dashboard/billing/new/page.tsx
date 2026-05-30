"use client";

import { useState, useMemo, useCallback, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ChevronRight, Lightbulb, ChevronDown, ChevronUp,
  Bell, Truck, Settings, Calculator, Loader2,
  UserCircle2, Wallet, XCircle, BookmarkCheck, RotateCcw, X, MonitorSmartphone,
} from "lucide-react";
import { BillHeader } from "@/components/billing/BillHeader";
import { CartTableHeader, CartTableRows } from "@/components/billing/CartTable";
import { MedicineSearchCombobox } from "@/components/billing/MedicineSearchCombobox";
import { useBillingStore } from "@/components/billing/useBillingStore";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { saveDraft, getDraft, deleteDraft } from "@/lib/draftStorage";
import { saveSession, loadSession, clearSession, type AutoSaveSession } from "@/lib/autoSave";
import type { PrintInvoiceData } from "@/components/billing/InvoicePrintView";

const InvoicePrintView = dynamic(
  () => import("@/components/billing/InvoicePrintView").then((m) => ({ default: m.InvoicePrintView })),
  { ssr: false }
);

const PAY_LABELS: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", CREDIT: "Credit" };

// ─── Error → conflict mapping ─────────────────────────────────────────────────
// Parses backend error messages to find the specific cart item that caused the failure.
import type { CartItem } from "@/components/billing/useBillingStore";

function extractConflictIds(msg: string, items: CartItem[]): Set<string> {
  const byName = (name: string) =>
    items.find((i) => i.medicineName.toLowerCase() === name.toLowerCase())?.inventoryId;

  // "Insufficient stock for "NAME": N available, M requested"
  const insuff = msg.match(/Insufficient stock for "(.+?)":/);
  if (insuff) { const id = byName(insuff[1]); if (id) return new Set([id]); }

  // "Inventory item not found: UUID"  (batch was deleted while bill was open)
  const notFound = msg.match(/Inventory item not found: ([a-f0-9-]{36})/i);
  if (notFound) {
    const id = notFound[1];
    if (items.some((i) => i.inventoryId === id)) return new Set([id]);
  }

  // "Batch "X" of "NAME" expired on …"
  const expired = msg.match(/Batch ".+?" of "(.+?)" expired/);
  if (expired) { const id = byName(expired[1]); if (id) return new Set([id]); }

  // "Medicine "NAME" is inactive …"
  const inactive = msg.match(/Medicine "(.+?)" is inactive/);
  if (inactive) { const id = byName(inactive[1]); if (id) return new Set([id]); }

  return new Set();
}

// ─── Sub-navigation bar ───────────────────────────────────────────────────────

function BillingSubNav({
  onSave,
  onSaveDraft,
  submitting,
  hasItems,
  paymentMode,
  onPaymentMode,
}: {
  onSave: () => void;
  onSaveDraft: () => void;
  submitting: boolean;
  hasItems: boolean;
  paymentMode: "CASH" | "UPI" | "CARD" | "CREDIT";
  onPaymentMode: (m: "CASH" | "UPI" | "CARD" | "CREDIT") => void;
}) {
  const [showPayDrop, setShowPayDrop]   = useState(false);
  const [showSaveDrop, setShowSaveDrop] = useState(false);

  return (
    <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 bg-white flex-shrink-0">
      {/* Breadcrumb — "Sales" navigates back to the billing dashboard */}
      <div className="flex items-center gap-1.5">
        <Link
          href="/dashboard/billing"
          className="text-blue-600 text-[15px] font-medium hover:underline"
        >
          Sales
        </Link>
        <ChevronRight className="w-4 h-4 text-slate-400" />
        <span className="text-blue-600 text-[15px] font-semibold">New</span>
        <div className="w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center ml-1 shadow-sm">
          <Lightbulb className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Owner */}
        <button className="flex items-center gap-1.5 text-[14px] text-slate-700 font-medium border border-slate-200 rounded-md px-3 py-2 hover:bg-slate-50 transition-colors">
          <UserCircle2 className="w-[18px] h-[18px] text-slate-500" />
          Owner
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>

        {/* Payment method dropdown */}
        <div
          className="relative"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowPayDrop(false);
          }}
        >
          <button
            onClick={() => setShowPayDrop((v) => !v)}
            className="flex items-center gap-1.5 text-[14px] text-slate-700 font-medium border border-slate-200 rounded-md px-3 py-2 hover:bg-slate-50 transition-colors"
          >
            <Wallet className="w-[18px] h-[18px] text-slate-500" />
            {PAY_LABELS[paymentMode] ?? "Cash"}
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>
          {showPayDrop && (
            <div className="absolute top-full mt-1 left-0 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 min-w-[110px]">
              {(["CASH", "UPI", "CARD", "CREDIT"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { onPaymentMode(m); setShowPayDrop(false); }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50 transition-colors",
                    paymentMode === m && "text-blue-600 font-semibold bg-blue-50/50"
                  )}
                >
                  {PAY_LABELS[m]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Set Reminder */}
        <button className="flex items-center gap-1.5 text-[14px] text-slate-600 font-medium border border-slate-200 rounded-md px-3 py-2 hover:bg-slate-50 transition-colors">
          <Bell className="w-[18px] h-[18px] text-slate-500" />
          Set Reminder
        </button>

        {/* Pickup */}
        <button className="flex items-center gap-1.5 text-[14px] text-slate-700 font-medium border border-slate-200 rounded-md px-3 py-2 hover:bg-slate-50 transition-colors">
          <Truck className="w-[18px] h-[18px] text-slate-500" />
          Pickup
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>

        <div className="h-5 w-px bg-slate-200" />

        {/* Save / Proceed split button */}
        <div
          className="relative flex items-stretch"
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowSaveDrop(false); }}
        >
          <button
            onClick={onSave}
            disabled={submitting || !hasItems}
            className={cn(
              "flex items-center gap-1.5 text-[15px] font-bold px-5 py-2 rounded-l-md transition-colors active:scale-[0.98]",
              hasItems
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-blue-300 text-white cursor-not-allowed"
            )}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
          <button
            onClick={() => hasItems && setShowSaveDrop((v) => !v)}
            className={cn(
              "flex items-center justify-center px-2 rounded-r-md border-l transition-colors",
              hasItems
                ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-500"
                : "bg-blue-300 text-white border-blue-200 cursor-not-allowed"
            )}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          {showSaveDrop && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-1 min-w-[170px]">
              <button
                onClick={() => { onSaveDraft(); setShowSaveDrop(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-slate-700 hover:bg-amber-50 transition-colors"
              >
                <BookmarkCheck className="w-4 h-4 text-amber-500" />
                Save as Draft
              </button>
            </div>
          )}
        </div>

        {/* Settings */}
        <button className="w-9 h-9 rounded-md border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors">
          <Settings className="w-5 h-5 text-slate-600" />
        </button>
      </div>
    </div>
  );
}

// ─── New Bill page ─────────────────────────────────────────────────────────────

function NewBillInner() {
  const { items, meta, clear, getTotals, setMeta, loadDraft } = useBillingStore();
  const searchParams = useSearchParams();
  const router       = useRouter();
  const [submitting,           setSubmitting]           = useState(false);
  const [error,                setError]                = useState<string | null>(null);
  const [conflictInventoryIds, setConflictInventoryIds] = useState<Set<string>>(new Set());
  const [invoice, setInvoice] = useState<PrintInvoiceData | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [lifa, setLifa] = useState(true);
  const [savedInvoiceId, setSavedInvoiceId] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [draftToast, setDraftToast] = useState<string | null>(null);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);

  // Crash / refresh recovery
  const [sessionRecovery, setSessionRecovery] = useState<AutoSaveSession | null>(null);
  // Multi-tab awareness
  const [multiTabNotice, setMultiTabNotice] = useState<string | null>(null);

  // Idempotency key — prevents duplicate invoices on double-click or network retry
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  // Keep items in a ref so the BroadcastChannel handler isn't stale
  const itemsRef          = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Debounced stock reservation — keeps reservedQuantity in sync while building the cart
  const reservationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (reservationTimer.current) clearTimeout(reservationTimer.current);
    if (items.length === 0) return;
    reservationTimer.current = setTimeout(() => {
      api.post("/inventory/reserve", {
        sessionId: idempotencyKeyRef.current,
        items: items.map((i) => ({ inventoryId: i.inventoryId, quantity: i.quantity })),
      }).catch(() => { /* best-effort; authoritative check is at bill save */ });
    }, 500);
    return () => { if (reservationTimer.current) clearTimeout(reservationTimer.current); };
  }, [items]);

  // Release reservation on unmount (navigation away, tab close)
  useEffect(() => {
    return () => {
      api.delete(`/inventory/reserve/${idempotencyKeyRef.current}`).catch(() => {});
    };
  }, []);

  // Debounced auto-save to localStorage (session recovery)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (items.length === 0) return;
    autoSaveTimer.current = setTimeout(() => saveSession(items, meta), 1500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [items, meta]);

  // Mount: load draft from URL OR offer session recovery; wire BroadcastChannel
  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (draftId) {
      const draft = getDraft(draftId);
      if (draft) {
        loadDraft(draft.items, draft.meta);
        setLoadedDraftId(draftId);
      }
      router.replace("/dashboard/billing/new", { scroll: false });
    } else if (items.length === 0) {
      // Only offer recovery when cart is empty (a loaded draft takes priority)
      const session = loadSession();
      if (session) setSessionRecovery(session);
    }

    // Multi-tab: when another tab saves a bill, clear this tab's cart
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel("checkup_billing");
      ch.onmessage = (e) => {
        if (e.data?.type === "bill_saved" && itemsRef.current.length > 0) {
          clear();
          clearSession();
          setMultiTabNotice("A bill was saved in another tab — this tab's cart was cleared.");
        }
      };
      return () => ch.close();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveDraft = useCallback(() => {
    if (items.length === 0) return;
    api.delete(`/inventory/reserve/${idempotencyKeyRef.current}`).catch(() => {});
    const draft = saveDraft(items, meta);
    if (loadedDraftId) deleteDraft(loadedDraftId);
    clearSession();
    setDraftToast(`Draft "${draft.label}" saved`);
    clear();
    setTimeout(() => setDraftToast(null), 3000);
  }, [items, meta, loadedDraftId, clear]);

  const totals       = useMemo(() => getTotals(), [getTotals, items]);
  const totalQty     = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const roundedTotal = Math.round(totals.totalAmount);

  const handleSave = useCallback(async () => {
    if (items.length === 0) return;
    setSubmitting(true);
    setError(null);
    setConflictInventoryIds(new Set());
    try {
      const { data } = await api.post<{ data: { id: string; invoiceNumber: string; createdAt: string } }>("/billing", {
        idempotencyKey: idempotencyKeyRef.current,
        doctorName:    meta.doctorName    || undefined,
        paymentMode:   meta.paymentMode,
        paymentStatus: meta.paymentStatus,
        notes:         meta.notes         || undefined,
        items: items.map((i) => ({
          inventoryId: i.inventoryId,
          quantity:    i.quantity,
          discount:    i.discount,
        })),
      });
      const printData: PrintInvoiceData = {
        invoiceNumber: data.data.invoiceNumber,
        createdAt:     data.data.createdAt,
        customerName:  meta.customerName  || undefined,
        customerPhone: meta.customerPhone || undefined,
        doctorName:    meta.doctorName    || undefined,
        paymentMode:   meta.paymentMode,
        paymentStatus: meta.paymentStatus,
        items:         items.map((i) => ({ ...i })),
        subtotal:      totals.subtotal,
        discountAmount: totals.discountAmount,
        taxableAmount: totals.taxableAmount,
        cgst:          totals.cgst,
        sgst:          totals.sgst,
        totalGst:      totals.totalGst,
        totalAmount:   roundedTotal,
      };
      // Cleanup draft + session + regenerate idempotency key for next bill
      if (loadedDraftId) { deleteDraft(loadedDraftId); setLoadedDraftId(null); }
      clearSession();
      idempotencyKeyRef.current = crypto.randomUUID();

      // Notify other tabs that a bill was saved
      if (typeof BroadcastChannel !== "undefined") {
        new BroadcastChannel("checkup_billing").postMessage({ type: "bill_saved" });
      }

      setSavedInvoiceId(data.data.id);
      setInvoice(printData);
      setShowPrint(true);
      clear();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })
        ?.response?.data?.message
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      const errorMsg = msg ?? "Failed to save invoice. Please try again.";
      setError(errorMsg);
      // Highlight the specific cart item that caused the failure
      const conflicts = extractConflictIds(errorMsg, items);
      if (conflicts.size > 0) setConflictInventoryIds(conflicts);
    } finally {
      setSubmitting(false);
    }
  }, [items, meta, totals, roundedTotal, loadedDraftId, clear]);

  const handleCancel = useCallback(async () => {
    if (!savedInvoiceId || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      await api.patch(`/billing/${savedInvoiceId}/cancel`, { reason: cancelReason });
      setShowPrint(false);
      setInvoice(null);
      setSavedInvoiceId(null);
      setCancelConfirm(false);
      setCancelReason("");
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })
        ?.response?.data?.message
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Failed to cancel invoice.");
    } finally {
      setCancelling(false);
    }
  }, [savedInvoiceId, cancelReason]);

  function closePrint() {
    setShowPrint(false);
    setInvoice(null);
    setSavedInvoiceId(null);
    setCancelConfirm(false);
    setCancelReason("");
  }

  return (
    <>
      {/* Print-only layer */}
      {invoice && (
        <div className="hidden print:block">
          <InvoicePrintView invoice={invoice} />
        </div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="print:hidden flex flex-col h-full overflow-hidden bg-white"
      >
        {/* Zone 1: Sub-nav */}
        <BillingSubNav
          onSave={handleSave}
          onSaveDraft={handleSaveDraft}
          submitting={submitting}
          hasItems={items.length > 0}
          paymentMode={meta.paymentMode}
          onPaymentMode={(m) => setMeta({ paymentMode: m })}
        />

        {/* Draft saved toast */}
        <AnimatePresence>
          {draftToast && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="absolute top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-amber-500 text-white text-[13px] font-semibold px-4 py-2.5 rounded-xl shadow-lg"
            >
              <BookmarkCheck className="w-4 h-4" />
              {draftToast}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Session recovery banner */}
        <AnimatePresence>
          {sessionRecovery && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden flex-shrink-0"
            >
              <div className="flex items-center gap-3 bg-amber-50 border-b border-amber-200 px-5 py-2.5">
                <RotateCcw className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <p className="text-[13px] text-amber-800 font-medium flex-1 min-w-0 truncate">
                  Unsaved bill recovered — {sessionRecovery.items.length} item{sessionRecovery.items.length !== 1 ? "s" : ""}
                  {" · "}₹{sessionRecovery.items.reduce((s, i) => s + i.amount, 0).toFixed(2)}
                </p>
                <button
                  onClick={() => {
                    loadDraft(sessionRecovery.items, sessionRecovery.meta);
                    clearSession();
                    setSessionRecovery(null);
                  }}
                  className="text-[12px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                >
                  Resume
                </button>
                <button
                  onClick={() => { clearSession(); setSessionRecovery(null); }}
                  className="text-amber-400 hover:text-amber-600 transition-colors"
                  aria-label="Discard recovery"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Multi-tab notice */}
        <AnimatePresence>
          {multiTabNotice && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden flex-shrink-0"
            >
              <div className="flex items-center gap-3 bg-blue-50 border-b border-blue-200 px-5 py-2">
                <MonitorSmartphone className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <p className="text-[12px] text-blue-700 font-medium flex-1">{multiTabNotice}</p>
                <button onClick={() => setMultiTabNotice(null)} className="text-blue-400 hover:text-blue-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Zone 2: Bill header form */}
        <BillHeader />

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden flex-shrink-0"
            >
              <div className="flex items-center gap-3 bg-red-50 border-b border-red-100 text-red-700 text-[13px] px-5 py-2.5">
                <span>⚠ {error}</span>
                <button
                  onClick={() => { setError(null); setConflictInventoryIds(new Set()); }}
                  className="ml-auto text-red-400 hover:text-red-600 text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Zone 3: Cart table */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50">
            <CartTableHeader lifa={lifa} onLifaToggle={() => setLifa((v) => !v)} />
          </div>
          <div className="flex-shrink-0 border-b border-slate-200 bg-[#eef4ff]">
            <MedicineSearchCombobox />
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CartTableRows conflictInventoryIds={conflictInventoryIds} />
          </div>
        </div>

        {/* Zone 4: Bottom totals bar */}
        <div
          className="flex items-center px-6 flex-shrink-0"
          style={{
            height: "56px",
            background: "linear-gradient(135deg, #0c1f5c 0%, #132468 40%, #1a3080 100%)",
          }}
        >
          <AnimatePresence>
            {items.length > 0 && (
              <motion.button
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                onClick={() => {
                  if (confirm("Clear all items?")) {
                    api.delete(`/inventory/reserve/${idempotencyKeyRef.current}`).catch(() => {});
                    clear();
                    clearSession();
                  }
                }}
                className="text-[14px] text-white/40 hover:text-white/80 transition-colors mr-4 whitespace-nowrap"
              >
                Clear Bill
              </motion.button>
            )}
          </AnimatePresence>

          <div className="flex-1" />

          <div className="flex items-center gap-4 text-white text-[15px]">
            <span className="text-white/70">
              <motion.span
                key={totalQty}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="font-bold text-white inline-block"
              >
                {totalQty}
              </motion.span>
              {" "}Qty.
            </span>

            <span className="text-white/30">•</span>

            <span className="text-white/70">
              <motion.span
                key={items.length}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="font-bold text-white inline-block"
              >
                {items.length}
              </motion.span>
              {" "}Items
            </span>

            <span className="text-white/30">•</span>

            <motion.span
              key={roundedTotal}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="font-bold text-white tabular-nums inline-block"
            >
              ₹{roundedTotal.toFixed(2)}
            </motion.span>

            <div className="flex items-center gap-2 pl-2 border-l border-white/15">
              <Calculator className="w-5 h-5 text-white/40" />
            </div>

            <span className="text-white/30">•</span>
            <span className="text-white/60 font-medium">Net Payable</span>

            <motion.div
              key={`net-${roundedTotal}`}
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="flex items-center gap-1 bg-white/10 hover:bg-white/15 transition-colors rounded px-3 py-1.5 cursor-pointer"
            >
              <span className="font-bold text-white tabular-nums text-[18px]">
                ₹{roundedTotal.toFixed(2)}
              </span>
              <ChevronUp className="w-4 h-4 text-white/50" />
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* ── Print preview modal ───────────────────────────────── */}
      <AnimatePresence>
        {showPrint && invoice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="print:hidden fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-8 px-4"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 16 }}
              animate={{ scale: 1,    opacity: 1, y: 0  }}
              exit={{   scale: 0.95, opacity: 0, y: 8  }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="bg-slate-100 rounded-2xl overflow-hidden shadow-card-lg w-full max-w-5xl"
            >
              <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Invoice #{invoice.invoiceNumber}</h2>
                  <p className="text-xs text-emerald-600 font-semibold mt-0.5">✓ Invoice saved successfully</p>
                </div>
                <div className="flex gap-3 items-center flex-wrap">
                  {!cancelConfirm ? (
                    <button
                      onClick={() => setCancelConfirm(true)}
                      className="flex items-center gap-1.5 px-4 py-2 text-red-600 hover:bg-red-50 border border-red-200 text-[13px] font-medium rounded-lg transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      Cancel Invoice
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCancel();
                          if (e.key === "Escape") { setCancelConfirm(false); setCancelReason(""); }
                        }}
                        placeholder="Reason for cancellation..."
                        className="text-[13px] border border-red-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200 w-52"
                        autoFocus
                      />
                      <button
                        onClick={handleCancel}
                        disabled={!cancelReason.trim() || cancelling}
                        className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-[13px] font-semibold rounded-lg transition-colors"
                      >
                        {cancelling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Confirm
                      </button>
                      <button
                        onClick={() => { setCancelConfirm(false); setCancelReason(""); }}
                        className="px-3 py-2 text-slate-500 hover:text-slate-700 text-[13px] transition-colors"
                      >
                        Back
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-lg transition-colors"
                  >
                    🖨 Print
                  </button>
                  <button
                    onClick={closePrint}
                    className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="p-8">
                <div className="shadow-card-lg mx-auto" style={{ width: "fit-content" }}>
                  <InvoicePrintView invoice={invoice} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function NewBillPage() {
  return (
    <Suspense>
      <NewBillInner />
    </Suspense>
  );
}
