import { calcGstFromMrp } from "@pharmacy/utils";
import { api } from "@/lib/api-client";
import { DEFAULT_META } from "@/components/billing/useBillingStore";
import type { CartItem, BillingMeta } from "@/components/billing/useBillingStore";

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
    medicineId: string | null;
    medicineName: string;
    schedule: string | null;
    quantity: number;
    dispensedQty: number;
  }[];
};

type FefoBatch = {
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
  /** Medicine names that could not be put in the cart — no stock, or the lookup failed. */
  failures: string[];
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
 * is where the alternatives drawer already lives.
 */
export async function resolvePrescriptionToCart(rx: BillablePrescription): Promise<ResolvedCart> {
  const lines = billableLines(rx);
  const failures: string[] = [];

  // Sequential rather than Promise.all: these hit the same inventory rows, and a burst of
  // parallel FEFO lookups on one prescription buys milliseconds while making the failure
  // order non-deterministic in the message the pharmacist reads.
  const items: CartItem[] = [];
  for (const line of lines) {
    const remaining = line.quantity - line.dispensedQty;
    try {
      const { data } = await api.get<{ data: FefoBatch | null }>(
        `/inventory/fefo/${line.medicineId}`,
        { params: { quantity: remaining } },
      );
      const batch = data.data;
      if (!batch) {
        failures.push(line.medicineName);
        continue;
      }
      items.push(buildCartItem(batch, line.schedule, remaining));
    } catch {
      failures.push(line.medicineName);
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
function buildCartItem(batch: FefoBatch, schedule: string | null, quantity: number): CartItem {
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
