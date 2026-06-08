

import { useState, useMemo, useCallback, useEffect, useRef, Suspense, lazy, memo } from "react";
import { useAnimationControls } from "framer-motion";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight, Lightbulb, ChevronDown, ChevronUp,
  Bell, Truck, Settings, Calculator, Loader2,
  UserCircle2, XCircle, BookmarkCheck, RotateCcw, X, MonitorSmartphone,
  Banknote, Smartphone, CreditCard as CreditCardIcon, Clock3,
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

const InvoicePrintView = lazy(() =>
  import("@/components/billing/InvoicePrintView").then((m) => ({ default: m.InvoicePrintView }))
);

const PAY_LABELS: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", CREDIT: "Credit" };

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

// ─── Payment mode icons ───────────────────────────────────────────────────────
const PAY_ICONS: Record<"CASH"|"UPI"|"CARD"|"CREDIT", React.ElementType> = {
  CASH: Banknote, UPI: Smartphone, CARD: CreditCardIcon, CREDIT: Clock3,
};
const PAY_SHORTCUTS: Record<string, string> = { CASH: "1", UPI: "2", CARD: "3", CREDIT: "4" };

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
  value: number | string;
  className?: string;
  children?: React.ReactNode;
}) {
  const controls  = useAnimationControls();
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

// ─── Sub-navigation bar ───────────────────────────────────────────────────────

function BillingSubNav({
  onSave,
  onSaveDraft,
  submitting,
  hasItems,
  paymentMode,
  onPaymentMode,
  isInterstate,
  onInterstate,
}: {
  onSave: () => void;
  onSaveDraft: () => void;
  submitting: boolean;
  hasItems: boolean;
  paymentMode: "CASH" | "UPI" | "CARD" | "CREDIT";
  onPaymentMode: (m: "CASH" | "UPI" | "CARD" | "CREDIT") => void;
  isInterstate: boolean;
  onInterstate: (v: boolean) => void;
}) {
  const [showSaveDrop, setShowSaveDrop] = useState(false);

  return (
    <div
      className="flex items-center justify-between px-4 flex-shrink-0 border-b border-slate-200 bg-white"
      style={{ height: "var(--subnav-height, 46px)" }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5">
        <Link to="/dashboard/billing" className="text-[13px] text-blue-600 font-medium hover:underline">
          Sales
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[13px] text-slate-800 font-bold">New Bill</span>
        <div className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center ml-1 shadow-sm" title="Tips">
          <Lightbulb className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Owner — staff selector, pending implementation */}
        <button disabled title="Staff selector — coming soon" className="flex items-center gap-1 text-[12px] text-slate-400 font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 opacity-50 cursor-not-allowed">
          <UserCircle2 className="w-3.5 h-3.5 text-slate-400" />
          Owner
          <ChevronDown className="w-2.5 h-2.5 text-slate-400" />
        </button>

        {/* Payment mode — inline segmented buttons (one click instead of two) */}
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {(["CASH", "UPI", "CARD", "CREDIT"] as const).map((m) => {
            const Icon = PAY_ICONS[m];
            const active = paymentMode === m;
            return (
              <button
                key={m}
                onClick={() => onPaymentMode(m)}
                title={`${PAY_LABELS[m]} (Alt+${PAY_SHORTCUTS[m]})`}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all duration-100",
                  active
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 hover:bg-white"
                )}
              >
                <Icon className="w-3 h-3" strokeWidth={active ? 2.3 : 1.8} />
                {PAY_LABELS[m]}
                {active && <kbd className="ml-0.5 text-[8px] bg-white/20 text-white/70 rounded px-0.5 leading-none font-mono">Alt+{PAY_SHORTCUTS[m]}</kbd>}
              </button>
            );
          })}
        </div>

        {/* Interstate (IGST) toggle */}
        <button
          onClick={() => onInterstate(!isInterstate)}
          title={isInterstate ? "Interstate sale — IGST applies. Click to switch to intra-state (CGST+SGST)" : "Intra-state sale — CGST+SGST. Click to switch to interstate (IGST)"}
          className={cn(
            "flex items-center gap-1 text-[12px] font-semibold border rounded-lg px-2.5 py-1.5 transition-colors",
            isInterstate
              ? "bg-violet-600 text-white border-violet-600 hover:bg-violet-700"
              : "text-slate-600 border-slate-200 hover:bg-slate-50",
          )}
        >
          {isInterstate ? "IGST" : "CGST+SGST"}
        </button>

        {/* Reminder — pending implementation */}
        <button disabled title="Medicine reminder — coming soon" className="flex items-center gap-1 text-[12px] text-slate-400 font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 opacity-50 cursor-not-allowed">
          <Bell className="w-3.5 h-3.5 text-slate-400" />
          Reminder
        </button>

        {/* Pickup — pending implementation */}
        <button disabled title="Pickup scheduling — coming soon" className="flex items-center gap-1 text-[12px] text-slate-400 font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 opacity-50 cursor-not-allowed">
          <Truck className="w-3.5 h-3.5 text-slate-400" />
          Pickup
          <ChevronDown className="w-2.5 h-2.5 text-slate-400" />
        </button>

        <div className="h-4 w-px bg-slate-200" />

        {/* Save / Draft split button */}
        <div
          className="relative flex items-stretch"
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowSaveDrop(false); }}
        >
          <button
            onClick={onSave}
            disabled={submitting || !hasItems}
            title="Save Bill (F9)"
            className={cn(
              "flex items-center gap-1.5 text-[13px] font-bold px-4 py-1.5 rounded-l-lg transition-colors active:scale-[0.98]",
              hasItems
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-blue-300 text-white cursor-not-allowed"
            )}
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
            <kbd className={cn("text-[9px] rounded px-1 py-0.5 font-mono leading-none ml-0.5",
              hasItems ? "bg-white/20 text-white/70" : "bg-white/10 text-white/40"
            )}>F9</kbd>
          </button>
          <button
            onClick={() => hasItems && setShowSaveDrop(v => !v)}
            className={cn(
              "flex items-center justify-center px-1.5 rounded-r-lg border-l transition-colors",
              hasItems ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-500" : "bg-blue-300 text-white border-blue-200 cursor-not-allowed"
            )}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {showSaveDrop && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-1 min-w-[160px]">
              <button
                onClick={() => { onSaveDraft(); setShowSaveDrop(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-slate-700 hover:bg-amber-50 transition-colors"
              >
                <BookmarkCheck className="w-3.5 h-3.5 text-amber-500" />
                Save as Draft
              </button>
            </div>
          )}
        </div>

        {/* Settings — pending implementation */}
        <button disabled title="Billing settings — coming soon" className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center opacity-50 cursor-not-allowed">
          <Settings className="w-4 h-4 text-slate-400" />
        </button>
      </div>
    </div>
  );
}

