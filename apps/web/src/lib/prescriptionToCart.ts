import { calcGstFromMrp, perPieceMrp, isMeasuredBaseUnit } from "@pharmacy/utils";
import { api } from "@/lib/api-client";
import { DEFAULT_META } from "@/components/billing/useBillingStore";
import type { CartItem, BillingMeta, SaleUnit } from "@/components/billing/useBillingStore";
import type {
  AlternativeResult, AlternativeBatch,
  DispensingPlan, DispensingPlanLine, DispensingAllocation,
} from "@pharmacy/types";

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
  /** Loose pieces already open on this batch — 0 for pack-only stock. */
  looseUnits?: number;
  medicine: {
    name: string; hsnCode: string | null; gstRate: number;
    /** Effective pack size (this pharmacy's override, else the catalogue's). */
    unitsPerPack?: number | null;
    baseUnit?: string | null;
    /** This pharmacy's opt-in for cut-strip selling of this medicine. */
    allowLooseSale?: boolean;
  };
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
   * The exact, pharmacist-readable reason each blocked line could not be filled — from the
   * dispensing engine ({@code DispensingPlan.Line.message}). Covers "no stock", "less than a
   * full pack and loose selling is off", "medicine no longer in the catalogue", and partial /
   * rounded-up outcomes. Keyed by medicine name so a caller can show the specific sentence
   * instead of a blanket "not in stock".
   */
  reasons: { medicineName: string; message: string }[];
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
  /**
   * Lines billed for MORE pieces than prescribed because this pharmacy cannot cut a strip
   * for this medicine (loose selling off here, or Schedule X) and the prescribed count fell
   * between whole packs — rounded up to the nearest full pack rather than shorting the
   * course. See {@link resolveSaleUnit}.
   *
   * <p>{@code medicineId}/{@code unitsPerPack}/{@code schedule} are present only for a line
   * resolved through the normal FEFO path (not a pharmacist-chosen "Replace" substitute,
   * which carries no catalogue medicineId in its {@link CartItem}) — see {@code
   * PackRoundingModal}, the only reader of these three, for why: it needs them to offer
   * "turn loose selling on and bill the exact amount instead" without a second lookup.
   */
  roundedToPack: {
    medicineName: string;
    requested: number;
    dispensed: number;
    medicineId?: string;
    unitsPerPack?: number;
    schedule?: string | null;
  }[];
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
 *
 * <p>A prescription line's {@code quantity} is always a PIECE count ("8 tablets"), never a
 * pack count — {@link buildCartItem} is what turns that into whatever this pharmacy can
 * actually dispense (a whole pack, a loose cut-strip line, or a pack rounded up to cover the
 * course), and {@link ResolvedCart.partials}/{@link ResolvedCart.roundedToPack} report
 * whenever what was billed differs from what was asked for.
 */
