package com.checkup.pharmacy.modules.dispensing.dto;

/**
 * The pharmacy's current batch-selection strategy, plus the product default so a
 * settings screen can show "(default)" against the right option.
 */
public record DispensingStrategyResponse(String strategy, String defaultStrategy) {
}
