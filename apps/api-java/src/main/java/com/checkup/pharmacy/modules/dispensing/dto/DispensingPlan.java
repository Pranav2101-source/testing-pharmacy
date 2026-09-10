package com.checkup.pharmacy.modules.dispensing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * The authoritative dispensing plan for one or more requested lines — which
 * batches to draw from, in what order, as packs or loose pieces, with a money
 * preview. Produced by {@code DispensingService}; every dispensing surface
 * (billing search, batch picker, Quick Add, Repeat Last Bill, EMR prescription
 * fulfilment) turns this into its cart rather than choosing batches itself.
 *
 * <p>The money figures are a preview computed at zero line discount, intra-state
 * (CGST/SGST) — the same basis {@code prescriptionToCart} used to compute
 * client-side. IGST is applied at invoice level from the bill's own interstate
 * flag, exactly as billing already does.
 */
public record DispensingPlan(
        /** The strategy these allocations were ordered by: {@code LILA_FEFO} or {@code LIFA}. */
        String strategy,
        List<Line> lines
) {
    public record Line(
            String medicineId,
            String localMedicineId,
            String medicineName,
            String schedule,
            int requestedPieces,
            /** Pieces the plan actually covers across all allocations. */
            int dispensedPieces,
            /** True when {@code dispensedPieces >= requestedPieces}. */
            boolean fullyAllocated,
            /** {@code requestedPieces - dispensedPieces} when the shelf can't cover it; null otherwise. */
            Integer shortfallPieces,
            /** Pieces billed OVER what was asked because a pack could not be cut (loose off / Schedule X); null otherwise. */
            Integer roundedUpToPieces,
            /**
             * Why this line could not be (fully) filled, when it could not:
             * {@code NO_STOCK} — no sellable batch at all;
             * {@code NO_SELLABLE_UNIT} — stock exists but less than one full pack and loose selling is off / Schedule X;
             * {@code MEDICINE_UNAVAILABLE} — the linked catalogue medicine no longer exists;
             * {@code PARTIAL} — allocated less than requested (see {@code shortfallPieces});
             * {@code ROUNDED_UP} — allocated more than requested to avoid cutting a sealed pack (see {@code roundedUpToPieces}).
             * Null when the line was filled exactly.
             */
            String unmetReason,
            /** A short pharmacist-readable sentence describing {@code unmetReason} — safe to show as-is. Null when the line was filled exactly. */
            String message,
            List<Allocation> allocations
    ) {
    }

    public record Allocation(
            String inventoryId,
            String batchNumber,
            Instant expiryDate,
            /** {@code PACK} — {@code quantity} is whole packs. {@code LOOSE} — {@code quantity} is pieces. */
            String saleUnit,
            int quantity,
            Integer unitsPerPack,
            String baseUnit,
            /**
             * {@code Medicine.unit} — the packaging word the catalogue records for one whole
             * sealed sale unit ("Strip", "Bottle", "Tube", "Vial"), or null when it has none.
             * Display-only, and the ONLY way the cart can know a lotion comes in a bottle: with
             * just {@code baseUnit} to go on, an unclassified medicine resolves to EACH and
             * every label falls back to tablet-era "strip" — a Melgain bottle read "10/strip"
             * in billing while the inventory screen, which reads this same field, correctly
             * said "40 bottles". Resolved for display through {@code PackUnits.packUnitLabel}
             * (Java) / {@code saleUnitModel} (web), which agree on the mapping.
             */
            String unit,
            /**
             * The medicine's free-text catalogue pack size ("100ml", "1x15", "strip of 10"),
             * or null when the catalogue has none. Display-only — carried so the billing cart's
             * Pack column can show the real label instead of a computed fallback. Never used in
             * any allocation, pricing or stock decision.
             */
            String packSize,
            /** Printed pack MRP, always. */
            BigDecimal mrp,
            /** Per-piece for a LOOSE line (pack MRP / unitsPerPack, rounded down); equals {@code mrp} for PACK. */
            BigDecimal unitMrp,
            /** Charged unit price — equals {@code unitMrp} here (plan applies no discount). */
            BigDecimal rate,
            BigDecimal gstRate,
            String hsnCode,
            /** This pharmacy sells this medicine loose — the cart shows the Strip/Tab toggle even on a PACK line. */
            boolean allowLooseSale,
            /** Loose pieces already open on this batch. */
            int looseUnits,
            /** Unreserved sealed packs on this batch. */
            int availableStock,
            // GST preview for `quantity` at zero discount, intra-state.
            BigDecimal taxableAmount,
            BigDecimal cgst,
            BigDecimal sgst,
            BigDecimal igst,
            BigDecimal amount
    ) {
    }
}
