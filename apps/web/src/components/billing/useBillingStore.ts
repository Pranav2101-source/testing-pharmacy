"use client";
import { create } from "zustand";
import { calcGstFromMrp, calcInvoiceTotals, perPieceMrp, saleUnitModel, titleCaseUnit, pluraliseUnit } from "@pharmacy/utils";

export type SaleUnit = "PACK" | "LOOSE";

/**
 * A problem with one cart line that the server WILL reject at save. Caught here so
 * the cashier fixes it in the cart with one click, not after a bounced round-trip
 * mid-queue. Messages mirror BillingService's own 422s.
 */
export type LineIssue = {
  code: "WHOLE_PACK_LOOSE" | "SCHEDULE_X_LOOSE" | "LOOSE_NOT_ENABLED" | "NO_PACK_SIZE";
  message:  string;
  fixLabel: string;
  /** The exact patch that clears it — applied verbatim by patchLine(). */
  fix: Partial<CartItem>;
  /**
   * A second, deliberate way past the issue — only WHOLE_PACK_LOOSE has one:
   * "cut it anyway" when the pharmacist really does want to open a sealed strip.
   * Applied verbatim by patchLine() just like {@link fix}.
   */
  override?: { label: string; patch: Partial<CartItem> };
};

/** How many SEALED strips a loose line will cut open (0 if the open remainder covers it). */
export function looseStripsOpened(item: Pick<CartItem, "saleUnit" | "quantity" | "unitsPerPack" | "looseUnits">): number {
  if (item.saleUnit !== "LOOSE") return 0;
  const upp = item.unitsPerPack ?? 1;
  if (upp <= 1) return 0;
  const fromSealed = Math.max(0, item.quantity - (item.looseUnits ?? 0));
  return Math.ceil(fromSealed / upp);
}

/**
 * Returns the blocking issue on a line, or null. Pure — safe to call in render and
 * from the save handler.
 */
export function lineIssue(item: CartItem): LineIssue | null {
  if (item.saleUnit !== "LOOSE") return null;
  const upp = item.unitsPerPack ?? 1;
  const name = item.medicineName;
  // "Sell as Strip" for a tablet, "Sell as Bottle" for a syrup, "Sell as Tube" for
  // a cream — the fix label and every message read the medicine's own sale-unit word.
  const unit = saleUnitModel({
    baseUnit: item.baseUnit, unitsPerPack: item.unitsPerPack,
    allowLooseSale: item.allowLooseSale, schedule: item.schedule,
  });
  const P = titleCaseUnit(unit.packUnitLabel);

  if (upp <= 1) {
    return {
      code: "NO_PACK_SIZE",
      message: `"${name}" has no pack size on record, so it can't be sold loose.`,
      fixLabel: `Sell as ${P}`,
      fix: { saleUnit: "PACK", quantity: 1 },
    };
  }
  if (!item.allowLooseSale) {
    return {
      code: "LOOSE_NOT_ENABLED",
      message: `Loose selling is off for "${name}".`,
      fixLabel: `Sell as ${P}`,
      fix: { saleUnit: "PACK", quantity: Math.max(1, Math.ceil(item.quantity / upp)) },
    };
  }
  if ((item.schedule ?? "").trim().toUpperCase() === "X") {
    return {
      code: "SCHEDULE_X_LOOSE",
      message: `"${name}" is Schedule X — it must be sold in the original pack.`,
      fixLabel: `Sell as ${P}`,
      fix: { saleUnit: "PACK", quantity: Math.max(1, Math.ceil(item.quantity / upp)) },
    };
  }
  // Whole packs asked for as loose — only a problem if it would cut SEALED strips
  // AND there are enough sealed strips on the batch to sell as packs instead. If
  // stock falls short, cutting is the only way to fill the line (mirrors
  // BillingService's guard) — flagging it would send the cashier to a dead end.
  // A line the cashier has explicitly chosen to cut anyway (forceLoose) is fine.
  const q = item.quantity;
  const packs = q / upp;
  const enoughSealedStrips = item.availableStock == null || item.availableStock >= packs;
  if (q >= upp && q % upp === 0 && (item.looseUnits ?? 0) < q && enoughSealedStrips && !item.forceLoose) {
    return {
      code: "WHOLE_PACK_LOOSE",
      message: `That's ${packs} full ${pluraliseUnit(unit.packUnitLabel, packs)} of "${name}" `
        + `— sell it as ${P} so ${packs === 1 ? "it stays" : "they stay"} sealed.`,
      fixLabel: `Sell ${packs} ${titleCaseUnit(pluraliseUnit(unit.packUnitLabel, packs))}`,
      fix: { saleUnit: "PACK", quantity: packs },
      override: { label: "Cut it anyway", patch: { forceLoose: true } },
    };
  }
  return null;
}