export async function resolvePrescriptionToCart(
  rx: BillablePrescription,
  resolutions?: Record<string, ItemResolution>,
): Promise<ResolvedCart> {
  const lines = billableLines(rx);
  const failures: string[] = [];
  const checkFailed: string[] = [];
  const partials: ResolvedCart["partials"] = [];
  const roundedToPack: ResolvedCart["roundedToPack"] = [];
  const skipped: ResolvedCart["skipped"] = [];
  const reasons: ResolvedCart["reasons"] = [];
  const items: CartItem[] = [];

  // ONE call: the backend dispensing engine resolves every billable line to real
  // batches, in the pharmacy's configured order (LILA/FEFO or LIFA), with pack /
  // loose / round-up already worked out. The frontend does not pick batches or
  // reason about the strategy — see DispensingService / DispensingPlan.
  let planByMedicine: Map<string, DispensingPlanLine[]>;
  try {
    const { data } = await api.get<{ data: DispensingPlan }>(
      `/dispensing/prescriptions/${rx.id}/plan`,
    );
    planByMedicine = new Map();
    for (const pl of data.data.lines) {
      if (!pl.medicineId) continue;
      const q = planByMedicine.get(pl.medicineId) ?? [];
      q.push(pl);
      planByMedicine.set(pl.medicineId, q);
    }
  } catch {
    // The plan call itself failed (network/server) — NOT a confirmed "no stock".
    // Every line the pharmacist did not explicitly resolve is "couldn't check".
    planByMedicine = new Map();
    for (const line of lines) {
      const r = resolutions?.[line.id];
      if (r?.action === "remove" || r?.action === "hold") {
        skipped.push({ medicineName: line.medicineName, reason: r.action });
      } else if (r?.action === "replace") {
        items.push(r.cartItem);
      } else {
        checkFailed.push(line.medicineName);
      }
    }
    return buildResult(rx, items, failures, checkFailed, partials, roundedToPack, skipped, reasons);
  }

  for (const line of lines) {
    const resolution = resolutions?.[line.id];

    if (resolution?.action === "remove" || resolution?.action === "hold") {
      skipped.push({ medicineName: line.medicineName, reason: resolution.action });
      continue;
    }
    if (resolution?.action === "replace") {
      const ci = resolution.cartItem;
      items.push(ci);
      const owed = line.quantity - line.dispensedQty;
      const given = ci.saleUnit === "LOOSE" ? ci.quantity : ci.quantity * (ci.unitsPerPack ?? 1);
      if (given < owed) partials.push({ medicineName: ci.medicineName, requested: owed, available: given });
      // A measured (mL/g) line billed over the prescribed volume is an expected round-up
      // to whole sealed bottles/tubes, not a "cut the strip?" decision — surface it as a
      // note (reasons), never through PackRoundingModal. Only countable units go there.
      else if (given > owed && !isMeasuredBaseUnit(ci.baseUnit)) {
        roundedToPack.push({ medicineName: ci.medicineName, requested: owed, dispensed: given });
      } else if (given > owed) {
        reasons.push({
          medicineName: ci.medicineName,
          message: `${owed} prescribed — billing ${given} (${ci.quantity} sealed `
            + `${ci.quantity === 1 ? "pack" : "packs"}). A sealed pack can't be split.`,
        });
      }
      continue;
    }

    const remaining = line.quantity - line.dispensedQty;
    // Match this prescribed line to its plan line by medicine; a queue handles a
    // doctor prescribing the same medicine on two lines.
    const planLine = line.medicineId ? planByMedicine.get(line.medicineId)?.shift() : undefined;

    if (!planLine || planLine.allocations.length === 0) {
      // The engine could not fill this line — carry its exact reason so the pharmacist
      // sees "less than a full pack, loose selling off" rather than a blanket "no stock".
      failures.push(line.medicineName);
      if (planLine?.message) reasons.push({ medicineName: line.medicineName, message: planLine.message });
      continue;
    }

    for (const alloc of planLine.allocations) {
      items.push(cartItemFromAllocation(alloc, planLine.medicineId, line.medicineName, line.schedule));
    }
    if (planLine.message) reasons.push({ medicineName: line.medicineName, message: planLine.message });
    if (planLine.shortfallPieces && planLine.shortfallPieces > 0) {
      partials.push({
        medicineName: line.medicineName,
        requested: remaining,
        available: planLine.dispensedPieces,
      });
    } else if (
      planLine.roundedUpToPieces && planLine.roundedUpToPieces > remaining
      && !isMeasuredBaseUnit(planLine.allocations[0]?.baseUnit)
    ) {
      // Countable units only. A measured (mL/g) line that rounded up to whole
      // sealed bottles/tubes is expected — you cannot dispense half a bottle — so
      // it never opens PackRoundingModal; the backend's `message` (already pushed to
      // `reasons` above) is the inline note that explains it.
      // medicineId/unitsPerPack/schedule travel with this entry so PackRoundingModal
      // can offer "turn loose selling on and bill the exact amount" without a lookup.
      roundedToPack.push({
        medicineName: line.medicineName,
        requested: remaining,
        dispensed: planLine.roundedUpToPieces,
        medicineId: line.medicineId ?? undefined,
        unitsPerPack: planLine.allocations[0]?.unitsPerPack ?? undefined,
        schedule: line.schedule,
      });
    }
  }

  return buildResult(rx, items, failures, checkFailed, partials, roundedToPack, skipped, reasons);
}

