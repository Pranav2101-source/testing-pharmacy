package com.checkup.pharmacy.modules.suppliercreditnote.dto;

import java.math.BigDecimal;
import java.util.List;

public record CreditNotePageResponse(List<CreditNoteResponse> items, long total, int page, int limit,
                                     BigDecimal totalPendingCredit) {
}