// ─── New Bill page ─────────────────────────────────────────────────────────────

function NewBillInner() {
  const { items, meta, clear, getTotals, setMeta, loadDraft } = useBillingStore();
  const [searchParams] = useSearchParams();
  const navigate     = useNavigate();
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

  // Always-current ref so the keydown handler never closes over a stale handleSave.
  // Initialized with a no-op; synced to the real callback after handleSave is declared below.
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});

  // F9 = Save, Alt+1..4 = payment mode
  // Empty deps: registers once at mount, reads the latest callback via ref on each keystroke.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F9") { e.preventDefault(); void handleSaveRef.current(); }
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
        isInterstate:  meta.isInterstate,
        notes:         meta.notes         || undefined,
        items: items.map((i) => ({
          inventoryId: i.inventoryId,
          quantity:    i.quantity,
          discount:    i.discount,
        })),
      });
      const printData: PrintInvoiceData = {
        invoiceNumber:  data.data.invoiceNumber,
        createdAt:      data.data.createdAt,
        customerName:   meta.customerName  || undefined,
        customerPhone:  meta.customerPhone || undefined,
        doctorName:     meta.doctorName    || undefined,
        paymentMode:    meta.paymentMode,
        paymentStatus:  meta.paymentStatus,
        isInterstate:   meta.isInterstate,
        items:          items.map((i) => ({ ...i, igst: i.igst ?? 0 })),
        subtotal:       totals.subtotal,
        discountAmount: totals.discountAmount,
        taxableAmount:  totals.taxableAmount,
        cgst:           totals.cgst,
        sgst:           totals.sgst,
        igst:           totals.igst,
        totalGst:       totals.totalGst,
        totalAmount:    roundedTotal,
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
          isInterstate={meta.isInterstate}
          onInterstate={(v) => setMeta({ isInterstate: v })}
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

            <AnimatedCount
              value={roundedTotal}
              className="flex items-center gap-1 bg-white/10 hover:bg-white/15 transition-colors rounded px-3 py-1.5 cursor-pointer"
            >
              <span className="font-bold text-white tabular-nums text-[18px]">
                ₹{roundedTotal.toFixed(2)}
              </span>
              <ChevronUp className="w-4 h-4 text-white/50" />
            </AnimatedCount>
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