/** Schedule H/H1/X medicines require a linked prescription (Indian Drug Rules) —
 *  mirrors BillingService.java's own guard, which throws a 422 for exactly this.
 *  Kept here, not just checked at save, so the pre-flight check in the save
 *  handler and the "Rx Required" banner can't drift apart on which schedules count. */
export const CONTROLLED_SCHEDULES = new Set(["H", "H1", "X"]);

/**
 * Returns the blocking issue when the cart holds a controlled medicine with no
 * prescription linked, or null when the bill is fine to save on that front. Pure —
 * safe to call from the save handler before the network round trip.
 */
export function rxRequiredIssue(
  items: CartItem[],
  meta: Pick<BillingMeta, "prescriptionId">,
): { schedules: string[] } | null {
  if (meta.prescriptionId) return null;
  const schedules = [...new Set(
    items.map((i) => (i.schedule ?? "").toUpperCase()).filter((s) => CONTROLLED_SCHEDULES.has(s)),
  )];
  return schedules.length > 0 ? { schedules } : null;
}

export type CartItem = {
  inventoryId:    string;
  /** Catalogue medicine id — lets the cart re-query the dispensing engine (loose overflow, batch swap). Absent for a pharmacy-local medicine. */
  medicineId?:    string;
  medicineName:   string;
  hsnCode:        string | null;
  schedule:       string | null;
  packSize?:      string;
  location?:      string;
  batchNumber:    string;
  expiryDate:     string;
  /** Always the printed PACK MRP. Per-piece price for a loose line is derived, never stored here. */
  mrp:            number;
  quantity:       number;
  /** Scheme quantity given free (10+1). Not charged; still leaves the shelf. */
  freeQty:        number;
  discount:       number;
  gstRate:        number;
  availableStock?: number;
  // ── Loose (cut-strip) selling ─────────────────────────────────────────────
  /** PACK (default) — quantity is strips/bottles. LOOSE — quantity is individual pieces. */
  saleUnit?:      SaleUnit;
  /** Effective pack size for this medicine (from the batch's medicine.unitsPerPack). */
  unitsPerPack?:  number;
  baseUnit?:      string;
  /** This pharmacy has enabled cut-strip selling for the medicine — shows the Strip/Tab toggle. */
  allowLooseSale?: boolean;
  /** Loose pieces already open on the batch — part of what a LOOSE line can draw on. */
  looseUnits?:    number;
  /** Cashier waived the "that's N full strips" guard for this line — see LineIssue.override. */
  forceLoose?:    boolean;
  /**
   * false only when the pharmacist hand-picked this batch in the picker, overriding
   * the dispensing engine's order. Recorded on the invoice line for the dispensing
   * audit trail; defaults true (engine order).
   */
  batchAutoSelected?: boolean;
  /**
   * The prescribed line this sale fulfils. Only ever set for a substitution: the
   * server attributes everything else by matching the medicine, which cannot work
   * when a different product was handed over.
   */
  prescriptionItemId?: string;
  /**
   * The clinic's dosing directions for this line ("5 ml three times a day for 7 days"),
   * carried from the prescription so they can print on the label / slip. Display only —
   * never affects pricing, quantity or stock.
   */
  dosageInstructions?: string;
  /**
   * A one-line note when a measured (mL/g) course was rounded up to whole sealed packs —
   * "105 ml prescribed · billing 2 bottles (95 ml over)". INTERNAL — shown in the cart's
   * "Internal Note" column, never printed on a patient receipt.
   */
  clinicalNote?: string;
  /**
   * The cashier-editable remarks for the patient, printed on the receipt / label. Seeded
   * from the clinic's dosing directions ({@link dosageInstructions}); the cashier can edit
   * it or add their own ("After food"). Display only — never affects pricing or stock.
   */
  patientRemarks?: string;
  /** For a measured (mL/g) line: the clinical volume the clinic prescribed, and its UOM. */
  prescribedVolumeClinical?: number;
  clinicalUom?: string;
  /** Whole sealed packs a measured course was rounded up to. */
  roundedPackCount?: number;
  // computed
  rate:           number;
  taxableAmount:  number;
  cgst:           number;
  sgst:           number;
  igst:           number;  // 0 for intra-state; full GST for interstate
  amount:         number;
};

