package com.checkup.pharmacy.modules.prescription.dto;

import java.util.List;

public record PrescriptionPageResponse(List<PrescriptionResponse> items, long total, int page, int limit) {
}
