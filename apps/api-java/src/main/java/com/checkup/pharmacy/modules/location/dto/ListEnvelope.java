package com.checkup.pharmacy.modules.location.dto;

import java.util.List;

/** { items, total, page, totalPages } — the standard nested list shape used across modules. */
public record ListEnvelope<T>(List<T> items, long total, int page, int totalPages) {
}
