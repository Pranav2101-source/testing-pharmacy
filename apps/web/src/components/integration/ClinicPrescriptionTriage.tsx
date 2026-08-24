import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, Stethoscope, Phone, Pill, Loader2, Receipt, BookmarkPlus, Ban,
  ShieldAlert, Hospital, CircleCheck, CircleAlert,
} from "lucide-react";
import { format } from "date-fns";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useBillingStore } from "@/components/billing/useBillingStore";
import { saveDraft } from "@/lib/draftStorage";
import {
  resolvePrescriptionToCart,
  billableLines,
  type BillablePrescription,
  type ItemResolution,
} from "@/lib/prescriptionToCart";
import ReviewIngestedItemsPanel from "@/components/integration/ReviewIngestedItemsPanel";
import ConfirmQuantityPanel from "@/components/integration/ConfirmQuantityPanel";
import StockActionPanel, { type StockInfo } from "@/components/integration/StockActionPanel";

const SCHEDULE_TOOLTIP: Record<string, string> = {
  H:   "Schedule H — Prescription required",
  H1:  "Schedule H1 — High-risk prescription drug",
  X:   "Schedule X — Controlled substance",
  G:   "Schedule G — To be taken under medical supervision",
  OTC: "OTC — No prescription needed",
};

/**
 * What to tell a pharmacist when {@link resolvePrescriptionToCart} came back with nothing to
 * bill. Two different causes read very differently: every line genuinely being unavailable is
 * not the same situation as a pharmacist having chosen to Hold or Remove every line themselves
 * — the second one is not a stock problem at all, and saying "not in stock" there would send
 * them looking for stock that was never the issue.
 */
function emptyCartMessage(failures: string[], skipped: { medicineName: string; reason: "hold" | "remove" }[]): string {
  if (failures.length === 0 && skipped.length > 0) {
    return "Every line was held or removed — nothing left to bill";
  }
  return "None of these medicines are in stock right now";
}

type TriageItem = {
  id: string;
  medicineName: string;
  medicineId: string | null;
  schedule: string | null;
  quantity: number;
  dispensedQty: number;
  dosage: string | null;
  duration: string | null;
  /** Pharmacy-relevant free text from the clinic — shown as "Instructions" (route/notes). */
  notes?: string | null;
  /** What was actually handed over on an EARLIER, already-completed sale against this line — distinct
   *  from a pending in-session "Replace" decision, which nothing has been sold against yet. */
  dispensedMedicineName?: string | null;
  substituted?: boolean;
  suggestions?: { medicineId: string; name: string; genericName: string | null; strength: string | null; form: string | null; similarity: number }[];
};

/**
 * Omit + re-declare rather than a plain intersection: intersecting two object types that
 * both carry `items` makes the property an intersection of the two array types, which no
 * longer reads as a single item shape. TriageItem is a superset of what the cart resolver
 * needs, so this stays assignable to {@link BillablePrescription} at the call site.
 */
export type TriagePrescription = Omit<BillablePrescription, "items"> & {
  patientAge: number | null;
  patientGender: string | null;
  prescribedDate: string | null;
  notes: string | null;
  needsReview: number;
  items: TriageItem[];
};

type StockResponseItem = { itemId: string; medicineId: string; availableQty: number; stockStatus: StockInfo["stockStatus"] };

/**
 * The moment a pharmacist opens a prescription a clinic just sent.
 *
 * <p>Built as a decision, not a record. A clinic-sent prescription arrives with exactly three
 * useful answers — fill it now, keep it for later, or refuse it — and the previous screen
 * buried those among patient metadata, linked invoices, and callback status panels. Here the
 * script is readable at a glance and the three answers are the loudest thing on it.
 *
 * <p>Anything that is not one of those three decisions is deliberately absent. Dispense
 * history, callback delivery state and the invoice list all still live on the full detail
 * view, which is one click away and is where someone goes to audit rather than to act.
 *
 * <p>Stock is checked here too (see {@link StockActionPanel}) but never gates the three
 * actions below — a shelf that is short one item is not a reason to block the rest of a
 * prescription. A pharmacist can Replace, Hold, or Remove an unavailable line right on this
 * screen; anything left unresolved is simply left off the bill and named in a toast, same as
 * it always was.
 */
