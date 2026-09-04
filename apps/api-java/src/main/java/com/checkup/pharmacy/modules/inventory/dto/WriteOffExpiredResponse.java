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
 * @param unitsWrittenOff   whole packs destroyed. A batch that was already down to a cut-strip
 *                          remainder (quantity 0) contributes 0 here — see
 *                          {@code looseUnitsWrittenOff} for that quantity, kept separate rather
 *                          than summed in since the two are different units (packs vs. pieces).
 * @param looseUnitsWrittenOff loose pieces (from opened strips) destroyed, across all batches.
 * @param unpriceableLooseBatches how many batches had a loose remainder whose per-piece cost
 *                          could not be computed (no pack size on record at write-off time,
 *                          override or catalogue since cleared) — those batches were still
 *                          written off, but their loose pieces are absent from
 *                          {@code costWrittenOff}/{@code itcToReverse}, understating both.
 *                          Zero in the ordinary case.
 * @param costWrittenOff    what they cost, at each batch's recorded purchase rate — the amount
 *                          the stock valuation drops by
 * @param itcToReverse      the input tax credit now blocked, estimated at each medicine's current
 *                          GST rate. Assumes the credit was claimed intra-state, which is the
 *                          ordinary case; an inter-state purchase must be moved to IGST by hand
 */
public record WriteOffExpiredResponse(long batchesWrittenOff, long unitsWrittenOff, long looseUnitsWrittenOff,
                                      long unpriceableLooseBatches, BigDecimal costWrittenOff, BigDecimal itcToReverse) {
}
