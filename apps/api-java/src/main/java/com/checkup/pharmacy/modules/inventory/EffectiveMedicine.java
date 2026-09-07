package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicine;

import java.util.Map;

/**
 * Resolves the catalogue {@link Medicine} a batch should actually be enriched/billed
 * against — its own direct link, or, for a batch received against a {@link
 * PharmacyMedicine} local identity that has since been confirmed {@code LINKED} to the
 * catalogue, the linked medicine. Shared by {@code InventoryService} (read-side
 * enrichment: unitsPerPack, allowLooseSale, GST, ...) and {@code BillingService}
 * (sale-time pricing/validation) so the two never disagree about what a local-medicine
 * batch is allowed to do once it is linked — a batch the POS shows as loose-sellable
 * must also be allowed to actually sell loose.
 *
 * <p>{@code PENDING}, {@code SUGGESTED} and {@code KEPT_LOCAL} all resolve to {@code
 * null} here, same as an entirely local medicine — only a confirmed {@code LINKED}
 * identity borrows catalogue behaviour. This deliberately does NOT repoint {@code
 * Inventory.medicineId} or write anything back to the catalogue — see {@code
 * PharmacyMedicine#confirmLink}'s own doc: linking is additive, and an already-received
 * batch keeps its {@code localMedicineId} forever. This class only changes what a
 * caller treats the batch AS at read/bill time, batch by batch, on every call.
 *
 * <p>Never queries the database itself — callers batch-fetch {@code medicinesById},
 * folding in every {@code LINKED} local medicine's {@link
 * PharmacyMedicine#getLinkedMedicineId()} alongside their own direct medicineIds
 * BEFORE that fetch, so resolving the whole page stays one query, not one per row.
 */
public final class EffectiveMedicine {

    private EffectiveMedicine() {
    }

    /**
     * The medicine a batch should be treated as. {@code direct} is the caller's own
     * {@code medicinesById.get(inv.getMedicineId())} lookup — passed in rather than
     * re-derived here so this stays a pure function of already-fetched data.
     *
     * <p>Returns {@code null} when there is no catalogue medicine to defer to: a
     * genuinely local batch (no local medicine, or one that is PENDING/SUGGESTED/
     * KEPT_LOCAL), or a LINKED one whose target has since vanished from the catalogue
     * (missing from {@code medicinesById} — deleted, or simply not included by a caller
     * that forgot to fold linked ids into its fetch). Either way the caller falls back
     * to its existing local-medicine-only behaviour exactly as before this existed.
     */
    public static Medicine resolve(Medicine direct, String localMedicineId,
                                    Map<String, PharmacyMedicine> localMedicinesById,
                                    Map<String, Medicine> medicinesById) {
        if (direct != null) {
            return direct;
        }
        if (localMedicineId == null) {
            return null;
        }
        PharmacyMedicine local = localMedicinesById.get(localMedicineId);
        if (local == null || local.getMatchStatus() != MedicineMatchStatus.LINKED
                || local.getLinkedMedicineId() == null) {
            return null;
        }
        return medicinesById.get(local.getLinkedMedicineId());
    }
}
