package com.checkup.pharmacy.modules.medicine;

import java.util.List;

/**
 * Raised after a GRN confirm has committed, carrying every pharmacy-local medicine
 * the GRN touched so the background matcher never has to go back to the database
 * for that list — same reasoning as {@code PrescriptionDispensedEvent}: this
 * background thread has no request/tenant context.
 *
 * <p>{@code localMedicineIds} may be empty (a GRN entirely matched to the global
 * catalogue) — the listener treats that as a cheap no-op, not an error.
 */
public record GrnConfirmedEvent(String pharmacyId, String grnId, List<String> localMedicineIds) {
}
