import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, Stethoscope, Phone, Pill, Loader2, Receipt, BookmarkPlus, Ban,
  ShieldAlert, Hospital, CircleCheck, CircleAlert, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useBillingStore } from "@/components/billing/useBillingStore";
import { saveDraft } from "@/lib/draftStorage";
import {
  billableLines,
  type BillablePrescription,
  type ItemResolution,
} from "@/lib/prescriptionToCart";
import ReviewIngestedItemsPanel from "@/components/integration/ReviewIngestedItemsPanel";
import ConfirmQuantityPanel from "@/components/integration/ConfirmQuantityPanel";
import StockActionPanel, { pieceNoun, type StockInfo } from "@/components/integration/StockActionPanel";
import { usePackRoundingDecision } from "@/hooks/usePackRoundingDecision";
import { measuredWords, measuredPackSize, isResolvedMeasured, formatConversion } from "@/lib/measuredUnits";
import { PackSizeConfidenceChip } from "@/components/PackSizeConfidenceChip";
import { verifyPackSizeHref, type PackSizeConfidence } from "@/lib/packSizeConfidence";
import { getStoredUser } from "@/lib/auth";
import { saleUnitModel } from "@pharmacy/utils";

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
function emptyCartMessage(
  failures: string[],
  checkFailed: string[],
  skipped: { medicineName: string; reason: "hold" | "remove" }[],
): string {
  if (failures.length === 0 && checkFailed.length === 0 && skipped.length > 0) {
    return "Every line was held or removed — nothing left to bill";
  }
  if (failures.length === 0 && checkFailed.length > 0) {
    return "Couldn't check stock — check your connection and try again";
  }
  if (failures.length > 0 && checkFailed.length > 0) {
    return "Some medicines are out of stock, and stock couldn't be checked for the rest — check your connection and try again";
  }
  return "None of these medicines are in stock right now";
}

/**
 * For a measured (mL/g) prescription line, the two human sentences the pharmacist needs: what
 * the clinic actually prescribed, and what will be handed over once it is rounded up to whole
 * sealed packs (a bottle can't be split). Returns null for a countable line, or a measured line
 * still held for a pack count (roundedPackCount not set yet).
 */
