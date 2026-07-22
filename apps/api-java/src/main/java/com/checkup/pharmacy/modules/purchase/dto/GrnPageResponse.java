package com.checkup.pharmacy.modules.purchase.dto;

import java.util.List;

public record GrnPageResponse(List<GrnResponse> items, long total, int page, int limit) {
}