export type BillingMeta = {
  customerId:              string;
  customerName:            string;
  customerPhone:           string;
  customerAddress:         string;
  abha:                    string;
  customerDefaultDiscount: number;
  doctorId:                string;
  doctorName:              string;
  prescriptionId:          string;  // DB id — required for Schedule H medicines
  prescriptionNumber:      string;  // human-readable "RX-00001" shown on receipts
  paymentMode:             "CASH" | "UPI" | "CARD" | "CREDIT";
  paymentStatus:           "PAID" | "PENDING" | "PARTIAL";
  isInterstate:            boolean;
  notes:                   string;  // internal notes
  deliveryNotes:           string;  // delivery instructions (shown on print)
  billDiscountPct:         number;  // bill-level discount % applied after item discounts
  extraCharges:            number;  // delivery / packaging / misc charge
  adjustmentAmount:        number;  // manual ± adjustment (rounding, goodwill, etc.)
};

/**
 * What a caller supplies when adding a line. Computed money fields are derived,
 * and freeQty is optional because most sales have no scheme — recompute() fills
 * in 0. The stored CartItem always carries a concrete freeQty.
 */
export type NewCartItem =
  Omit<CartItem, "rate" | "taxableAmount" | "cgst" | "sgst" | "igst" | "amount" | "freeQty">
  & { freeQty?: number };

type BillingStore = {
  items: CartItem[];
  meta: BillingMeta;
  addItem: (base: NewCartItem) => void;
  removeItem: (inventoryId: string) => void;
  replaceItem: (oldInventoryId: string, base: NewCartItem) => void;
  updateQty: (inventoryId: string, qty: number) => void;
  updateFreeQty: (inventoryId: string, freeQty: number) => void;
  updateDiscount: (inventoryId: string, discount: number) => void;
  /** Switch a line between whole-pack and loose (cut-strip) selling. Re-clamps the quantity to the new unit. */
  setSaleUnit: (inventoryId: string, saleUnit: SaleUnit) => void;
  /** Apply a verbatim patch to one line (used by the one-click "Fix" on a line issue). */
  patchLine: (inventoryId: string, patch: Partial<CartItem>) => void;
  /** Update the cashier-editable patient remarks on one line (display only, no recompute). */
  updatePatientRemarks: (inventoryId: string, patientRemarks: string) => void;
  /** Attributes a cart line to a prescribed line. Pass null to clear. */
  linkToPrescriptionItem: (inventoryId: string, prescriptionItemId: string | null) => void;
  setMeta: (patch: Partial<BillingMeta>) => void;
  clear: () => void;
  getTotals: () => ReturnType<typeof calcInvoiceTotals>;
  loadDraft: (items: CartItem[], meta: BillingMeta) => void;
};

/**
 * Exported so a caller building a cart from scratch — a prescription being billed or parked
 * as a draft — can start from a clean bill rather than from whatever is half-typed in the
 * store right now, which would otherwise carry another customer's discount and payment mode
 * into it.
 */
