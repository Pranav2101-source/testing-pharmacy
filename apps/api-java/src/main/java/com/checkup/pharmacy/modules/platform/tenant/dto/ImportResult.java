package com.checkup.pharmacy.modules.platform.tenant.dto;

import java.util.List;

/** Outcome of a bulk tenant import — per-row tallies plus a reason for each skip/failure. */
public record ImportResult(int imported, int skipped, int failed, List<ImportError> errors) {

    public record ImportError(int row, String email, String reason) {
    }
}