/** A dispensing-plan allocation → a finished cart row (money fields included). */
function cartItemFromAllocation(
  alloc: DispensingAllocation,
  medicineId: string | null,
  medicineName: string,
  schedule: string | null,
): CartItem {
  return {
    inventoryId: alloc.inventoryId,
    medicineId: medicineId ?? undefined,
    medicineName,
    hsnCode: alloc.hsnCode,
    schedule,
    batchNumber: alloc.batchNumber,
    expiryDate: alloc.expiryDate,
    mrp: alloc.mrp,
    quantity: alloc.quantity,
    freeQty: 0,
    discount: 0,
    gstRate: alloc.gstRate,
    availableStock: alloc.availableStock,
    saleUnit: alloc.saleUnit,
    unitsPerPack: alloc.unitsPerPack ?? undefined,
    baseUnit: alloc.baseUnit ?? undefined,
    packSize: alloc.packSize ?? undefined,
    allowLooseSale: alloc.allowLooseSale,
    looseUnits: alloc.looseUnits,
    rate: alloc.rate,
    taxableAmount: alloc.taxableAmount,
    cgst: alloc.cgst,
    sgst: alloc.sgst,
    igst: alloc.igst,
    amount: alloc.amount,
  };
}

function buildResult(
  rx: BillablePrescription,
  items: CartItem[],
  failures: string[],
  checkFailed: string[],
  partials: ResolvedCart["partials"],
  roundedToPack: ResolvedCart["roundedToPack"],
  skipped: ResolvedCart["skipped"],
  reasons: ResolvedCart["reasons"] = [],
): ResolvedCart {

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
    roundedToPack,
    skipped,
    reasons,
  };
}

/**
 * Turns a prescription's piece count into whatever a specific batch can actually be sold as.
 *
 * <p>A prescription line is always a piece count ("8 tablets") — see the module doc.
 * Silently billing that raw number as a PACK count (what every caller here did before this
 * existed) turns "8 tablets" into 8 whole strips. This is the one place that decision gets
 * made, shared by {@link buildCartItem} and {@link buildAlternativeCartItem} so a prescription
 * resolves the same way whether the medicine that covers it is the one prescribed or a
 * pharmacist-chosen substitute.
 *
 * <p>Three outcomes, in order:
 * <ol>
 *   <li>The request is itself a whole number of packs — always sold as a pack, loose or not
 *       (cutting a sealed strip open to sell back a complete pack's worth of pieces is exactly
 *       what BillingService's own guard refuses), UNLESS an already-open remainder alone
 *       covers it without touching a sealed strip.
 *   <li>Otherwise, if this pharmacy allows loose selling here (and it is not Schedule X): sold
 *       loose, in pieces.
 *   <li>Otherwise: rounded UP to the nearest whole pack — never short a prescribed course by a
 *       few tablets over a sealed-strip policy — capped at how many whole packs are actually
 *       on the shelf.
 * </ol>
 *
 * <p>Every branch is capped at what the batch actually holds. Returns null when nothing
 * sellable exists under this pharmacy's settings at all (no stock, or less than one whole
 * pack and this medicine cannot be sold loose here) — the caller reports that exactly like
 * any other "no sellable stock" case.
 */
