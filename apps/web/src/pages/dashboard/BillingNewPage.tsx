import { useState, useMemo, useCallback, useEffect, useRef, Suspense, lazy, memo } from "react";
import { useAnimationControls } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronUp,
  Calculator, Loader2,
  XCircle, BookmarkCheck, RotateCcw, X, MonitorSmartphone,
} from "lucide-react";
import { ACTION_DEF_MAP } from "@/lib/billingPreferences";
import type { ActionId } from "@/lib/billingPreferences";
import { BillingSubNav } from "@/components/billing/BillingSubNav";
import { BillHeader } from "@/components/billing/BillHeader";
import { CartTableHeader, CartTableRows } from "@/components/billing/CartTable";
import { MedicineSearchCombobox } from "@/components/billing/MedicineSearchCombobox";
import { AlternativesDrawer } from "@/components/billing/AlternativesDrawer";
import { useBillingStore } from "@/components/billing/useBillingStore";
import { InvoiceBreakdownModal } from "@/components/billing/InvoiceBreakdownModal";
import type { MedicineSearchResult } from "@pharmacy/types";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { saveDraft, getDraft, deleteDraft } from "@/lib/draftStorage";
import { saveSession, loadSession, clearSession, type AutoSaveSession } from "@/lib/autoSave";
import type { PrintInvoiceData } from "@/components/billing/InvoicePrintView";
import { useInvoicePrintConfig } from "@/lib/useInvoicePrintConfig";

const InvoicePrintView = lazy(() =>
  import("@/components/billing/InvoicePrintView").then((m) => ({ default: m.InvoicePrintView }))
);

// ─── Error → conflict mapping ─────────────────────────────────────────────────
// Parses backend error messages to find the specific cart item that caused the failure.
import type { CartItem } from "@/components/billing/useBillingStore";

function extractConflictIds(msg: string, items: CartItem[]): Set<string> {
  const byName = (name: string): string | undefined =>
    items.find((i) => i.medicineName.toLowerCase() === name.toLowerCase())?.inventoryId;

  const insuff = msg.match(/Insufficient stock for "(.+?)":/);
  if (insuff?.[1]) { const id = byName(insuff[1]); if (id) return new Set([id]); }

  const notFound = msg.match(/Inventory item not found: ([a-f0-9-]{36})/i);
  if (notFound?.[1]) {
    const id = notFound[1];
    if (items.some((i) => i.inventoryId === id)) return new Set([id]);
  }

  const expired = msg.match(/Batch ".+?" of "(.+?)" expired/);
  if (expired?.[1]) { const id = byName(expired[1]); if (id) return new Set([id]); }

  const inactive = msg.match(/Medicine "(.+?)" is inactive/);
  if (inactive?.[1]) { const id = byName(inactive[1]); if (id) return new Set([id]); }

  return new Set();
}

// ─── Animated counter ─────────────────────────────────────────────────────────
// Triggers a quick slide-in animation when the value changes WITHOUT remounting
// the DOM node. Replacing key={value} + initial/animate with this avoids the
// React unmount/mount cycle and Framer Motion layout re-measurement on every
// cart interaction.

const AnimatedCount = memo(function AnimatedCount({
  value,
  className,
  children,
}: {
  value:     number | string;
  className?: string;
  children?: React.ReactNode;
}) {
  const controls    = useAnimationControls();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    void controls.start({ opacity: [0.4, 1], y: [-5, 0], transition: { duration: 0.18, ease: "easeOut" } });
  }, [value, controls]);

  return (
    <motion.span animate={controls} className={className}>
      {children ?? value}
    </motion.span>
  );
});


// ─── New Bill page ─────────────────────────────────────────────────────────────

