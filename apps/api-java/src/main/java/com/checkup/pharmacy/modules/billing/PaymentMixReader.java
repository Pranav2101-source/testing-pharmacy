package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.modules.customerledger.CustomerLedgerEntryRepository;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;

/**
 * How much money arrived in a window and by what means — the one place that knows a bill
 * can be settled several ways at once.
 *
 * <p>It exists because three separate screens were each deriving this from
 * {@code Invoice.paymentMode} alone, which is a single enum and therefore cannot describe
 * a bill paid Rs.600 by UPI and Rs.400 in cash. Left alone, all three would have booked
 * the whole bill under one mode: the day's closure would expect cash that was never taken,
 * and the dashboard and the reports chart would each be wrong in the same way while
 * appearing to corroborate one another.
 *
 * <p>Two eras of bill are read here, and a bill belongs to exactly one of them — whether
 * it carries tender rows of its own decides which. That is what allows split tender to
 * ship without inventing a payment row for every invoice ever issued; see
 * {@link InvoiceRepository#sumUntenderedReceivedByModeInRange}.
 *
 * <p>CREDIT is the odd one and is filled from a different question. No money arrives on a
 * credit sale, so its figure is what the window's bills put on customers' accounts. Every
 * other mode reports money received.
 */
@Component
public class PaymentMixReader {

    private final InvoiceRepository invoiceRepository;
    private final InvoicePaymentRepository paymentRepository;
    private final CustomerLedgerEntryRepository ledgerRepository;

    public PaymentMixReader(InvoiceRepository invoiceRepository, InvoicePaymentRepository paymentRepository,
                            CustomerLedgerEntryRepository ledgerRepository) {
        this.invoiceRepository = invoiceRepository;
        this.paymentRepository = paymentRepository;
        this.ledgerRepository = ledgerRepository;
    }

    /**
     * What one mode contributed to a window.
     *
     * @param amount money received through it, or for CREDIT, debt created
     * @param bills  how many bills involved it. A split bill counts once under EACH mode it
     *               used, so these deliberately do not sum to the number of bills raised —
     *               the alternative is attributing a two-tender bill to one of its tenders,
     *               which is the misattribution this class exists to end.
     */
    public record ModeTotal(BigDecimal amount, long bills) {
        static final ModeTotal NONE = new ModeTotal(BigDecimal.ZERO, 0);

        ModeTotal plus(BigDecimal moreAmount, long moreBills) {
            return new ModeTotal(amount.add(moreAmount), bills + moreBills);
        }
    }

    /**
     * The window's payment mix, per mode, inclusive of both bounds.
     *
     * <p>Includes money taken today against a bill raised earlier — a customer paying down
     * their khata is cash in today's drawer, whatever date the bill carries.
     */
    public Map<PaymentMode, ModeTotal> mix(String pharmacyId, Instant from, Instant to) {
        Map<PaymentMode, ModeTotal> mix = new EnumMap<>(PaymentMode.class);
        for (InvoicePaymentRepository.ModeMixRow row : paymentRepository.sumByModeInRange(pharmacyId, from, to)) {
            add(mix, row.getMode(), row.getTotal(), row.getBills());
        }
        for (InvoiceRepository.ModeMixRow row : invoiceRepository.sumUntenderedReceivedByModeInRange(pharmacyId, from, to)) {
            add(mix, row.getMode(), row.getTotal(), row.getBills());
        }
        InvoiceRepository.ModeMixRow credit = invoiceRepository.sumCreditPutOnAccountInRange(pharmacyId, from, to);
        if (credit != null) {
            add(mix, PaymentMode.CREDIT.name(), credit.getTotal(), credit.getBills());
        }
        return mix;
    }

    /**
     * Deposits taken in the window, less advances handed back, per mode.
     *
     * <p>Deliberately NOT part of {@link #mix}. That answers "how was today's selling
     * paid for", and a deposit is not a sale — folding it in would inflate the reports
     * chart's total and every share it derives, then count the same rupees a second
     * time when the deposit is eventually spent on a bill.
     *
     * <p>The day's cash closure asks a different question — what should be in the
     * drawer — and for that a deposit absolutely counts, on the day it was taken. It
     * is the only caller.
     */
    public Map<PaymentMode, ModeTotal> advanceMovements(String pharmacyId, Instant from, Instant to) {
        Map<PaymentMode, ModeTotal> movements = new EnumMap<>(PaymentMode.class);
        for (CustomerLedgerEntryRepository.AdvanceMovementRow row
                : ledgerRepository.sumAdvanceMovementsByModeInRange(pharmacyId, from, to)) {
            add(movements, row.getMode(), row.getTotal(), row.getBills());
        }
        return movements;
    }

    /** The amount for one mode, zero when the window saw none of it. */
    public BigDecimal amountOf(Map<PaymentMode, ModeTotal> mix, PaymentMode mode) {
        return mix.getOrDefault(mode, ModeTotal.NONE).amount();
    }

    private static void add(Map<PaymentMode, ModeTotal> mix, String mode, BigDecimal amount, long bills) {
        if (mode == null) return;
        BigDecimal safeAmount = amount == null ? BigDecimal.ZERO : amount;
        if (safeAmount.signum() == 0 && bills == 0) return;
        mix.merge(PaymentMode.valueOf(mode), new ModeTotal(safeAmount, bills),
                (existing, added) -> existing.plus(added.amount(), added.bills()));
    }
}
