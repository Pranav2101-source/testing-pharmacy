package com.checkup.pharmacy.modules.inventory.dto;

import java.math.BigDecimal;

/**
 * What a write-off actually cost, reported back so the number is seen at the moment it happens.
 *
 * <p>{@code itcToReverse} is here rather than left to the GST screen on purpose: writing off
 * expired stock creates a tax obligation the same instant it creates a stock loss. Section
 * 17(5)(h) blocks input credit on goods that are destroyed, so the credit claimed when these
 * batches were bought has to be reversed in Table 4(B)(1) for this period. Showing it only on a
 * report somebody opens at filing time makes it easy to miss entirely.
 *
 * @param batchesWrittenOff how many batches were taken off the books
 * @param unitsWrittenOff   total units destroyed
 * @param costWrittenOff    what they cost, at each batch's recorded purchase rate — the amount
 *                          the stock valuation drops by
 * @param itcToReverse      the input tax credit now blocked, estimated at each medicine's current
 *                          GST rate. Assumes the credit was claimed intra-state, which is the
 *                          ordinary case; an inter-state purchase must be moved to IGST by hand
 */
public record WriteOffExpiredResponse(long batchesWrittenOff, long unitsWrittenOff,
                                      BigDecimal costWrittenOff, BigDecimal itcToReverse) {
}
