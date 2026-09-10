package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;

/** Matches the frontend's Medicine shape exactly. */
public record MedicineResponse(
        String id,
        String name,
        String genericName,
        String manufacturer,
        String composition,
        String category,
        String schedule,
        String hsnCode,
        BigDecimal gstRate,
        String form,
        String strength,
        String unit,
        String packSize,
        boolean isActive,
        // ── Loose dispensing ────────────────────────────────────────────────
        // unitsPerPack / baseUnit are catalogue-global. allowLooseSale is
        // per-pharmacy and only populated on the POS-facing paths (quick search,
        // barcode lookup); it is false on the global catalogue views.
        Integer unitsPerPack,
        String baseUnit,
        boolean allowLooseSale,
        // New POS lines for this medicine start as loose (per-pharmacy; POS paths only).
        boolean looseByDefault,
        // True when `id` is a PharmacyMedicine id, not a global catalogue id — only ever
        // set on the billing combobox's opt-in search (see MedicineService#quickSearch).
        // Every other caller of this response (Add Stock, barcode mapping, alternatives)
        // never opts in, so isLocal is always false for them.
        boolean isLocal,
        // ── Stock (billing search only) ────────────────────────────────────
        // Populated only by quickSearch, from one batched join over the whole result
        // page (see InventoryRepository#findStockForEffectiveMedicineIds /
        // #findStockForLocalMedicineIds) — false/zero/null on every other response.
        // availableQuantity is whole packs (unreserved); price is the earliest-expiring
        // in-stock batch's MRP, i.e. what FEFO will actually charge next.
        boolean inStock,
        int availableQuantity,
        int looseUnitsOnHand,
        // Total sellable base units (availableQuantity * unitsPerPack + looseUnitsOnHand)
        // — only set when this medicine is actually loose-sellable; null otherwise so the
        // frontend shows a plain pack count instead of a meaningless unit total.
        Integer sellableUnits,
        BigDecimal price,
        // ── Pack-size trust ────────────────────────────────────────────────
        // "VERIFIED" | "UNVERIFIED" | "DISPUTED", or null when this medicine has no pack
        // size on record at all — which is a different situation from an unaudited one and
        // must stay distinguishable on the wire. Catalogue-global, like unitsPerPack
        // itself: it describes the shared row, not this pharmacy's override of it.
        //
        // Sent as a string rather than kept as an enum so the frontend contract is one
        // widened union and adding a fourth state later does not break a typed client.
        String packSizeConfidence,
        java.time.Instant packSizeVerifiedAt,
        // "CATALOGUE_ADMIN" | "PHARMACIST" | "PACK_SIZE_TEXT" | "BULK_IMPORT" | "EMR_INGEST"
        // | "DATA_SCRIPT" | "RAW_WRITE" | "BACKFILL". See PackSizeSource.
        String packSizeSource
) {
}
