import { calcGstFromMrp } from "@pharmacy/utils";
import { api } from "@/lib/api-client";
import { DEFAULT_META } from "@/components/billing/useBillingStore";
import type { CartItem, BillingMeta } from "@/components/billing/useBillingStore";
import type { AlternativeResult, AlternativeBatch } from "@pharmacy/types";

/**
 * Turns a prescription into a billing cart.
 *
 * <p>Shared by both things a pharmacist can do with an arrived prescription — bill it now,
 * or park it in Sales → Drafts for later. Those two must resolve identically: a draft that
 * picked different batches from the ones Bill Now would have picked is a draft that bills
 * differently depending on which button was pressed, which nobody would ever expect.
 *
 * <p>A prescription line carries no batch and no price — only a medicine and a quantity —
 * so each line is resolved through the SAME FEFO endpoint the manual billing search uses.
 * Nothing here fabricates pricing.
 */

/** The prescription fields this needs. Structural, so both the page and its detail modal fit. */
export type BillablePrescription = {
  id: string;
  prescriptionNumber: string;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  doctor: { id: string; name: string } | null;
  items: {
    id: string;
    medicineId: string | null;
    medicineName: string;
    schedule: string | null;
    quantity: number;
    dispensedQty: number;
  }[];
};

/**
 * A pharmacist's explicit decision for a line the stock check flagged, made inline on the
 * triage screen rather than by silently dropping the line (the old behaviour {@link
 * resolvePrescriptionToCart} still falls back to when a line carries no resolution at all).
 *
 * <p>{@code replace} carries an already-built {@link CartItem} rather than just a medicine id:
 * the pharmacist chose it from a specific batch's live stock at click time (see the triage
 * screen's inline alternatives panel), and re-deriving it here via a second FEFO lookup could
 * silently pick a different batch than the one they were shown. Its {@code prescriptionItemId}
 * must be set to this line's id so billing attributes the substitution back to what was
 * prescribed (see {@code BillingService.recordDispensing}) instead of losing the link.
 */
export type ItemResolution =
  | { action: "replace"; cartItem: CartItem }
  | { action: "remove" }
  | { action: "hold" };

export type FefoBatch = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  mrp: number;
  available: number;
  medicine: { name: string; hsnCode: string | null; gstRate: number };
};

export type ResolvedCart = {
  items: CartItem[];
  /**
   * A COMPLETE bill header, built from a clean default rather than from whatever is already
   * in the store. Billing a prescription starts a new sale for a new patient; inheriting a
   * half-typed bill's customer discount or payment mode would be wrong in both directions.
   */
  meta: BillingMeta;
  /** Medicine names confirmed to have no sellable stock at all — the check succeeded and the answer was zero. */
  failures: string[];
  /**
   * Medicine names where the stock check itself failed (network error, server error) — NOT
   * confirmed absent. Kept separate from {@link failures} so the pharmacist is told "couldn't
   * check" rather than "not in stock", which would wrongly read as a confirmed answer when the
   * medicine may well be on the shelf.
   */
  checkFailed: string[];
  /**
   * Lines billed for LESS than prescribed because no single batch covers the full quantity —
   * never silent: the shortfall is always reported here so it can be surfaced, not just
   * quietly under-billed. See {@link resolvePrescriptionToCart}'s partial-fill fallback.
   */
  partials: { medicineName: string; requested: number; available: number }[];
  /** Lines a pharmacist explicitly chose to leave off this bill — see {@link ItemResolution}. */
  skipped: { medicineName: string; reason: "hold" | "remove" }[];
};

/**
 * Lines worth billing: linked to this pharmacy's catalogue, and still owing quantity.
 *
 * <p>The remainder, not the full quantity — a PARTIAL prescription has already had some of
 * it handed over, and re-billing that would charge the patient twice for the same strip.
 */
export function billableLines(rx: BillablePrescription) {
  return rx.items.filter((i) => i.medicineId && i.quantity - i.dispensedQty > 0);
}

/** True once every line is catalogue-linked and something is still owed. */
export function canBill(rx: BillablePrescription, needsReview: number) {
  return needsReview === 0 && billableLines(rx).length > 0;
}

/**
 * Resolves every billable line to a real stock batch.
 *
 * <p>A line with no stock is left OUT of the cart and named in {@link ResolvedCart.failures}
 * rather than added as a zero-stock row: the cart is a claim on real inventory, and a row
 * that cannot be fulfilled would fail at save with a message about a medicine the pharmacist
 * did not choose. Naming it up front lets them substitute it from the billing screen, which
 * is where the alternatives drawer already lives. A line whose check itself errored (not a
 * confirmed zero) is named separately in {@link ResolvedCart.checkFailed} instead.
 */
