import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  X, Stethoscope, Phone, Pill, Loader2, Receipt, BookmarkPlus, Ban,
  ShieldAlert, Hospital,
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
} from "@/lib/prescriptionToCart";
import ReviewIngestedItemsPanel from "@/components/integration/ReviewIngestedItemsPanel";
import ConfirmQuantityPanel from "@/components/integration/ConfirmQuantityPanel";

const SCHEDULE_TOOLTIP: Record<string, string> = {
  H:   "Schedule H — Prescription required",
  H1:  "Schedule H1 — High-risk prescription drug",
  X:   "Schedule X — Controlled substance",
  G:   "Schedule G — To be taken under medical supervision",
  OTC: "OTC — No prescription needed",
};

type TriageItem = {
  id: string;
  medicineName: string;
  medicineId: string | null;
  schedule: string | null;
  quantity: number;
  dispensedQty: number;
  dosage: string | null;
  duration: string | null;
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
  // with nothing left to sell.
  const blockedReason = reviewReasons.length > 0
    ? reviewReasons.join(" — and ")
    : nothingLeft
      ? "Everything on this prescription has already been dispensed"
      : null;
  const canAct = blockedReason === null;

  async function handleBillNow() {
    setBusy("bill");
    try {
      const { items, meta, failures } = await resolvePrescriptionToCart(rx);
      if (items.length === 0) {
        toast.error("None of these medicines are in stock right now");
        return;
      }
      // loadDraft (not addItem-per-line) so the cart is REPLACED. Appending would silently
      // merge this patient's prescription into whatever half-finished sale was already open.
      loadDraft(items, meta);
      if (failures.length > 0) {
        toast.error(`Not in stock: ${failures.join(", ")} — add manually or substitute`);
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
      const { items, meta, failures } = await resolvePrescriptionToCart(rx);
      if (items.length === 0) {
        toast.error("None of these medicines are in stock right now");
        return;
      }
      saveDraft(items, meta);
      toast.success(
        failures.length > 0
          ? `Saved to Sales → Drafts (${failures.join(", ")} not in stock)`
          : "Saved to Sales → Drafts",
      );
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
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-6 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)]"
      >
        {/* ── Header: where it came from, and who it's for ── */}
        <div className="bg-gradient-to-br from-violet-700 to-violet-600 px-6 pt-5 pb-6 flex-shrink-0 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="inline-flex items-center gap-1.5 bg-white/15 rounded-full px-2.5 py-1 mb-3">
            <Hospital className="w-3 h-3 text-violet-100" />
            <span className="text-[10px] font-bold text-violet-50 uppercase tracking-wider">
              Sent by clinic
            </span>
          </div>

          <h2 className="text-white text-[24px] font-bold leading-tight">{rx.patientName}</h2>
          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap text-[12px] text-violet-100">
            {rx.patientAge != null && (
              <span>{rx.patientAge} yrs{rx.patientGender ? ` · ${rx.patientGender}` : ""}</span>
            )}
            {rx.patientPhone && (
              <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{rx.patientPhone}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-3 text-[12px] text-violet-100">
            <Stethoscope className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-medium">{rx.doctorName}</span>
            {rx.prescribedDate && (
              <span className="text-violet-200">· {format(new Date(rx.prescribedDate), "d MMM yyyy")}</span>
            )}
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
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-3.5 py-2.5",
                      item.medicineId === null || unconfirmedQty
                        ? "border-amber-200 bg-amber-50/60"
                        : done
                          ? "border-slate-150 bg-slate-50 opacity-60"
                          : "border-slate-200 bg-white",
                    )}
                  >
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
                        {[item.dosage, item.duration].filter(Boolean).join(" · ") || "No dosage noted"}
                      </p>
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
              Bill Now
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