function NewBillInner() {
  // Granular selectors — each re-renders only when its own slice changes
  const items    = useBillingStore((s) => s.items);
  const meta     = useBillingStore((s) => s.meta);
  const clear    = useBillingStore((s) => s.clear);
  const getTotals= useBillingStore((s) => s.getTotals);
  const setMeta  = useBillingStore((s) => s.setMeta);
  const loadDraft= useBillingStore((s) => s.loadDraft);
  const { config: printConfig, pharmacy: printPharmacy } = useInvoicePrintConfig();
  const queryClient  = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate     = useNavigate();
  const [submitting,           setSubmitting]           = useState(false);
  const [error,                setError]                = useState<string | null>(null);
  const [conflictInventoryIds, setConflictInventoryIds] = useState<Set<string>>(new Set());
  const [invoice,              setInvoice]              = useState<PrintInvoiceData | null>(null);
  const [showPrint,            setShowPrint]            = useState(false);
  const [showBreakdown,        setShowBreakdown]        = useState(false);
  const [lifa,                 setLifa]                 = useState(true);
  const [savedInvoiceId,       setSavedInvoiceId]       = useState<string | null>(null);
  const [cancelConfirm,        setCancelConfirm]        = useState(false);
  const [cancelReason,         setCancelReason]         = useState("");
  const [cancelling,           setCancelling]           = useState(false);
  const [draftToast,           setDraftToast]           = useState<string | null>(null);
  const [loadedDraftId,        setLoadedDraftId]        = useState<string | null>(null);
  const [actionToast,          setActionToast]          = useState<{ msg: string; type: "info" | "warn" } | null>(null);
  const [altDrawer,            setAltDrawer]            = useState<{ med: MedicineSearchResult; autoSuggest: boolean } | null>(null);

  // Crash / refresh recovery
  const [sessionRecovery, setSessionRecovery] = useState<AutoSaveSession | null>(null);
  // Multi-tab awareness
  const [multiTabNotice, setMultiTabNotice] = useState<string | null>(null);

  // Always-current ref so the keydown handler never closes over a stale handleSave.
  // Initialized with a no-op; synced to the real callback after handleSave is declared below.
  const handleSaveRef = useRef<(action?: ActionId) => Promise<void>>(async () => {});

  // F9 = Save & Print, F8 = Save & New, Ctrl+S = Draft, Alt+1..4 = payment mode
  // Empty deps: registered once at mount; latest callbacks accessed via refs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F9") { e.preventDefault(); void handleSaveRef.current("save_print"); }
      if (e.key === "F8") { e.preventDefault(); void handleSaveRef.current("save_new"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          void handleSaveRef.current("save_draft");
        }
      }
      if (e.altKey) {
        const map: Record<string, "CASH"|"UPI"|"CARD"|"CREDIT"> = { "1": "CASH", "2": "UPI", "3": "CARD", "4": "CREDIT" };
        if (map[e.key]) { e.preventDefault(); setMeta({ paymentMode: map[e.key] }); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
      navigate("/dashboard/billing/new", { replace: true });
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
    return undefined;
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

  const totals   = useMemo(() => getTotals(), [getTotals, items]);
  const totalQty = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);

  // Net payable includes bill-level adjustments — kept consistent with InvoiceBreakdownModal
  const netPayable = useMemo(() => {
    const billDiscAmt = (meta.billDiscountPct / 100) * totals.totalAmount;
    const preRound    = Math.max(0, totals.totalAmount - billDiscAmt + meta.extraCharges + meta.adjustmentAmount);
    return preRound + (Math.round(preRound) - preRound);
  }, [totals.totalAmount, meta.billDiscountPct, meta.extraCharges, meta.adjustmentAmount]);

  const roundedTotal = Math.round(netPayable);

  const handleSave = useCallback(async (action: ActionId = "save_print") => {
    if (items.length === 0) return;
    if (submitting) return;          // guard: F9 + modal Submit race

    // Draft action is handled separately
    if (action === "save_draft") { handleSaveDraft(); return; }

    // Extended actions that are not yet implemented
    const comingSoon: ActionId[] = ["whatsapp", "email", "credit_sale", "delivery", "pickup", "duplicate_print", "return"];
    if (comingSoon.includes(action)) {
      setActionToast({ msg: `${ACTION_DEF_MAP[action].label} — coming soon`, type: "info" });
      setTimeout(() => setActionToast(null), 3000);
      return;
    }

    setSubmitting(true);
    setError(null);
    setConflictInventoryIds(new Set());
    try {
      const { data } = await api.post<{ data: { id: string; invoiceNumber: string; createdAt: string } }>("/billing", {
        idempotencyKey:   idempotencyKeyRef.current,
        customerId:       (meta.customerId && meta.customerId !== "COUNTER") ? meta.customerId : undefined,
        doctorId:         meta.doctorId         || undefined,
        doctorName:       meta.doctorName       || undefined,
        prescriptionId:   meta.prescriptionId   || undefined,
        paymentMode:      meta.paymentMode,
        paymentStatus:    meta.paymentStatus,
        isInterstate:     meta.isInterstate,
        notes:            meta.notes            || undefined,
        deliveryNotes:    meta.deliveryNotes    || undefined,
        billDiscountPct:  meta.billDiscountPct,
        extraCharges:     meta.extraCharges,
        adjustmentAmount: meta.adjustmentAmount,
        items: items.map((i) => ({
          inventoryId: i.inventoryId,
          quantity:    i.quantity,
          discount:    i.discount,
        })),
      });
      const printData: PrintInvoiceData = {
        invoiceNumber:    data.data.invoiceNumber,
        createdAt:        data.data.createdAt,
        // Exclude the "COUNTER" sentinel — counter bills have no named patient on the invoice
        customerName:     (meta.customerName && meta.customerId !== "COUNTER") ? meta.customerName : undefined,
        customerPhone:    meta.customerPhone    || undefined,
        customerAddress:  meta.customerAddress  || undefined,
        abha:             meta.abha             || undefined,
        prescriptionNo:   meta.prescriptionNumber || undefined,
        cashierName:      getStoredUser()?.name  || undefined,
        doctorName:       meta.doctorName        || undefined,
        paymentMode:      meta.paymentMode,
        paymentStatus:    meta.paymentStatus,
        isInterstate:     meta.isInterstate,
        items:            items,
        subtotal:       totals.subtotal,
        // Include bill-level discount so the print receipt shows the true total savings
        discountAmount: totals.discountAmount + (meta.billDiscountPct / 100) * totals.totalAmount,
        taxableAmount:  totals.taxableAmount,
        cgst:           totals.cgst,
        sgst:           totals.sgst,
        igst:           totals.igst,
        totalGst:       totals.totalGst,
        totalAmount:    roundedTotal,  // net payable after all adjustments
      };
      // Cleanup draft + session + regenerate idempotency key for next bill
      if (loadedDraftId) { deleteDraft(loadedDraftId); setLoadedDraftId(null); }
      clearSession();
      idempotencyKeyRef.current = crypto.randomUUID();

      // Notify other tabs that a bill was saved; close immediately to avoid leaking the channel.
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("checkup_billing");
        bc.postMessage({ type: "bill_saved" });
        bc.close();
      }

      // Stock levels changed — drop the medicine-stock batch cache so the next
      // medicine selection shows real remaining quantities, not the pre-sale count.
      void queryClient.invalidateQueries({ queryKey: ["medicine-stock"] });

      clear();

      if (action === "save_new") {
        // Skip print overlay — just confirm and stay on the new-bill page
        setActionToast({ msg: `Invoice #${data.data.invoiceNumber} saved — ready for next bill`, type: "info" });
        setTimeout(() => setActionToast(null), 3500);
      } else {
        // save_print (default): show print overlay
        setSavedInvoiceId(data.data.id);
        setInvoice(printData);
        setShowPrint(true);
      }
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
  }, [items, meta, totals, roundedTotal, loadedDraftId, clear, submitting]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the ref current after every render so the keydown handler always dispatches
  // to the latest handleSave (which closes over the correct loadedDraftId et al.).
  useEffect(() => { handleSaveRef.current = handleSave; });

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

  // Stable callbacks for BillingSubNav — prevents re-renders on every cart change
  const handlePaymentMode  = useCallback((m: "CASH"|"UPI"|"CARD"|"CREDIT") => setMeta({ paymentMode: m }), [setMeta]);
  const handleInterstate   = useCallback((v: boolean) => setMeta({ isInterstate: v }), [setMeta]);
  const handleLifaToggle   = useCallback(() => setLifa((v) => !v), []);

  return (
    <>
      {/* Print-only layer — uses saved pharmacy settings so the actual print matches the template */}
      {invoice && (
        <div className="hidden print:block">
          <InvoicePrintView invoice={invoice} config={printConfig} pharmacy={printPharmacy} />
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
          onAction={handleSave}
          submitting={submitting}
          hasItems={items.length > 0}
          paymentMode={meta.paymentMode}
          onPaymentMode={handlePaymentMode}
          isInterstate={meta.isInterstate}
          onInterstate={handleInterstate}
          lifa={lifa}
          onLifaToggle={handleLifaToggle}
        />

        {/* Action feedback toast (Save & New, coming-soon stubs) */}
        <AnimatePresence>
          {actionToast && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className={cn(
                "absolute top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 text-white text-[13px] font-semibold px-4 py-2.5 rounded-xl shadow-lg",
                actionToast.type === "info" ? "bg-blue-600" : "bg-amber-500"
              )}
            >
              {actionToast.msg}
            </motion.div>
          )}
        </AnimatePresence>

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
            <CartTableHeader />
          </div>
          <div className="flex-shrink-0 border-b border-slate-200 bg-white">
            <MedicineSearchCombobox
              onOpenAlternatives={(med, autoSuggest) =>
                setAltDrawer({ med, autoSuggest: autoSuggest ?? false })
              }
            />
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
              <AnimatedCount value={totalQty} className="font-bold text-white inline-block" />
              {" "}Qty.
            </span>

            <span className="text-white/30">•</span>

            <span className="text-white/70">
              <AnimatedCount value={items.length} className="font-bold text-white inline-block" />
              {" "}Items
            </span>

            <span className="text-white/30">•</span>

            <AnimatedCount
              value={roundedTotal}
              className="font-bold text-white tabular-nums inline-block"
            >
              ₹{roundedTotal.toFixed(2)}
            </AnimatedCount>

            <div className="flex items-center gap-2 pl-2 border-l border-white/15">
              <Calculator className="w-5 h-5 text-white/40" />
            </div>

            <span className="text-white/30">•</span>
            <span className="text-white/60 font-medium">Net Payable</span>

            <button
              type="button"
              onClick={() => setShowBreakdown(true)}
              className="flex items-center gap-1 bg-white/10 hover:bg-white/20 active:scale-[0.97] transition-all rounded px-3 py-1.5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <AnimatedCount value={roundedTotal} className="font-bold text-white tabular-nums text-[18px]">
                ₹{roundedTotal.toFixed(2)}
              </AnimatedCount>
              <ChevronUp className="w-4 h-4 text-white/50" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── Medicine Alternatives drawer ─────────────────────── */}
      <AnimatePresence>
        {altDrawer && (
          <AlternativesDrawer
            sourceMed={altDrawer.med}
            autoSuggest={altDrawer.autoSuggest}
            onClose={() => setAltDrawer(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Invoice Breakdown modal ──────────────────────────── */}
      <AnimatePresence>
        {showBreakdown && (
          <InvoiceBreakdownModal
            onClose={() => setShowBreakdown(false)}
            submitting={submitting}
            onSubmit={async () => {
              setShowBreakdown(false);
              await handleSave("save_print");
            }}
          />
        )}
      </AnimatePresence>

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
                  <InvoicePrintView invoice={invoice} config={printConfig} pharmacy={printPharmacy} />
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
