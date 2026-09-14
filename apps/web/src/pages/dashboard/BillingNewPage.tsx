import { useState, useMemo, useCallback, useEffect, useRef, Suspense, lazy, memo } from "react";
import PrescriptionFulfilmentPanel from "@/components/integration/PrescriptionFulfilmentPanel";
import { useAnimationControls } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronUp,
  Calculator, Loader2,
  XCircle, BookmarkCheck, RotateCcw, X, MonitorSmartphone, FileText, Scissors,
} from "lucide-react";
import { ACTION_DEF_MAP } from "@/lib/billingPreferences";
import type { ActionId } from "@/lib/billingPreferences";
import { BillingSubNav } from "@/components/billing/BillingSubNav";
import { BillHeader } from "@/components/billing/BillHeader";
import { CartTableHeader, CartTableRows } from "@/components/billing/CartTable";
import { MedicineSearchCombobox } from "@/components/billing/MedicineSearchCombobox";
import { AlternativesDrawer } from "@/components/billing/AlternativesDrawer";
import { useBillingStore, lineIssue, rxRequiredIssue } from "@/components/billing/useBillingStore";
import { useLooseSaleHotkey } from "@/components/billing/useLooseSaleHotkey";
import { useBillingKeyboardShortcuts } from "@/components/billing/useBillingKeyboardShortcuts";
import { CustomerAccountPanel } from "@/components/customers/CustomerAccountPanel";
import { InvoiceBreakdownModal } from "@/components/billing/InvoiceBreakdownModal";
import { TenderModal } from "@/components/billing/TenderModal";
import type { MedicineSearchResult } from "@pharmacy/types";
import { useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api-client";
import { computeNetPayable, shortfallMessage } from "@/lib/billTotals";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { saveDraft, getDraft, deleteDraft } from "@/lib/draftStorage";
import { useDispensingStrategy } from "@/lib/useDispensingStrategy";
import { saveSession, loadSession, clearSession, type AutoSaveSession } from "@/lib/autoSave";
import type { PrintInvoiceData, PharmacyProfile } from "@/components/billing/InvoicePrintView";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import { useInvoicePrintConfig } from "@/lib/useInvoicePrintConfig";
import { invoiceRendererFor } from "@/lib/invoiceRenderer";
import { LooseLabelModal } from "@/components/LooseLabelModal";

const InvoicePrintView = lazy(() =>
  import("@/components/billing/InvoicePrintView").then((m) => ({ default: m.InvoicePrintView }))
);
const ThermalReceiptView = lazy(() =>
  import("@/components/billing/ThermalReceiptView").then((m) => ({ default: m.ThermalReceiptView }))
);
const TaxWholesaleInvoiceView = lazy(() =>
  import("@/components/billing/TaxWholesaleInvoiceView").then((m) => ({ default: m.TaxWholesaleInvoiceView }))
);
const A5LandscapeInvoiceView = lazy(() =>
  import("@/components/billing/A5LandscapeInvoiceView").then((m) => ({ default: m.A5LandscapeInvoiceView }))
);

/**
 * The saved-settings print view for the current bill — routes through
 * {@link invoiceRendererFor} (thermal / a5landscape / wholesale / classic) so
 * Save & Print honours the pharmacy's format. Previously this screen hard-coded
 * the A4 InvoicePrintView, so thermal and the landscape formats never reached
 * the printer from here.
 */
function InvoicePrintSurface({ invoice, config, pharmacy }: {
  invoice: PrintInvoiceData;
  config: InvoiceSettingsConfig;
  pharmacy: PharmacyProfile | undefined;
}) {
  const kind = invoiceRendererFor(config);
  if (kind === "thermal")     return <ThermalReceiptView invoice={invoice} config={config} pharmacy={pharmacy} />;
  if (kind === "a5landscape") return <A5LandscapeInvoiceView invoice={invoice} config={config} pharmacy={pharmacy} />;
  if (kind === "wholesale")   return <TaxWholesaleInvoiceView invoice={invoice} config={config} pharmacy={pharmacy} />;
  return <InvoicePrintView invoice={invoice} config={config} pharmacy={pharmacy} />;
}

// ─── Error → conflict mapping ─────────────────────────────────────────────────
// Parses backend error messages to find the specific cart item that caused the failure.
import type { CartItem } from "@/components/billing/useBillingStore";

/**
 * A cashier finishing one bill should never need the mouse to start the next —
 * called after Save & New, Save Draft, and dismissing the printed receipt.
 * RAF, not a bare call: the cart-cleared re-render (and the print overlay's own
 * unmount) hasn't necessarily painted yet, and focusing mid-render is a no-op.
 */
function focusBillingSearch() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>("[data-billing-search]")?.focus();
  });
}

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
  // "L" flips Strip ⇄ loose for the active cart line from anywhere on the screen
  // (CartRow handles it from inside a row; this covers the search box, buttons, …).
  useLooseSaleHotkey();

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
  const [showTender,           setShowTender]           = useState(false);
  const [showAccount,          setShowAccount]          = useState(false);
  const [showLabels,           setShowLabels]           = useState(false);
  const [showBreakdown,        setShowBreakdown]        = useState(false);
  // Batch-selection strategy is a persisted pharmacy setting (default LILA/FEFO),
  // not per-bill state. The backend dispensing engine is what actually orders
  // batches; this drives the sub-nav toggle and the picker's label.
  const dispensing = useDispensingStrategy();
  const lifa = dispensing.lifa;
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

  // Idempotency key — prevents duplicate invoices on double-click or network retry
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  // Keep items in a ref so the BroadcastChannel handler isn't stale
  const itemsRef          = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // What the reservation actually depends on: which batches, and how many units of
  // each. Everything else on a cart line — discount, and the batch metadata carried
  // for printing — leaves the held stock unchanged.
  //
  // Reserve the full dispensed amount: free units come off the same batch, so
  // reserving only the paid quantity would under-hold stock against another till.
  // A loose line's quantity is in pieces; the server rounds it up to whole packs so
  // the hold lines up with how reservedQuantity is counted. We just pass saleUnit.
  const reservationPayload = useMemo(
    () => items.map((i) => ({
      inventoryId: i.inventoryId,
      quantity:    i.quantity + (i.freeQty || 0),
      saleUnit:    i.saleUnit === "LOOSE" ? "LOOSE" : "PACK",
    })),
    [items],
  );
  // Serialised so the effect below compares by VALUE. `items` gets a new array
  // identity on every keystroke in a discount box, and each one used to cost a
  // reservation round trip that re-sent numbers the server already had.
  const reservationKey = JSON.stringify(reservationPayload);

  // Debounced stock reservation — keeps reservedQuantity in sync while building the cart
  const reservationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (reservationTimer.current) clearTimeout(reservationTimer.current);
    const payload = JSON.parse(reservationKey) as { inventoryId: string; quantity: number; saleUnit: string }[];
    if (payload.length === 0) return;
    reservationTimer.current = setTimeout(() => {
      api.post("/inventory/reserve", {
        sessionId: idempotencyKeyRef.current,
        items: payload,
      }).catch(() => { /* best-effort; authoritative check is at bill save */ });
    }, 500);
    return () => { if (reservationTimer.current) clearTimeout(reservationTimer.current); };
  }, [reservationKey]);

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
    focusBillingSearch();
    setTimeout(() => setDraftToast(null), 3000);
  }, [items, meta, loadedDraftId, clear]);

  // getTotals reads items/meta.isInterstate off the store at call time via
  // get(), but the function reference itself never changes (it's a stable
  // Zustand action) — depending on it alone means this never recomputes
  // after the first render. Depend on the actual inputs instead.
  const totals   = useMemo(() => getTotals(), [getTotals, items, meta.isInterstate]);
  const totalQty = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);

  // Net payable includes bill-level adjustments. Shares one helper with
  // InvoiceBreakdownModal so the header figure and the breakdown cannot drift.
  const { netPayable, shortfall } = useMemo(
    // totals.totalAmount already has the bill discount inside it — getTotals passes
    // meta.billDiscountPct to calcInvoiceTotals so the tax is computed on the
    // discounted value. Subtracting it again here would apply it twice.
    () => computeNetPayable({
      itemsTotal:       totals.totalAmount,
      extraCharges:     meta.extraCharges,
      adjustmentAmount: meta.adjustmentAmount,
    }),
    [totals.totalAmount, meta.extraCharges, meta.adjustmentAmount],
  );

  const roundedTotal = Math.round(netPayable);

  // A split is agreed against one exact total, so anything that moves the total — another
  // line, a discount, a changed quantity — leaves it describing a bill that no longer
  // exists. The server refuses such a bill, and the save button is the worst possible
  // place to discover that, with a queue waiting. Drop the stale split here and say so,
  // while the cashier is still looking at the cart that changed.
  useEffect(() => {
    if (meta.tenders.length === 0) return;
    const allocatedPaise = meta.tenders.reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
    if (allocatedPaise === Math.round(roundedTotal * 100)) return;
    setMeta({ tenders: [] });
    setActionToast({ msg: "Bill total changed — payment split cleared. Press F7 to split again.", type: "warn" });
    setTimeout(() => setActionToast(null), 4000);
  }, [roundedTotal, meta.tenders, setMeta]);

  // A cut-strip (loose) line needs the cut-strip label the preview modal prints, so
  // those bills keep the modal; every other Save & Print goes straight through.
  const hasLooseLine = items.some((i) => i.saleUnit === "LOOSE");

  // Guards a print/reset cycle so a stray second `afterprint` (or the safety timer)
  // can't clear the invoice out from under the next bill.
  const printCycleRef = useRef(0);

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

    // Schedule H/H1/X items require a linked prescription (Indian Drug Rules).
    // BillingService.java throws a 422 for exactly this — checked here too so the
    // cashier is stopped before the round trip, at the field the "Rx Required"
    // banner has already been pointing at, instead of a generic server error after
    // F9. The backend check is untouched and remains the authority.
    const rxIssue = rxRequiredIssue(items, meta);
    if (rxIssue) {
      const plural = rxIssue.schedules.length > 1 ? "s" : "";
      setError(`Prescription required for controlled medicine${plural} (Schedule ${rxIssue.schedules.join(", ")}) `
        + `— link a prescription to save.`);
      document.querySelector("[data-rx-field]")?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.querySelector<HTMLInputElement>("[data-rx-search-input]")?.focus();
      return;
    }

    // Stop here rather than at the server. The backend refuses a negative bill with
    // a 422, but until this check existed the screen showed a clamped ₹0.00 — which
    // reads as a legitimate free-of-charge sale — so the cashier had no way to know
    // anything was wrong until the save bounced with figures never shown to them.
    if (shortfall > 0) {
      setError(shortfallMessage(shortfall));
      return;
    }

    // A loose line the server would 422 (whole strip, Schedule X, loose turned off).
    // Stop here and point at it — no wasted round trip, and the cart already shows a
    // one-click fix on the line.
    const badLine = items.find((i) => lineIssue(i) !== null);
    if (badLine) {
      setConflictInventoryIds(new Set([badLine.inventoryId]));
      setError(lineIssue(badLine)!.message + " — fix the highlighted line, then save.");
      document.querySelector(`[data-row]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    setSubmitting(true);
    setError(null);
    setConflictInventoryIds(new Set());
    try {
      const { data } = await api.post<{ data: {
        id: string; invoiceNumber: string; createdAt: string;
        totalAmount: number; extraCharges: number; adjustmentAmount: number; roundOff: number;
      } }>("/billing", {
        idempotencyKey:   idempotencyKeyRef.current,
        // The reservation session this cart has been holding stock under. The server
        // discounts our own hold when checking availability and releases it as part of
        // the sale — without it, a cart holding more than half a batch was refused for
        // stock it had reserved itself. Sent explicitly rather than relying on it
        // happening to equal idempotencyKey.
        sessionId:        idempotencyKeyRef.current,
        customerId:       (meta.customerId && meta.customerId !== "COUNTER") ? meta.customerId : undefined,
        // Without a linked customerId (an EMR-sourced patient, or any walk-in with a name
        // typed but no catalogue record), this is the ONLY place the patient's name reaches
        // the saved invoice — printData below carries the same value but only for the
        // receipt, never for the actual save. Omitting it here is exactly the "walk-in
        // customer" bug: the banner and receipt would still show the real name while the
        // invoice itself silently reverted to no name on file. Same "COUNTER" exclusion as
        // printData's, so behavior stays identical between what's shown and what's saved.
        customerName:     (meta.customerName && meta.customerId !== "COUNTER") ? meta.customerName : undefined,
        customerPhone:    (meta.customerPhone && meta.customerId !== "COUNTER") ? meta.customerPhone : undefined,
        doctorId:         meta.doctorId         || undefined,
        doctorName:       meta.doctorName       || undefined,
        prescriptionId:   meta.prescriptionId   || undefined,
        paymentMode:      meta.paymentMode,
        paymentStatus:    meta.paymentStatus,
        // Sent only when the cashier actually split the bill. On every ordinary sale this
        // is absent and the server reads the single mode above, exactly as before — the
        // one-key checkout path never touches it.
        tenders:          meta.tenders.length > 0
          ? meta.tenders.map((t) => ({
              paymentMode: t.mode,
              amount:      t.amount,
              reference:   t.reference || undefined,
            }))
          : undefined,
        isInterstate:     meta.isInterstate,
        notes:            meta.notes            || undefined,
        deliveryNotes:    meta.deliveryNotes    || undefined,
        billDiscountPct:  meta.billDiscountPct,
        extraCharges:     meta.extraCharges,
        adjustmentAmount: meta.adjustmentAmount,
        items: items.map((i) => ({
          inventoryId: i.inventoryId,
          quantity:    i.quantity,
          freeQty:     i.freeQty || undefined,
          discount:    i.discount,
          // LOOSE — quantity is individual pieces cut from a strip. Omitted (PACK)
          // for every normal line so an older bill shape is unchanged.
          saleUnit:    i.saleUnit === "LOOSE" ? "LOOSE" : undefined,
          // Cashier chose "cut it anyway" past the whole-pack guard for this line.
          forceLoose:  i.saleUnit === "LOOSE" && i.forceLoose ? true : undefined,
          // Only ever set for a substitution; the server attributes everything else
          // by matching the medicine.
          prescriptionItemId: i.prescriptionItemId,
          // false only when a pharmacist hand-picked the batch over the engine's
          // order — recorded on the invoice line for the dispensing audit trail.
          batchAutoSelected: i.batchAutoSelected === false ? false : undefined,
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
        // So the receipt states how the bill was actually settled. Printing the single
        // mode would tell a customer who paid half cash, half UPI that all of it went
        // on UPI.
        tenders:          meta.tenders.length > 0
          ? meta.tenders.map((t) => ({ mode: t.mode, amount: t.amount }))
          : undefined,
        isInterstate:     meta.isInterstate,
        // "Place of Supply" on the tax-wholesale layout — the pharmacy's own
        // registered state (buyer-state capture is a later follow-up).
        placeOfSupply:    printPharmacy?.state || undefined,
        items:            items,
        subtotal:       totals.subtotal,
        // Include bill-level discount so the print receipt shows the true total savings
        discountAmount: totals.discountAmount + (meta.billDiscountPct / 100) * totals.totalAmount,
        taxableAmount:  totals.taxableAmount,
        cgst:           totals.cgst,
        sgst:           totals.sgst,
        igst:           totals.igst,
        totalGst:       totals.totalGst,
        // From the SAVED invoice, so the printed receipt foots exactly against the row the
        // server wrote — its roundOff carries both the rupee rounding and the equal-split
        // paisa (see BillingService / GstCalculator).
        totalAmount:      data.data.totalAmount,
        extraCharges:     data.data.extraCharges,
        adjustmentAmount: data.data.adjustmentAmount,
        roundOff:         data.data.roundOff,
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
        focusBillingSearch();
      } else if (hasLooseLine) {
        // Cut-strip lines: keep the preview modal so the pharmacist can print the
        // legally-required loose-medicine label from it.
        setSavedInvoiceId(data.data.id);
        setInvoice(printData);
        setShowPrint(true);
      } else {
        // Standard Save & Print — no preview modal. Render the hidden print layer,
        // fire the OS print dialog, and the moment printing finishes (or is
        // dismissed) drop the invoice state and return focus to search for the next
        // patient. The cart is already cleared above, so the screen is usable even
        // if the browser never emits `afterprint`.
        setSavedInvoiceId(data.data.id);
        setInvoice(printData);

        const cycle = ++printCycleRef.current;
        const finish = () => {
          if (printCycleRef.current !== cycle) return;   // a newer bill already took over
          printCycleRef.current = 0;
          window.removeEventListener("afterprint", finish);
          clearTimeout(safety);
          setInvoice(null);
          setSavedInvoiceId(null);
          setActionToast({ msg: `Invoice #${data.data.invoiceNumber} saved & printed — next patient`, type: "info" });
          setTimeout(() => setActionToast(null), 3500);
          focusBillingSearch();
        };
        // Safety net only: if `afterprint` never arrives the cart is still clear and
        // usable — this just tidies the lingering hidden print layer.
        const safety = setTimeout(finish, 20000);
        window.addEventListener("afterprint", finish);
        // Two frames: let React paint the hidden print layer before the dialog opens.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try { window.print(); } catch { /* blocked — the safety timer still resets */ }
        }));
      }
    } catch (err) {
      // getErrorMessage keeps the server's specific reason (insufficient stock, credit limit,
      // expired batch …) — which extractConflictIds below still parses — while also covering
      // the cases hand-rolled extraction missed: offline/unreachable, 403, and opaque 5xx.
      const errorMsg = getErrorMessage(err, "Couldn't save the bill. Please try again.");
      setError(errorMsg);
      // Highlight the specific cart item that caused the failure
      const conflicts = extractConflictIds(errorMsg, items);
      if (conflicts.size > 0) setConflictInventoryIds(conflicts);
    } finally {
      setSubmitting(false);
    }
  }, [items, meta, totals, roundedTotal, shortfall, loadedDraftId, clear, submitting, hasLooseLine]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setError(getErrorMessage(err, "Couldn't cancel the invoice. Please try again."));
    } finally {
      setCancelling(false);
    }
  }, [savedInvoiceId, cancelReason]);

  function closePrint() {
    setShowPrint(false);
    setShowLabels(false);
    setInvoice(null);
    setSavedInvoiceId(null);
    setCancelConfirm(false);
    setCancelReason("");
    focusBillingSearch();
  }

  // Clear the in-progress bill — the "Clear Bill" button and the Esc key both use
  // this. Confirms only when there is something to lose.
  const handleClearBill = useCallback(() => {
    if (useBillingStore.getState().items.length === 0) return;
    if (!confirm("Clear all items from this bill?")) return;
    api.delete(`/inventory/reserve/${idempotencyKeyRef.current}`).catch(() => {});
    clear();
    clearSession();
    focusBillingSearch();
  }, [clear]);

  // Opening the split dialog, from either F7 or the Split button on the tender bar.
  const handleSplitPayment = useCallback(() => {
    // Nothing to divide up yet. The dialog would open against a zero bill, where no set
    // of positive amounts can ever balance and every button is dead.
    if (useBillingStore.getState().items.length === 0) {
      setActionToast({ msg: "Add items to the bill before splitting the payment", type: "warn" });
      setTimeout(() => setActionToast(null), 3000);
      return;
    }
    setShowTender(true);
  }, []);

  // The customer's account, opened over the bill (F6). A walk-in has no account to
  // open — saying so is better than a panel of dashes, since the fix is to put a
  // customer on the bill and that is not obvious from an empty khata.
  const handleCustomerAccount = useCallback(() => {
    const { customerId } = useBillingStore.getState().meta;
    if (!customerId || customerId === "COUNTER") {
      setActionToast({ msg: "Select a customer first — an account belongs to somebody", type: "warn" });
      setTimeout(() => setActionToast(null), 3000);
      return;
    }
    setShowAccount(true);
  }, []);

  // F9 = Save & Print, F8 = Save & New, F7 = split payment, Ctrl+S = Draft,
  // "/" = focus search, Alt+1..4 = payment mode. Enter (outside an editable field) =
  // Save & Print, and Esc = dismiss the receipt if it's up, else clear the in-progress
  // bill. `onSave` is the exact same handler the Save button dispatches to;
  // `handleSave` fast-paths Save & Print itself (no preview modal on a standard bill).
  useBillingKeyboardShortcuts({
    onSave: handleSave,
    onClosePrint: closePrint,
    onFocusSearch: focusBillingSearch,
    onSetPaymentMode: (m) => setMeta({ paymentMode: m, tenders: [] }),
    isPrintOpen: showPrint,
    onClearBill: handleClearBill,
    onSplitPayment: handleSplitPayment,
    onCustomerAccount: handleCustomerAccount,
    // Both dialogs decide something about this bill's money — neither may be saved
    // out from under. See the hook's own note on why F8/F9 are suppressed here.
    isSplitOpen: showTender || showAccount,
  });

  // Stable callbacks for BillingSubNav — prevents re-renders on every cart change
  // Clears any split, same as the Alt+1..4 path: picking a single mode is a statement
  // that the whole bill goes that way, and leaving a stale split behind would save legs
  // the tender bar is no longer showing.
  const handlePaymentMode  = useCallback((m: "CASH"|"UPI"|"CARD"|"CREDIT") => setMeta({ paymentMode: m, tenders: [] }), [setMeta]);
  const handleInterstate   = useCallback((v: boolean) => setMeta({ isInterstate: v }), [setMeta]);
  const canChangeStrategy  = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");
  const handleLifaToggle   = useCallback(() => {
    if (!canChangeStrategy) return;
    dispensing.setStrategy(dispensing.strategy === "LIFA" ? "LILA_FEFO" : "LIFA");
  }, [canChangeStrategy, dispensing]);

  return (
    <>
      {/* Print-only layer — uses saved pharmacy settings so the actual print matches the template */}
      {invoice && (
        <div className="hidden print:block">
          <InvoicePrintSurface invoice={invoice} config={printConfig} pharmacy={printPharmacy} />
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
          tenders={meta.tenders}
          onSplitPayment={handleSplitPayment}
          isInterstate={meta.isInterstate}
          onInterstate={handleInterstate}
          lifa={lifa}
          onLifaToggle={handleLifaToggle}
          strategySaving={dispensing.saving}
          strategyLocked={!canChangeStrategy}
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

        {/* Prescription identity banner — the patient's name is otherwise invisible on this
            screen the whole time a prescription is being billed, only appearing after the
            fact on the saved invoice. Stays up for the whole session, unlike the toasts
            above, since it's context the pharmacist needs throughout, not a one-off event. */}
        {meta.prescriptionId && (
          <div className="flex items-center gap-3 bg-violet-50 border-b border-violet-200 px-5 py-2 flex-shrink-0">
            <FileText className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <p className="text-[12px] text-violet-800 font-medium flex-1 min-w-0 truncate">
              Billing {meta.prescriptionNumber || "prescription"}
              {meta.customerName && <> for <strong>{meta.customerName}</strong></>}
              {/* doctorName is free text a pharmacist (or a clinic's own field) may or may not
                  have typed "Dr." into already — same convention the DOCTOR field elsewhere on
                  this screen follows, showing it raw rather than forcing a prefix that would
                  double up as "Dr. Dr. Mehta". */}
              {meta.doctorName && <> · {meta.doctorName}</>}
            </p>
          </div>
        )}

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
          {/* `scrollbar-gutter: stable` + `overflow-hidden` reserve the same right-hand
              gutter the rows' scroll container reserves, so header and body columns stay
              aligned whether or not the cart is scrolling. */}
          <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50 overflow-hidden [scrollbar-gutter:stable]">
            <CartTableHeader />
          </div>
          <div className="flex-shrink-0 border-b border-slate-200 bg-white">
            <MedicineSearchCombobox
              lifa={lifa}
              onOpenAlternatives={(med, autoSuggest) =>
                setAltDrawer({ med, autoSuggest: autoSuggest ?? false })
              }
            />
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CartTableRows conflictInventoryIds={conflictInventoryIds} />
          </div>
        </div>

        {/* Substitutions: only rendered for a clinic prescription, and only when one is linked. */}
        {meta.prescriptionId && (
          <div className="px-6 pb-2 flex-shrink-0">
            <PrescriptionFulfilmentPanel prescriptionId={meta.prescriptionId} />
          </div>
        )}

        {/* Zone 4: Bottom totals bar */}
        <div
          className="flex items-center px-6 flex-shrink-0"
          style={{
            height: "56px",
            background: "linear-gradient(135deg, #3b0764 0%, #4c1d7c 40%, #5b21a8 100%)",
          }}
        >
          <AnimatePresence>
            {items.length > 0 && (
              <motion.button
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                onClick={handleClearBill}
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

            <div className="flex items-center gap-2 pl-2 border-l border-white/15">
              <Calculator className="w-5 h-5 text-white/40" />
            </div>

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
                          // Stop here so Escape closes just this cancel-reason step, not
                          // the whole receipt overlay too — the global Escape handler
                          // (BillingNewPage) would otherwise also fire on the same keystroke.
                          if (e.key === "Escape") { e.stopPropagation(); setCancelConfirm(false); setCancelReason(""); }
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

                  {invoice.items.some((i) => i.saleUnit === "LOOSE") && (
                    <button
                      onClick={() => setShowLabels(true)}
                      className="flex items-center gap-1.5 px-4 py-2 text-amber-700 hover:bg-amber-50 border border-amber-200 text-[13px] font-medium rounded-lg transition-colors"
                    >
                      <Scissors className="w-4 h-4" />
                      Print Label
                    </button>
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
                  <InvoicePrintSurface invoice={invoice} config={printConfig} pharmacy={printPharmacy} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showLabels && invoice && (
        <LooseLabelModal
          items={invoice.items
            .filter((i) => i.saleUnit === "LOOSE")
            .map((i) => ({
              medicineName: i.medicineName,
              quantity: i.quantity,
              baseUnit: i.baseUnit,
              batchNumber: i.batchNumber,
              expiryDate: i.expiryDate,
            }))}
          pharmacy={printPharmacy && { name: printPharmacy.name, drugLicense: printPharmacy.drugLicense, phone: printPharmacy.phone }}
          onClose={() => setShowLabels(false)}
        />
      )}

      {showTender && (
        <TenderModal
          // The whole-rupee payable, which is what the server bills — the legs have to
          // add up to the same figure it will check them against.
          total={roundedTotal}
          initial={meta.tenders}
          hasCustomer={!!meta.customerId && meta.customerId !== "COUNTER"}
          customerId={meta.customerId}
          advanceAvailable={meta.customerAdvanceBalance}
          onClose={() => setShowTender(false)}
          onConfirm={(tenders) => {
            // paymentMode is kept in step with the split so the tender bar and the
            // printed receipt agree with it; the server derives its own from the legs
            // either way. An empty list is "no split" and leaves the mode alone.
            const largest = tenders.reduce<typeof tenders[number] | null>(
              (best, t) => (best === null || t.amount > best.amount ? t : best), null);
            const credit = tenders.find((t) => t.mode === "CREDIT")?.amount ?? 0;
            setMeta({
              tenders,
              ...(largest ? { paymentMode: largest.mode } : {}),
              // Kept in step with the legs for the same reason the mode is: the receipt
              // prints from this. A split carrying a credit leg that still printed "PAID"
              // would hand the customer a receipt saying they owe nothing.
              ...(tenders.length > 0
                ? { paymentStatus: credit === 0 ? "PAID" as const
                    : credit >= roundedTotal ? "PENDING" as const : "PARTIAL" as const }
                : {}),
            });
            setShowTender(false);
          }}
        />
      )}

      {showAccount && (
        <CustomerAccountPanel
          customer={{ id: meta.customerId, name: meta.customerName }}
          onClose={() => setShowAccount(false)}
          // A deposit taken while this panel was open is spendable on the bill
          // underneath it the moment it closes — without this the tender dialog would
          // still be offering the balance as it stood before.
          onBalancesChanged={({ advance }) => setMeta({ customerAdvanceBalance: advance })}
        />
      )}
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
