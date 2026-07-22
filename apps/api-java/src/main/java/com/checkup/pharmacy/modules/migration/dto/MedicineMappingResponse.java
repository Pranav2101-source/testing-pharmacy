package com.checkup.pharmacy.modules.migration.dto;

import com.checkup.pharmacy.modules.migration.MedicineMapping;

public record MedicineMappingResponse(String id, String pharmacyId, String csvValue, String medicineId,
                                      boolean isNew, Float confidence) {

    public static MedicineMappingResponse from(MedicineMapping m) {
        return new MedicineMappingResponse(m.getId(), m.getPharmacyId(), m.getCsvValue(), m.getMedicineId(),
                m.isNewMedicine(), m.getConfidence());
    }
}