export default function ClinicPrescriptionTriage({
  rx,
  onClose,
  onChanged,
  onOpenFullDetail,
}: {
  rx: TriagePrescription;
  onClose: () => void;
  onChanged: () => void;
  onOpenFullDetail: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const loadDraft = useBillingStore((s) => s.loadDraft);
  const [busy, setBusy] = useState<"bill" | "draft" | "cancel" | null>(null);

  // A pharmacist's Replace/Hold/Remove decisions for out-of-stock lines, made right on this
  // screen. Local to this triage session on purpose — nothing here is written to the
  // prescription until a bill is actually saved, so closing without acting leaves the
  // prescription exactly as the clinic sent it.
  const [resolutions, setResolutions] = useState<Record<string, ItemResolution>>({});
  useEffect(() => { setResolutions({}); }, [rx.id]);
  function resolveItem(itemId: string, r: ItemResolution) {
    setResolutions((prev) => ({ ...prev, [itemId]: r }));
  }
  function clearResolution(itemId: string) {
    setResolutions((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  // Computed from the lines themselves rather than trusting rx.needsReview as one opaque
  // count — a line can be blocked for either reason (unmatched medicine, unconfirmed
  // quantity) or both, and the banner below has to name the actual one so a pharmacist
  // knows which panel to use, not just that "something" needs attention.
  const unmatchedCount = rx.items.filter((i) => i.medicineId === null).length;
  const unconfirmedQtyCount = rx.items.filter((i) => i.quantity <= 0).length;
  const billable = billableLines(rx);
  const nothingLeft = billable.length === 0;

  const reviewReasons: string[] = [];
  if (unmatchedCount > 0) {
    reviewReasons.push(
      `${unmatchedCount} medicine${unmatchedCount === 1 ? "" : "s"} still need${unmatchedCount === 1 ? "s" : ""} matching to your stock`,
    );
  }
  if (unconfirmedQtyCount > 0) {
    reviewReasons.push(
      `${unconfirmedQtyCount} line${unconfirmedQtyCount === 1 ? "" : "s"} still need${unconfirmedQtyCount === 1 ? "s" : ""} a quantity confirmed`,
    );
  }
  // Two different reasons the actions are unavailable, and they want different words: one is
  // a task the pharmacist can do right now (below), the other is a finished prescription
  // with nothing left to sell. Stock is deliberately NOT one of these reasons — see the
  // module doc above.
  const blockedReason = reviewReasons.length > 0
    ? reviewReasons.join(" — and ")
    : nothingLeft
      ? "Everything on this prescription has already been dispensed"
      : null;
  const canAct = blockedReason === null;

  // ── Stock check ────────────────────────────────────────────────────────────
  // Keyed on more than rx.id: linking a medicine or confirming a quantity changes which
  // lines are checkable without changing rx.id, and this has to refetch when that happens.
  const stockKey = rx.items.map((i) => `${i.id}:${i.medicineId ?? ""}:${i.quantity}:${i.dispensedQty}`).join("|");
  const stockQuery = useQuery({
    queryKey: ["prescription-stock", rx.id, stockKey],
    queryFn: async () => {
      const { data } = await api.get<{ data: { items: StockResponseItem[] } }>(`/prescriptions/${rx.id}/stock`);
      return data.data.items;
    },
    enabled: rx.items.some((i) => i.medicineId !== null),
    staleTime: 15_000,
    // One retry, not the default three: a stock PREVIEW that's still spinning after a couple
    // of seconds is worse than one that gives up and lets a pharmacist resolve the line
    // manually — Replace/Hold/Remove all work without knowing the real stock number.
    retry: 1,
  });
  const stockByItemId = useMemo(() => {
    const map: Record<string, StockInfo> = {};
    (stockQuery.data ?? []).forEach((s) => { map[s.itemId] = { availableQty: s.availableQty, stockStatus: s.stockStatus }; });
    return map;
  }, [stockQuery.data]);

  // ── Bottom summary — "N medicines prescribed · N ready · N need attention" ──
  const summary = useMemo(() => {
    let ready = 0, attention = 0, done = 0, setAside = 0;
    for (const item of rx.items) {
      const unconfirmedQty = item.quantity <= 0;
      const remaining = item.quantity - item.dispensedQty;
      if (!unconfirmedQty && remaining <= 0) { done++; continue; }
      if (item.medicineId === null || unconfirmedQty) { attention++; continue; }
      const resolution = resolutions[item.id];
      if (resolution) {
        // Replace lands the substitute in the cart, so it is "ready" the same as an
        // in-stock line. Hold/Remove are a deliberate decision to leave the line OFF this
        // bill — counting those as "ready" would claim something is about to be billed
        // that Continue to Billing is actually going to skip.
        if (resolution.action === "replace") ready++; else setAside++;
        continue;
      }
      const stock = stockByItemId[item.id];
      if (!stock) {
        // Still checking counts in neither bucket yet, but a check that has definitively
        // FAILED should not sit in limbo forever — it needs the same human attention an
        // out-of-stock line would, since nobody actually knows the shelf count.
        if (stockQuery.isError) attention++;
        continue;
      }
      if (stock.stockStatus === "out_of_stock") attention++;
      else ready++;
    }
    return { total: rx.items.length, ready, attention, done, setAside };
  }, [rx.items, resolutions, stockByItemId, stockQuery.isError]);

  const summaryText = (() => {
    const parts = [`${summary.total} medicine${summary.total === 1 ? "" : "s"} prescribed`];
    if (summary.ready > 0) parts.push(`${summary.ready} ready`);
    if (summary.attention > 0) parts.push(`${summary.attention} need${summary.attention === 1 ? "s" : ""} attention`);
    if (summary.setAside > 0) parts.push(`${summary.setAside} set aside`);
    if (summary.done > 0) parts.push(`${summary.done} already dispensed`);
    return parts.join(" · ");
  })();

  async function handleBillNow() {
    setBusy("bill");
    try {
      const { items, meta, failures, skipped } = await resolvePrescriptionToCart(rx, resolutions);
      if (items.length === 0) {
        toast.error(emptyCartMessage(failures, skipped));
        return;
      }
      // loadDraft (not addItem-per-line) so the cart is REPLACED. Appending would silently
      // merge this patient's prescription into whatever half-finished sale was already open.
      loadDraft(items, meta);
      if (failures.length > 0) {
        toast.error(`Not in stock: ${failures.join(", ")} — add manually or substitute`);
      }
      if (skipped.length > 0) {
        toast.info(`Left off this bill: ${skipped.map((s) => s.medicineName).join(", ")}`);
      }
      navigate("/dashboard/billing/new");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not prepare the bill"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveDraft() {
    setBusy("draft");
    try {
      const { items, meta, failures, skipped } = await resolvePrescriptionToCart(rx, resolutions);
      if (items.length === 0) {
        toast.error(emptyCartMessage(failures, skipped));
        return;
      }
      saveDraft(items, meta);
      const notes = [
        failures.length > 0 ? `${failures.join(", ")} not in stock` : null,
        skipped.length > 0 ? `${skipped.map((s) => s.medicineName).join(", ")} left off` : null,
      ].filter(Boolean);
      toast.success(notes.length > 0 ? `Saved to Sales → Drafts (${notes.join("; ")})` : "Saved to Sales → Drafts");
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save this as a draft"));
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!confirm(`Cancel ${rx.prescriptionNumber}? The clinic will be told it was not filled.`)) return;
    setBusy("cancel");
    try {
      await api.delete(`/prescriptions/${rx.id}`);
      toast.success("Prescription cancelled — the clinic is being notified");
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
      onChanged();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to cancel prescription"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-6 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)]"
      >
        {/* ── Header: where it came from, and who it's for ── */}
        <div className="bg-violet-700 px-6 pt-5 pb-5 flex-shrink-0 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 bg-white/15 rounded-full px-2.5 py-1">
              <Hospital className="w-3 h-3 text-violet-100" />
              <span className="text-[10px] font-bold text-violet-50 uppercase tracking-wider">Sent by clinic</span>
            </span>
            <span className="text-[11px] font-semibold text-violet-200 tabular-nums">{rx.prescriptionNumber}</span>
          </div>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-white text-[21px] font-bold leading-tight">{rx.patientName}</h2>
              <div className="flex items-center gap-2.5 mt-1 flex-wrap text-[12px] text-violet-100">
                {rx.patientAge != null && (
                  <span>{rx.patientAge} yrs{rx.patientGender ? ` · ${rx.patientGender}` : ""}</span>
                )}
                {rx.patientPhone && (
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{rx.patientPhone}</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 text-[13px] text-white font-semibold justify-end">
                <Stethoscope className="w-3.5 h-3.5 flex-shrink-0" />
                {rx.doctorName}
              </div>
              {rx.prescribedDate && (
                <p className="text-[11.5px] text-violet-200 mt-0.5">
                  {format(new Date(rx.prescribedDate), "d MMM yyyy")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── The script itself ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
              <Pill className="w-3.5 h-3.5" /> Prescribed ({rx.items.length})
            </p>
            <div className="space-y-1.5">
              {rx.items.map((item) => {
                // quantity <= 0 is an unconfirmed placeholder (see ConfirmQuantityPanel), not
                // a real prescribed amount of zero — without this guard, "remaining <= 0" reads
                // as "already dispensed" for a line nothing has ever been sold against, and it
                // renders struck-through exactly when it most needs a pharmacist's attention.
                const unconfirmedQty = item.quantity <= 0;
                const remaining = item.quantity - item.dispensedQty;
                const done = !unconfirmedQty && remaining <= 0;
                const needsPharmacistLink = item.medicineId === null || unconfirmedQty;
                const detailLine = [item.dosage, item.duration].filter(Boolean).join(" · ") || "No dosage noted";
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg border px-3.5 py-2.5",
                      needsPharmacistLink
                        ? "border-amber-200 bg-amber-50/60"
                        : done
                          ? "border-slate-150 bg-slate-50 opacity-60"
                          : "border-slate-200 bg-white",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn("text-[14px] font-semibold text-slate-800", done && "line-through")}>
                            {item.medicineName}
                          </span>
                          {item.schedule && (
                            <span
                              title={SCHEDULE_TOOLTIP[item.schedule] ?? item.schedule}
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-bold cursor-help",
                                item.schedule === "X" ? "bg-red-100 text-red-700"
                                  : item.schedule === "H1" ? "bg-orange-100 text-orange-700"
                                  : item.schedule === "H" ? "bg-yellow-100 text-yellow-700"
                                  : "bg-slate-100 text-slate-600",
                              )}
                            >
                              {item.schedule}
                            </span>
                          )}
                        </div>
                        <p className="text-[11.5px] text-slate-500 mt-0.5">
                          {detailLine}
                          {item.notes && <span className="text-slate-400"> · {item.notes}</span>}
                        </p>
                        {item.substituted && item.dispensedMedicineName && (
                          <p className="text-[10.5px] text-violet-600 mt-0.5">
                            Already dispensed as <span className="font-semibold">{item.dispensedMedicineName}</span> on an earlier sale
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={cn(
                          "text-[15px] font-bold tabular-nums",
                          unconfirmedQty ? "text-amber-600" : "text-slate-800",
                        )}>
                          {unconfirmedQty ? "—" : done ? item.quantity : remaining}
                        </p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">
                          {unconfirmedQty ? "not set" : done ? "dispensed" : item.dispensedQty > 0 ? "left" : "qty"}
                        </p>
                      </div>
                    </div>

                    {/* Stock check + Replace/Hold/Remove — only meaningful once the line has a
                        catalogue medicine, a confirmed quantity, and is still owed. */}
                    {!needsPharmacistLink && !done && (
                      <StockActionPanel
                        medicineId={item.medicineId as string}
                        medicineName={item.medicineName}
                        schedule={item.schedule}
                        remaining={remaining}
                        prescriptionItemId={item.id}
                        stock={stockByItemId[item.id]}
                        stockCheckFailed={stockQuery.isError}
                        resolution={resolutions[item.id]}
                        onResolve={(r) => resolveItem(item.id, r)}
                        onClear={() => clearResolution(item.id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* The tasks that can block all three actions — kept right above them. */}
          <ReviewIngestedItemsPanel
            prescriptionId={rx.id}
            items={rx.items}
            onLinked={onChanged}
          />
          <ConfirmQuantityPanel
            prescriptionId={rx.id}
            items={rx.items}
            onConfirmed={onChanged}
          />

          {rx.notes && (
            <div className="rounded-xl bg-slate-50 border border-slate-150 px-3.5 py-2.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                Note from the clinic
              </p>
              <p className="text-[13px] text-slate-700">{rx.notes}</p>
            </div>
          )}
        </div>

        {/* ── The decision ── */}
        <div className="flex-shrink-0 border-t border-slate-150 bg-slate-50/80 px-6 py-4 space-y-3">
          <div className="flex items-center gap-1.5 text-[12px] text-slate-500 font-medium">
            {summary.attention > 0
              ? <CircleAlert className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              : <CircleCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
            {summaryText}
          </div>

          {blockedReason && (
            <div className="flex items-start gap-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{blockedReason}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy !== null}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {busy === "cancel" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={busy !== null || !canAct}
              title={blockedReason ?? undefined}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700"
            >
              {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookmarkPlus className="w-4 h-4" />}
              Save as Draft
            </button>
            <button
              type="button"
              onClick={handleBillNow}
              disabled={busy !== null || !canAct}
              title={blockedReason ?? undefined}
              className="flex-[1.3] flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-violet-600 text-white text-[13px] font-bold shadow-sm hover:bg-violet-700 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-violet-600 disabled:active:scale-100"
            >
              {busy === "bill" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
              Continue to Billing
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenFullDetail}
            className="w-full text-center text-[11.5px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            View full record — {rx.prescriptionNumber}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