export const DEFAULT_META: BillingMeta = {
  customerId:              "",
  customerName:            "",
  customerPhone:           "",
  customerAddress:         "",
  abha:                    "",
  customerDefaultDiscount: 0,
  doctorId:                "",
  doctorName:              "",
  prescriptionId:          "",
  prescriptionNumber:      "",
  paymentMode:             "CASH",
  paymentStatus:           "PAID",
  isInterstate:            false,
  notes:                   "",
  deliveryNotes:           "",
  billDiscountPct:         0,
  extraCharges:            0,
  adjustmentAmount:        0,
};

/**
 * Quantity a cart line is allowed to carry.
 *
 * Capped at the batch's available stock so the cashier cannot enter a quantity the
 * sale will be rejected for. The backend still re-checks under Serializable
 * isolation and remains the authority — it has to, because another till can sell
 * the same batch between this keystroke and Save — but the common case (one person
 * typing 50 when 3 are on the shelf) is now stopped at entry instead of after a
 * round trip.
 *
 * Two deliberate non-caps:
 *  - `availableStock` undefined means the caller never resolved it (some entry
 *    paths don't), and inventing a limit of 0 there would block legitimate sales.
 *  - `availableStock <= 0` still yields 1, because a cart line cannot represent
 *    zero. The backend rejects it by name ("Insufficient stock for X"), which is a
 *    clearer explanation than a row that silently refuses to accept input.
 */
function clampQuantity(quantity: number, availableStock?: number): number {
  // Floor first. Nothing downstream rounds — calcGstFromMrp multiplies mrp by this
  // number directly — so a quantity of 1.5 would quietly bill half a strip. Free
  // quantity has always floored; paid quantity did not, which is the half that
  // reaches the customer's total.
  //
  // Number.isFinite covers NaN and Infinity: Number("") is 0 and Number("1e999") is
  // Infinity, and both can arrive from an input the user is midway through editing.
  const whole = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  const atLeastOne = Math.max(1, whole);
  if (availableStock == null) return atLeastOne;
  if (availableStock <= 0) return 1;
  return Math.min(atLeastOne, availableStock);
}

/**
 * Paid quantity and free quantity share one batch, so the CAP APPLIES TO THEIR SUM.
 *
 * A 100-unit batch cannot support 95 sold + 10 free; checking each against the
 * batch separately would pass and then be rejected at save. The paid quantity wins
 * the remaining stock — a cashier who over-reaches on the scheme should lose the
 * free units, not the sale.
 */
function clampLine(quantity: number, freeQty: number, availableStock?: number): { quantity: number; freeQty: number } {
  const paid = clampQuantity(quantity, availableStock);
  // `|| 0` catches NaN as well as undefined; Math.floor(NaN) would survive otherwise.
  const free = Math.max(0, Math.floor(Number.isFinite(freeQty) ? freeQty : 0) || 0);
  if (availableStock == null || availableStock <= 0) return { quantity: paid, freeQty: free };
  return { quantity: paid, freeQty: Math.min(free, Math.max(0, availableStock - paid)) };
}

/**
 * Individual pieces a LOOSE line may draw on: the unreserved packs, opened into
 * pieces, plus whatever is already loose on the batch. Undefined when stock was
 * never resolved (same non-cap rule as {@link clampQuantity}).
 */
function loosePiecesAvailable(item: Pick<CartItem, "availableStock" | "unitsPerPack" | "looseUnits">): number | undefined {
  if (item.availableStock == null || !item.unitsPerPack || item.unitsPerPack <= 1) return undefined;
  return item.availableStock * item.unitsPerPack + (item.looseUnits ?? 0);
}