export async function resolvePrescriptionToCart(
  rx: BillablePrescription,
  resolutions?: Record<string, ItemResolution>,
): Promise<ResolvedCart> {
  const lines = billableLines(rx);
  const failures: string[] = [];
  const checkFailed: string[] = [];
  const partials: ResolvedCart["partials"] = [];
  const skipped: ResolvedCart["skipped"] = [];

  // Sequential rather than Promise.all: these hit the same inventory rows, and a burst of
  // parallel FEFO lookups on one prescription buys milliseconds while making the failure
  // order non-deterministic in the message the pharmacist reads.
  const items: CartItem[] = [];
  for (const line of lines) {
    const resolution = resolutions?.[line.id];

    if (resolution?.action === "remove" || resolution?.action === "hold") {
      skipped.push({ medicineName: line.medicineName, reason: resolution.action });
      continue;
    }
    if (resolution?.action === "replace") {
      // Already a complete CartItem, built from the exact batch the pharmacist was shown —
      // nothing left to resolve for this line.
      items.push(resolution.cartItem);
      continue;
    }

    const remaining = line.quantity - line.dispensedQty;
    try {
      const { data } = await api.get<{ data: FefoBatch | null }>(
        `/inventory/fefo/${line.medicineId}`,
        { params: { quantity: remaining } },
      );
      let batch = data.data;
      let fillQty = remaining;

      if (!batch) {
        // No single batch covers the full amount — fall back to "earliest-expiring batch
        // with ANY stock" (same FEFO ordering, just without the >= remaining floor) rather
        // than dropping the whole line. Still FEFO-correct: the soonest-to-expire stock is
        // exactly what should move first, whether it covers the full order or not.
        const partial = await api.get<{ data: FefoBatch | null }>(
          `/inventory/fefo/${line.medicineId}`,
          { params: { quantity: 1 } },
        );
        batch = partial.data.data;
        if (!batch) {
          failures.push(line.medicineName);
          continue;
        }
        fillQty = Math.min(remaining, batch.available);
        partials.push({ medicineName: line.medicineName, requested: remaining, available: fillQty });
      }

      items.push(buildCartItem(batch, line.schedule, fillQty));
    } catch {
      // The check itself failed (network/server error) — NOT a confirmed "no stock". Kept
      // out of `failures` so the pharmacist isn't told a wrong-but-confident "not in stock"
      // for a medicine the check never actually got an answer about.
      checkFailed.push(line.medicineName);
    }
  }

  return {
    items,
    meta: {
      ...DEFAULT_META,
      prescriptionId: rx.id,
      prescriptionNumber: rx.prescriptionNumber,
      doctorName: rx.doctorName,
      doctorId: rx.doctor?.id ?? "",
      customerName: rx.patientName,
      customerPhone: rx.patientPhone ?? "",
    },
    failures,
    checkFailed,
    partials,
    skipped,
  };
}

/**
 * Builds a complete cart row — money fields included.
 *
 * <p>They have to be computed here rather than left to the store: a draft is written to disk
 * as a finished CartItem and {@code loadDraft} puts it straight back into the cart without
 * recomputing anything, so a row saved with zeroed totals would resume as a zero-value bill.
 *
 * <p>Uses {@code calcGstFromMrp} — the SAME function the store's own recompute() calls — so
 * a row built here and a row built by adding the medicine by hand agree to the paisa. The
 * item-level calculation is always intra-state (CGST/SGST); IGST is applied at invoice level
 * from the bill's own interstate flag, exactly as the store does it.
 */
/** Exported so the triage screen's "search medicine instead" replace path can resolve a
 *  manually-picked medicine through the same FEFO-batch → CartItem math as everything else. */
export function buildCartItem(batch: FefoBatch, schedule: string | null, quantity: number): CartItem {
  const mrp = Number(batch.mrp);
  const gstRate = Number(batch.medicine.gstRate);
  const { taxableAmount, cgst, sgst, igst, totalAmount } =
    calcGstFromMrp(mrp, quantity, 0, gstRate, false);
  return {
    inventoryId: batch.id,
    medicineName: batch.medicine.name,
    hsnCode: batch.medicine.hsnCode,
    schedule,
    batchNumber: batch.batchNumber,
    expiryDate: batch.expiryDate,
    mrp,
    quantity,
    freeQty: 0,
    discount: 0,
    gstRate,
    availableStock: batch.available,
    rate: mrp,
    taxableAmount,
    cgst,
    sgst,
    igst,
    amount: totalAmount,
  };
}

/**
 * Builds a cart row for a pharmacist-chosen substitute — the "Replace" action on the triage
 * screen's inline stock-resolution panel.
 *
 * <p>Same money computation as {@link buildCartItem}, but sourced from an {@link
 * AlternativeResult}/{@link AlternativeBatch} pair (the same shape {@code AlternativesDrawer}
 * already fetches from {@code GET /medicines/{id}/alternatives}) rather than a FEFO batch, and
 * always carries {@code prescriptionItemId} so the substitution is attributed back to the
 * prescribed line at billing time instead of needing a second manual link on the billing page.
 *
 * <p>Quantity is capped at what this specific batch can actually cover — the pharmacist picked
 * it off a stock count shown a moment earlier, and asking for more than that batch holds would
 * only be caught later, at save, with a less useful error.
 */
export function buildAlternativeCartItem(
  alt: AlternativeResult,
  batch: AlternativeBatch,
  schedule: string | null,
  desiredQuantity: number,
  prescriptionItemId: string,
): CartItem {
  const mrp = Number(batch.mrp);
  const gstRate = Number(alt.gstRate);
  const available = batch.quantity - batch.reservedQuantity;
  const quantity = Math.max(1, Math.min(desiredQuantity, available));
  const { taxableAmount, cgst, sgst, igst, totalAmount } =
    calcGstFromMrp(mrp, quantity, 0, gstRate, false);
  return {
    inventoryId: batch.id,
    medicineName: alt.name,
    hsnCode: alt.hsnCode,
    schedule,
    batchNumber: batch.batchNumber,
    expiryDate: batch.expiryDate,
    mrp,
    quantity,
    freeQty: 0,
    discount: 0,
    gstRate,
    availableStock: available,
    prescriptionItemId,
    rate: mrp,
    taxableAmount,
    cgst,
    sgst,
    igst,
    amount: totalAmount,
  };
}
