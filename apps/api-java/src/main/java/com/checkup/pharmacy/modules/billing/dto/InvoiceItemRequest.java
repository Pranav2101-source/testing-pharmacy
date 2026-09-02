package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;

public record InvoiceItemRequest(
        @NotBlank String inventoryId,
        @NotNull @Positive Integer quantity,
        /**
         * Scheme quantity handed over free with this line (10+1, buy-100-get-10).
         *
         * <p>Not charged, but DOES come off the shelf — the batch is decremented by
         * {@code quantity + freeQty} and the stock check is made against the total.
         * Optional; absent means none.
         */
        @PositiveOrZero Integer freeQty,
        @Min(0) @Max(100) BigDecimal discount,
        /**
         * The prescribed line this sale fulfils, when the cashier said which one.
         *
         * <p>Optional, and null on every counter sale. It exists for one case that cannot be
         * inferred: a SUBSTITUTION. Dispensing is otherwise attributed by matching the sold
         * medicine to a prescribed one, which by definition cannot find the line when a
         * different product was handed over — so without this the prescribed line would stay
         * unfulfilled and the clinic would be told the patient collected nothing.
         */
        String prescriptionItemId,
        /**
         * {@code LOOSE} — this line sells {@code quantity} individual pieces cut from a
         * strip. {@code PACK}, {@code null} or absent — a normal whole-pack sale (every
         * existing caller and every bill sent by a client that predates loose selling).
         *
         * <p>A LOOSE line is only accepted when the catalogue medicine carries
         * {@code unitsPerPack > 1} AND this pharmacy has switched loose selling on for it
         * (see {@code PharmacyMedicineOverride.allowLooseSale}) — BillingService enforces
         * both. {@code freeQty} on a loose line is also in pieces.
         */
        @Pattern(regexp = "(?i)PACK|LOOSE", message = "saleUnit must be PACK or LOOSE") String saleUnit,
        /**
         * Set by the POS only when the cashier has explicitly chosen to cut a SEALED
         * strip to fill a line that is a whole number of packs (a torn foil on the
         * last strip, a customer who wants the tablets counted out). It waives the
         * "that is N full packs — bill it as a pack sale" guard for THIS line and
         * nothing else. Ignored on a PACK line. Null/absent on every ordinary sale.
         */
        Boolean forceLoose
) {
    /**
     * Back-compatible constructor for callers that predate loose selling — every
     * existing test and any positional Java call site. Jackson still binds JSON
     * through the canonical constructor, so a request body without the later fields
     * arrives with them null here (treated as PACK, not forced).
     */
    public InvoiceItemRequest(String inventoryId, Integer quantity, Integer freeQty, BigDecimal discount,
                              String prescriptionItemId) {
        this(inventoryId, quantity, freeQty, discount, prescriptionItemId, null, null);
    }

    /** Back-compatible constructor for callers that predate the {@code forceLoose} waiver. */
    public InvoiceItemRequest(String inventoryId, Integer quantity, Integer freeQty, BigDecimal discount,
                              String prescriptionItemId, String saleUnit) {
        this(inventoryId, quantity, freeQty, discount, prescriptionItemId, saleUnit, null);
    }

    /** True when the cashier has explicitly waived the whole-pack-as-loose guard for this line. */
    public boolean isForceLoose() {
        return Boolean.TRUE.equals(forceLoose);
    }

    public BigDecimal discountOrZero() {
        return discount == null ? BigDecimal.ZERO : discount;
    }

    public int freeQtyOrZero() {
        return freeQty == null ? 0 : freeQty;
    }

    /** True when this line sells individual pieces rather than whole packs. */
    public boolean isLoose() {
        return "LOOSE".equalsIgnoreCase(saleUnit);
    }

    /** What actually leaves the shelf for this line — pieces for a loose line, packs otherwise. */
    public int totalDispensedQty() {
        return quantity + freeQtyOrZero();
    }
}