function measuredDispenseSummary(item: {
  quantity: number;
  prescribedVolumeClinical?: number | null;
  clinicalUom?: string | null;
  roundedPackCount?: number | null;
  dosage?: string | null;
  duration?: string | null;
}) {
  const volume = item.prescribedVolumeClinical;
  const packs = item.roundedPackCount;
  if (volume == null || !item.clinicalUom || packs == null || packs <= 0) return null;
  const { unit, pack } = measuredWords(item.clinicalUom);
  const packNoun = `${packs} ${pack}${packs === 1 ? "" : "s"}`;
  const dosePart = [item.dosage, item.duration].filter(Boolean).join(" · ");
  const prescribed = `Prescribed: ${volume} ${unit}${dosePart ? ` (${dosePart})` : ""}`;
  // A pharmacist SETTLED this line by hand at the counter (confirmQuantity, on a line that had
  // been held for no pack size on record) rather than the engine resolving it — the tell is
  // `quantity === roundedPackCount`, since confirmQuantity stores the confirmed pack count as
  // both. `item.quantity` here is therefore already a PACK COUNT, not a base-unit volume, and
  // dividing it by `packs` (itself the same number) to guess a per-pack size produced "1 ml" —
  // the reported "Dispense: 3 bottles of 1 ml" beside a correctly confirmed "3 bottles". There
  // is no real per-pack size to report and no honest overage either, since nobody has told this
  // line what one pack actually holds; say only what is true.
  if (item.quantity === packs) {
    return { prescribed, dispense: `Dispense: ${packNoun} (confirmed)`, excess: null, roundedUp: false };
  }
  const packSize = Math.round(item.quantity / packs);
  const excess = item.quantity - volume;
  return {
    prescribed,
    dispense: `Dispense: ${packNoun} of ${packSize} ${unit}`,
    excess: excess > 0 ? `${excess} ${unit} over` : null,
    roundedUp: excess > 0,
  };
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
  /** True when `quantity` was worked out from dosage × duration rather than sent by the clinic. */
  quantityAutoCalculated?: boolean;
  /** How the quantity was calculated, or why it couldn't be — see PrescriptionQuantityCalculator (backend). */
  quantityCalculationNote?: string | null;
  /** For a measured (mL/g) line: the clinical volume the clinic prescribed. Null for a countable line. */
  prescribedVolumeClinical?: number | null;
  /** "ML" | "GM" — the unit `prescribedVolumeClinical` is in. */
  clinicalUom?: string | null;
  /** Whole sealed packs a measured course was rounded up to; null while pack size unknown / countable. */
  roundedPackCount?: number | null;
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

type StockResponseItem = {
  itemId: string; medicineId: string; availableQty: number; stockStatus: StockInfo["stockStatus"];
  baseUnit?: string | null; unit?: string | null;
  /** Live mL/g per sealed pack, and the pack count billing will allocate from it. */
  effectivePackSize?: number | null;
  projectedPackCount?: number | null;
  /** Set when that pack count is an implausible course for the dosage form — see DispensePlausibility. */
  packCountWarning?: string | null;
  /** How far the pack size this pharmacy bills by may be trusted; measured lines only. */
  packSizeConfidence?: PackSizeConfidence | null;
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
  // Correcting a pack size is OWNER/MANAGER only (PATCH /medicines/:id/loose-settings); anyone
  // else is pointed at the person who can, rather than at a screen that will refuse them.
  const canConfirmPackSize = ["OWNER", "MANAGER"].includes(getStoredUser()?.role ?? "");

  // A pharmacist's Replace/Hold/Remove decisions for out-of-stock lines, made right on this
  // screen. Local to this triage session on purpose — nothing here is written to the
  // prescription until a bill is actually saved, so closing without acting leaves the
  // prescription exactly as the clinic sent it.
  const [resolutions, setResolutions] = useState<Record<string, ItemResolution>>({});
  // Lines whose implausible-pack-count warning a pharmacist has explicitly accepted. Component
  // state, deliberately not persisted: the acknowledgement is about THIS bill, and the catalogue
  // value that triggered it should be corrected rather than permanently waved through.
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  useEffect(() => { setResolutions({}); setAcknowledged(new Set()); }, [rx.id]);

  /**
   * Bring this prescription's measured lines back in step with the catalogue before the
   * pharmacist reads them.
   *
   * A line is resolved to a pack target once, at ingest, and the catalogue can be reclassified
   * afterwards — so an open prescription can be carrying a number whose meaning has changed
   * since it was written (see PrescriptionService.reResolveStaleMeasuredLines). The server
   * enforces every invariant: ACTIVE only, nothing dispensed, EMR-sourced, and only when the
   * classification actually changed. It is idempotent, so calling it on every open is safe.
   *
   * Failure is deliberately silent: this is a correction, not the pharmacist's task. If it
   * cannot run, triage still renders the live conversion and the plausibility warning from the
   * stock check, which is what actually protects the bill.
   *
   * Two things keep it cheap. It is not sent at all when no line could qualify (every line is
   * unmatched or already has something handed over against it). And the parent is told only
   * when a line actually came back different: calling onChanged after every successful call
   * refetched the prescription on every single open, almost always to learn nothing.
   */
  useEffect(() => {
    if (!rx.items.some((i) => i.medicineId !== null && i.dispensedQty === 0)) return;
    const before = new Map(rx.items.map((i) => [i.id, i]));
    let cancelled = false;
    api.patch<{ data?: { items?: TriageItem[] } }>(`/prescriptions/${rx.id}/re-resolve`)
      .then(({ data }) => {
        if (cancelled) return;
        const changed = (data?.data?.items ?? []).some((after) => {
          const was = before.get(after.id);
          return !was
            || was.quantity !== after.quantity
            || (was.roundedPackCount ?? null) !== (after.roundedPackCount ?? null)
            || (was.clinicalUom ?? null) !== (after.clinicalUom ?? null);
        });
        if (changed) onChanged();
      })
      .catch(() => { /* triage still shows the live conversion — see above */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rx.id]);
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

  const { resolveWithRoundingDecision, roundingModal } = usePackRoundingDecision();

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
    (stockQuery.data ?? []).forEach((s) => {
      map[s.itemId] = {
        availableQty: s.availableQty, stockStatus: s.stockStatus,
        baseUnit: s.baseUnit, unit: s.unit,
        effectivePackSize: s.effectivePackSize,
        projectedPackCount: s.projectedPackCount,
        packCountWarning: s.packCountWarning,
        packSizeConfidence: s.packSizeConfidence,
      };
    });
    return map;
  }, [stockQuery.data]);

  /**
   * Lines whose pack count is implausible and which nobody has acknowledged or set aside yet.
   *
   * Gates BOTH footer actions, not just Bill Now: a draft is resolved through the very same
   * {@link resolvePrescriptionToCart}, so parking a suspect line as a draft would simply bake
   * the wrong pack count in for someone else to bill later — see that module's note on the two
   * save paths having to resolve identically.
   *
   * A line the pharmacist has already decided to Hold, Remove or Replace is not pending: they
   * have dealt with it, which is the whole point of the warning.
   */
  const pendingPackWarnings = useMemo(
    () => rx.items.filter((item) => {
      if (item.quantity <= 0 || item.quantity - item.dispensedQty <= 0) return false;
      if (acknowledged.has(item.id) || resolutions[item.id]) return false;
      return !!stockByItemId[item.id]?.packCountWarning;
    }).length,
    [rx.items, stockByItemId, acknowledged, resolutions],
  );

  /** Footer sentence when pack-count warnings are holding the actions, else null. */
  const packWarningBlock = pendingPackWarnings > 0
    ? `${pendingPackWarnings} line${pendingPackWarnings === 1 ? "" : "s"} would dispense an unusual number of `
      + `packs — check the pack size, or acknowledge to bill as calculated`
    : null;

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
      const resolved = await resolveWithRoundingDecision(rx, resolutions);
      if (!resolved) return; // pharmacist cancelled at the pack-rounding decision
      const { items, meta, failures, checkFailed, partials, skipped, reasons } = resolved;
      if (items.length === 0) {
        // Prefer the engine's specific per-line reason over the generic "empty cart" text.
        toast.error(reasons.length > 0
          ? reasons.map((r) => `${r.medicineName}: ${r.message}`).join("  •  ")
          : emptyCartMessage(failures, checkFailed, skipped));
        return;
      }
      // loadDraft (not addItem-per-line) so the cart is REPLACED. Appending would silently
      // merge this patient's prescription into whatever half-finished sale was already open.
      loadDraft(items, meta);
      if (reasons.length > 0) {
        for (const r of reasons) toast.warning(`${r.medicineName}: ${r.message}`);
      } else if (failures.length > 0) {
        toast.error(`Not in stock: ${failures.join(", ")} — add manually or substitute`);
      }
      if (checkFailed.length > 0) {
        toast.error(`Couldn't check stock for: ${checkFailed.join(", ")} — add manually if needed`);
      }
      if (partials.length > 0) {
        toast.info(partials.map((p) => `${p.medicineName}: billed ${p.available} of ${p.requested}`).join(" · "));
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
      const resolved = await resolveWithRoundingDecision(rx, resolutions);
      if (!resolved) return; // pharmacist cancelled at the pack-rounding decision
      const { items, meta, failures, checkFailed, partials, roundedToPack, skipped } = resolved;
      if (items.length === 0) {
        toast.error(emptyCartMessage(failures, checkFailed, skipped));
        return;
      }
      saveDraft(items, meta);
      const notes = [
        failures.length > 0 ? `${failures.join(", ")} not in stock` : null,
        checkFailed.length > 0 ? `couldn't check stock for ${checkFailed.join(", ")}` : null,
        partials.length > 0
          ? partials.map((p) => `${p.medicineName} billed ${p.available}/${p.requested}`).join(", ")
          : null,
        roundedToPack.length > 0
          ? roundedToPack.map((r) => `${r.medicineName} rounded up to ${r.dispensed}/${r.requested}`).join(", ")
          : null,
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
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
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
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
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
                const measured = measuredDispenseSummary(item);
                // The big number on the right: sealed-pack count for a measured line, piece
                // count otherwise. A countable line names its own pieces ("16 tablets") using
                // the units the stock check resolved for this medicine — a bare "16" against a
                // bare "In stock · 1050" gave a pharmacist two numbers and no way to tell
                // whether either meant strips or tablets. The noun waits on the stock query
                // rather than guessing: until it lands, the "qty" caption below still says what
                // the number is.
                const stockUnits = stockByItemId[item.id];
                // The mL→pack arithmetic billing is ABOUT to do, from live catalogue data.
                // Deliberately not `measured` above: that reads the line's stored
                // roundedPackCount, which is null for any line resolved before its medicine was
                // classified — the exact case where the conversion is most likely to be wrong
                // and least likely to be visible. This renders whenever the stock check says
                // the medicine is measured and has a pack size, whatever the line remembers.
                //
                // The numerator is the clinic's own clinical ask, not `remaining`, whenever
                // nothing has been dispensed yet and that figure is on record — `remaining` is
                // `quantity - dispensedQty`, and for an already-resolved line `quantity` is the
                // ROUNDED-UP target (e.g. 200 ml for a 150 ml prescription rounded to two 100 ml
                // bottles), so showing it here read as though the clinic had asked for 200 ml,
                // right below a "Prescribed: 150 ml" line one row up. The server applies the
                // identical rule for its own packCountWarning text — see PrescriptionService.
                // (This also excludes a pharmacist-settled line automatically: the server sends
                // no effectivePackSize for one, since its `quantity` is a confirmed pack count,
                // not a volume, and there is nothing left to project against it.)
                const conversionVolume = item.dispensedQty === 0 && item.prescribedVolumeClinical != null
                  ? item.prescribedVolumeClinical
                  : remaining;
                const conversion = !done && !unconfirmedQty && stockUnits?.effectivePackSize
                  ? formatConversion(
                      conversionVolume,
                      stockUnits.effectivePackSize,
                      item.clinicalUom ?? stockUnits.baseUnit,
                      saleUnitModel({ unit: stockUnits.unit, baseUnit: stockUnits.baseUnit }).packUnitLabel,
                    )
                  : null;
                const packWarning = done ? null : stockUnits?.packCountWarning ?? null;
                // Shown beside the conversion, not instead of it. The conversion says WHAT the
                // divisor is; this says whether anyone has ever checked it — and the second
                // question is the one the plausibility ceiling above cannot answer, because a
                // merely halved bottle volume produces an answer no ceiling objects to.
                const packConfidence: PackSizeConfidence | null | undefined =
                  done || !conversion ? null : stockUnits?.packSizeConfidence;
                const countableQty = done ? item.quantity : remaining;
                const qtyDisplay = unconfirmedQty
                  ? "—"
                  : measured
                    ? `${item.roundedPackCount} ${measuredWords(item.clinicalUom).pack}${item.roundedPackCount === 1 ? "" : "s"}`
                    : stockUnits
                      ? `${countableQty} ${pieceNoun(stockUnits, countableQty)}`
                      : String(countableQty);
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
                          {measured ? measured.prescribed : detailLine}
                          {item.notes && <span className="text-slate-400"> · {item.notes}</span>}
                        </p>
                        {/* The conversion, spelled out — shown for EVERY measured line, not just
                            anomalous ones. "40 QTY" hid the one number that was wrong; this puts
                            the divisor on screen next to the answer it produced, where a
                            pharmacist who has held the bottle can catch it at a glance. */}
                        {conversion && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className={cn(
                              "text-[11px] font-medium tabular-nums",
                              packWarning ? "text-amber-700" : "text-slate-500",
                            )}>
                              {conversion}
                            </span>
                            {/* A link out of a modal, rather than a dialog on top of one: the
                                pharmacist is mid-triage and confirming a pack size means walking
                                to a shelf. Sending them to Inventory with the row already found
                                is the honest version of "you can fix this" — a confirm dialog
                                here would only invite a guess, which is what put the wrong
                                number in the catalogue to begin with. */}
                            <PackSizeConfidenceChip
                              confidence={packConfidence}
                              medicineId={item.medicineId ?? undefined}
                              medicineName={item.medicineName}
                            />
                          </div>
                        )}
                        {measured && !done && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11.5px] font-semibold text-violet-700">
                              {measured.dispense}
                            </span>
                            {measured.roundedUp && (
                              <>
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-bold uppercase tracking-wide">
                                  Rounded up
                                </span>
                                {measured.excess && (
                                  <span className="text-[10.5px] text-amber-700">{measured.excess}</span>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {item.substituted && item.dispensedMedicineName && (
                          <p className="text-[10.5px] text-violet-600 mt-0.5">
                            Already dispensed as <span className="font-semibold">{item.dispensedMedicineName}</span> on an earlier sale
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={cn(
                          // A qty carrying its own noun ("16 tablets") needs the same
                          // narrower type a measured "2 bottles" already uses; only a bare
                          // number still gets the big display size.
                          measured || stockUnits ? "text-[12.5px]" : "text-[15px]",
                          "font-bold tabular-nums",
                          unconfirmedQty ? "text-amber-600" : "text-slate-800",
                        )}>
                          {qtyDisplay}
                        </p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">
                          {unconfirmedQty ? "not set" : done ? "dispensed" : item.dispensedQty > 0 ? "left" : "qty"}
                        </p>
                        {!unconfirmedQty && !done && item.quantityAutoCalculated && (
                          <p
                            title={item.quantityCalculationNote ?? "Calculated, not stated by the clinic"}
                            className="text-[9.5px] font-semibold text-violet-500 cursor-help"
                          >
                            calculated
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Implausible pack count — a wrong catalogue pack size, almost always.
                        Blocks Continue to Billing until acknowledged or the line is set aside,
                        but never blocks the OTHER lines and never rejects outright: a real
                        small-vial course has to stay dispensable, and the pharmacist is the one
                        who can see the shelf. */}
                    {packWarning && !needsPharmacistLink && (
                      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11.5px] text-amber-900 leading-snug">{packWarning}</p>
                          {/* Every way out, named — a warning that only says "check the pack size"
                              leaves a pharmacist asking where. Fixing the number is an owner/manager
                              job (the endpoint behind it is theirs), so anyone else is told who. */}
                          {!acknowledged.has(item.id) && item.medicineId && (
                            <p className="mt-1 text-[10.5px] text-amber-800 leading-snug">
                              If the pack size is wrong,{" "}
                              {canConfirmPackSize ? (
                                <Link
                                  to={verifyPackSizeHref(item.medicineId, item.medicineName)}
                                  className="font-semibold underline underline-offset-2 hover:text-amber-900"
                                >
                                  correct it in Inventory
                                </Link>
                              ) : (
                                <>ask an owner or manager to correct it</>
                              )}
                              . If the course really needs this many, acknowledge below — or Hold or Remove the line.
                            </p>
                          )}
                          {!acknowledged.has(item.id) && (
                            <button
                              type="button"
                              onClick={() => setAcknowledged((prev) => new Set(prev).add(item.id))}
                              className="mt-1.5 text-[11px] font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                            >
                              I&rsquo;ve checked the pack — bill it as calculated
                            </button>
                          )}
                          {acknowledged.has(item.id) && (
                            <p className="mt-1 text-[10.5px] font-semibold text-amber-700 uppercase tracking-wide">
                              Acknowledged
                            </p>
                          )}
                        </div>
                      </div>
                    )}

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
                        measured={isResolvedMeasured(item)
                          ? { clinicalUom: item.clinicalUom as string, packSize: measuredPackSize(item) }
                          : undefined}
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

          {/* Shown alongside blockedReason rather than instead of it: they are different tasks
              (match a medicine vs. verify a pack size) and a pharmacist needs to see both. */}
          {packWarningBlock && (
            <div className="flex items-start gap-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{packWarningBlock}</span>
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
              disabled={busy !== null || !canAct || pendingPackWarnings > 0}
              title={blockedReason ?? packWarningBlock ?? undefined}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700"
            >
              {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookmarkPlus className="w-4 h-4" />}
              Save as Draft
            </button>
            <button
              type="button"
              onClick={handleBillNow}
              disabled={busy !== null || !canAct || pendingPackWarnings > 0}
              title={blockedReason ?? packWarningBlock ?? undefined}
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
      {roundingModal}
    </div>
  );
}