function resolveSaleUnit(
  medicine: { unitsPerPack?: number | null; allowLooseSale?: boolean },
  schedule: string | null,
  requestedPieces: number,
  packsAvailable: number,
  looseUnitsAvailable: number | undefined,
): { saleUnit: SaleUnit; quantity: number } | null {
  const upp = medicine.unitsPerPack ?? 1;
  const packs = Math.max(packsAvailable, 0);

  if (upp <= 1) {
    // No structured pack multiple — this includes an unclassified syrup/cream, where
    // the catalogue does not record how many mL/g are in a bottle/tube. The requested
    // number is taken as a WHOLE-PACK count (bottles/tubes), never as loose mL to be
    // divided into packs: there is no honest divisor. The quantity-entry UI labels the
    // field with the pack unit so the pharmacist enters bottles, not mL.
    const quantity = Math.min(requestedPieces, packs);
    return quantity > 0 ? { saleUnit: "PACK", quantity } : null;
  }

  const looseUnits = Math.max(looseUnitsAvailable ?? 0, 0);
  const looseOk = !!medicine.allowLooseSale && (schedule ?? "").trim().toUpperCase() !== "X";
  const wholeMultiple = requestedPieces > 0 && requestedPieces % upp === 0;
  const packsNeeded = requestedPieces / upp;

  // Sell as whole packs only when it IS a whole number of packs, enough SEALED
  // packs are on the batch to cover it, and the open remainder doesn't already
  // cover it — mirrors BillingService's guard. If sealed packs fall short, cutting
  // is the only way to fill the line, so fall through to the loose branch (which
  // draws on packs*upp + the remainder) rather than shorting to whole packs and
  // reporting a partial the pharmacy could actually have filled.
  if (wholeMultiple && packs >= packsNeeded && !(looseOk && looseUnits >= requestedPieces)) {
    return { saleUnit: "PACK", quantity: packsNeeded };
  }

  if (looseOk) {
    const quantity = Math.min(requestedPieces, packs * upp + looseUnits);
    return quantity > 0 ? { saleUnit: "LOOSE", quantity } : null;
  }

  const desiredPacks = Math.min(Math.ceil(requestedPieces / upp), packs);
  return desiredPacks > 0 ? { saleUnit: "PACK", quantity: desiredPacks } : null;
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
 *
 * <p>{@code requestedPieces} is a piece count, resolved to a PACK or LOOSE line by {@link
 * resolveSaleUnit}. Returns null when nothing is sellable under this pharmacy's settings —
 * the caller reports that as it would any other "no stock" case.
 */
/** Exported so the triage screen's "search medicine instead" replace path can resolve a
 *  manually-picked medicine through the same FEFO-batch → CartItem math as everything else. */
export function buildCartItem(batch: FefoBatch, schedule: string | null, requestedPieces: number): CartItem | null {
  const resolved = resolveSaleUnit(batch.medicine, schedule, requestedPieces, batch.available, batch.looseUnits);
  if (!resolved) return null;

  const mrp = Number(batch.mrp);
  const gstRate = Number(batch.medicine.gstRate);
  const upp = batch.medicine.unitsPerPack ?? undefined;
  const isLoose = resolved.saleUnit === "LOOSE";
  const unitMrp = isLoose ? perPieceMrp(mrp, upp) : mrp;
  const { taxableAmount, cgst, sgst, igst, totalAmount } =
    calcGstFromMrp(unitMrp, resolved.quantity, 0, gstRate, false);
  return {
    inventoryId: batch.id,
    medicineName: batch.medicine.name,
    hsnCode: batch.medicine.hsnCode,
    schedule,
    batchNumber: batch.batchNumber,
    expiryDate: batch.expiryDate,
    mrp,
    quantity: resolved.quantity,
    freeQty: 0,
    discount: 0,
    gstRate,
    availableStock: batch.available,
    saleUnit: resolved.saleUnit,
    unitsPerPack: upp,
    baseUnit: batch.medicine.baseUnit ?? undefined,
    allowLooseSale: batch.medicine.allowLooseSale,
    looseUnits: batch.looseUnits,
    rate: Math.round(unitMrp * 100) / 100,
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
 * <p>{@code desiredPieces} is resolved through the same {@link resolveSaleUnit} as
 * {@link buildCartItem} — the pharmacist picked this batch off a stock count shown a moment
 * earlier, so the same piece-vs-pack math applies to a substitute as to the original medicine.
 * Returns null on the (should-not-happen, given the caller pre-filters for stock) case that
 * nothing is sellable at all.
 */
export function buildAlternativeCartItem(
  alt: AlternativeResult,
  batch: AlternativeBatch,
  schedule: string | null,
  desiredPieces: number,
  prescriptionItemId: string,
): CartItem | null {
  const packsAvailable = batch.quantity - batch.reservedQuantity;
  const resolved = resolveSaleUnit(alt, schedule, desiredPieces, packsAvailable, batch.looseUnits);
  if (!resolved) return null;

  const mrp = Number(batch.mrp);
  const gstRate = Number(alt.gstRate);
  const upp = alt.unitsPerPack ?? undefined;
  const isLoose = resolved.saleUnit === "LOOSE";
  const unitMrp = isLoose ? perPieceMrp(mrp, upp) : mrp;
  const { taxableAmount, cgst, sgst, igst, totalAmount } =
    calcGstFromMrp(unitMrp, resolved.quantity, 0, gstRate, false);
  return {
    inventoryId: batch.id,
    medicineName: alt.name,
    hsnCode: alt.hsnCode,
    schedule,
    batchNumber: batch.batchNumber,
    expiryDate: batch.expiryDate,
    mrp,
    quantity: resolved.quantity,
    freeQty: 0,
    discount: 0,
    gstRate,
    availableStock: Math.max(packsAvailable, 0),
    prescriptionItemId,
    saleUnit: resolved.saleUnit,
    unitsPerPack: upp,
    baseUnit: alt.baseUnit ?? undefined,
    allowLooseSale: alt.allowLooseSale,
    looseUnits: batch.looseUnits,
    rate: Math.round(unitMrp * 100) / 100,
    taxableAmount,
    cgst,
    sgst,
    igst,
    amount: totalAmount,
  };
}