function recompute(item: NewCartItem & Partial<CartItem>): CartItem {
  const isInterstate = false; // item-level calc is always intra-state; IGST toggled at invoice level
  const saleUnit: SaleUnit = item.saleUnit === "LOOSE" ? "LOOSE" : "PACK";
  const isLoose = saleUnit === "LOOSE";

  // Loose lines are counted, priced and capped in individual pieces; pack lines
  // are unchanged. effMrp is the per-piece price for a loose line (pack MRP /
  // unitsPerPack) and the pack MRP otherwise — the SAME split the Java billing
  // service does, so the cart preview matches the committed bill.
  const effMrp = isLoose ? perPieceMrp(item.mrp, item.unitsPerPack) : item.mrp;
  const cap    = isLoose ? loosePiecesAvailable(item) : item.availableStock;

  // Clamped here rather than at each call site: addItem, the addItem merge branch,
  // updateQty, setSaleUnit and replaceItem all funnel through this function, so a
  // future entry path cannot accidentally skip the cap.
  const { quantity, freeQty } = clampLine(item.quantity, item.freeQty ?? 0, cap);
  // Free units are NOT charged: every money figure below is derived from the paid
  // quantity alone. Only the stock cap above and the backend's decrement see the sum.
  const { taxableAmount, cgst, sgst, igst, totalAmount } = calcGstFromMrp(
    effMrp,
    quantity,
    item.discount,
    item.gstRate,
    isInterstate,
  );
  return {
    inventoryId:    item.inventoryId,
    medicineId:     item.medicineId,
    prescriptionItemId: item.prescriptionItemId,
    medicineName:   item.medicineName,
    hsnCode:        item.hsnCode,
    schedule:       item.schedule,
    packSize:       item.packSize,
    location:       item.location,
    batchNumber:    item.batchNumber,
    expiryDate:     item.expiryDate,
    mrp:            item.mrp,
    quantity,
    freeQty,
    discount:       item.discount,
    gstRate:        item.gstRate,
    availableStock: item.availableStock,
    saleUnit,
    unitsPerPack:   item.unitsPerPack,
    baseUnit:       item.baseUnit,
    allowLooseSale: item.allowLooseSale,
    looseUnits:     item.looseUnits,
    // Cleared whenever the line leaves loose selling — the waiver is specific to
    // cutting a sealed strip for this exact quantity.
    forceLoose:     saleUnit === "LOOSE" ? item.forceLoose : undefined,
    batchAutoSelected: item.batchAutoSelected,
    // Display-only fields carried straight through every edit path — a qty or discount
    // change must not drop the clinic directions / patient remarks off the line.
    dosageInstructions:       item.dosageInstructions,
    clinicalNote:             item.clinicalNote,
    patientRemarks:           item.patientRemarks,
    prescribedVolumeClinical: item.prescribedVolumeClinical,
    clinicalUom:              item.clinicalUom,
    roundedPackCount:         item.roundedPackCount,
    rate:           Math.round(effMrp * (1 - item.discount / 100) * 100) / 100,
    taxableAmount,
    cgst,
    sgst,
    igst,
    amount:         totalAmount,
  };
}

export const useBillingStore = create<BillingStore>((set, get) => ({
  items: [],
  meta: DEFAULT_META,

  addItem(base) {
    set((s) => {
      const existing = s.items.find((i) => i.inventoryId === base.inventoryId);
      if (existing) {
        return {
          items: s.items.map((i) =>
            i.inventoryId === base.inventoryId
              // Free units accumulate alongside paid ones: scanning a 10+1 pack twice
              // is 20 sold and 2 free, not 20 sold and 1 free.
              ? recompute({
                  ...i,
                  quantity: i.quantity + base.quantity,
                  freeQty:  (i.freeQty ?? 0) + (base.freeQty ?? 0),
                })
              : i
          ),
        };
      }
      return { items: [...s.items, recompute(base)] };
    });
  },

  removeItem(inventoryId) {
    set((s) => ({ items: s.items.filter((i) => i.inventoryId !== inventoryId) }));
  },

  replaceItem(oldInventoryId, base) {
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === oldInventoryId ? recompute(base) : i
      ),
    }));
  },

  updateQty(inventoryId, qty) {
    // No clamping here — recompute() owns it, so the floor of 1 and the
    // available-stock ceiling are applied identically on every path.
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === inventoryId ? recompute({ ...i, quantity: qty }) : i
      ),
    }));
  },

  updateFreeQty(inventoryId, freeQty) {
    // Clamping lives in recompute() so the paid+free total is checked against one
    // batch, same as every other edit path.
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === inventoryId ? recompute({ ...i, freeQty }) : i
      ),
    }));
  },

  updateDiscount(inventoryId, discount) {
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === inventoryId
          ? recompute({ ...i, discount: Math.min(100, Math.max(0, discount)) })
          : i
      ),
    }));
  },

  setSaleUnit(inventoryId, saleUnit) {
    set((s) => ({
      items: s.items.map((i) => {
        if (i.inventoryId !== inventoryId) return i;
        if (saleUnit === "LOOSE" && !(i.allowLooseSale && (i.unitsPerPack ?? 0) > 1)) return i;
        // Switching to loose: seed the quantity from the strips already on the line
        // so "2 strips" becomes "20 tablets", not "2 tablets". Switching back divides.
        const upp = i.unitsPerPack ?? 1;
        const nextQty = i.saleUnit === saleUnit
          ? i.quantity
          : saleUnit === "LOOSE"
            ? i.quantity * upp
            : Math.max(1, Math.round(i.quantity / upp));
        // recompute() re-clamps against the new unit's ceiling and re-prices per piece.
        return recompute({ ...i, saleUnit, quantity: nextQty, freeQty: 0 });
      }),
    }));
  },

  patchLine(inventoryId, patch) {
    set((s) => ({
      items: s.items.map((i) => (i.inventoryId === inventoryId ? recompute({ ...i, ...patch }) : i)),
    }));
  },

  updatePatientRemarks(inventoryId, patientRemarks) {
    set((s) => ({
      items: s.items.map((i) =>
        i.inventoryId === inventoryId ? { ...i, patientRemarks } : i
      ),
    }));
  },

  linkToPrescriptionItem(inventoryId, prescriptionItemId) {
    set((s) => ({
      items: s.items.map((i) => {
        // Two cart lines claiming the same prescribed line would credit it twice and could
        // close a prescription on half the medicine, so the link MOVES rather than copies.
        if (prescriptionItemId && i.prescriptionItemId === prescriptionItemId
            && i.inventoryId !== inventoryId) {
          return recompute({ ...i, prescriptionItemId: undefined });
        }
        return i.inventoryId === inventoryId
          ? recompute({ ...i, prescriptionItemId: prescriptionItemId ?? undefined })
          : i;
      }),
    }));
  },

  setMeta(patch) {
    // Attributions name lines on the prescription that WAS linked. Sending them against a
    // different one is either rejected or, worse, matched to a same-id line on the new Rx.
    if (patch.prescriptionId !== undefined && patch.prescriptionId !== get().meta.prescriptionId) {
      set((s) => ({ items: s.items.map((i) => recompute({ ...i, prescriptionItemId: undefined })) }));
    }
    set((s) => ({ meta: { ...s.meta, ...patch } }));
  },

  clear() {
    set({ items: [], meta: DEFAULT_META });
  },

  loadDraft(draftItems, draftMeta) {
    // Spread DEFAULT_META first so drafts saved before new fields were added
    // still get valid defaults for customerId / customerDefaultDiscount.
    set({ items: draftItems, meta: { ...DEFAULT_META, ...draftMeta } });
  },

  getTotals() {
    const { items, meta } = get();
    // The bill discount goes IN here, not on afterwards: it reduces the taxable value
    // (s.15(3) CGST Act), so the tax shown in the cart is the tax that will be charged.
    // The server computes the same way — see GstCalculator.calcInvoiceTotals.
    return calcInvoiceTotals(
      items.map((i) => ({
        // A loose line contributes its per-piece price × pieces — the same figure
        // the server stores per line, so the header equals the sum of the lines.
        mrp:      i.saleUnit === "LOOSE" ? perPieceMrp(i.mrp, i.unitsPerPack) : i.mrp,
        quantity: i.quantity,
        discount: i.discount,
        gstRate:  i.gstRate,
      })),
      meta.isInterstate,
      meta.billDiscountPct,
    );
  },
}));
