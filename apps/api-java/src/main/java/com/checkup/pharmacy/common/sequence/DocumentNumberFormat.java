package com.checkup.pharmacy.common.sequence;

import java.time.Year;

/** Formats a {@link DocumentSequenceService} counter value into the human-facing document number. */
public final class DocumentNumberFormat {

    private DocumentNumberFormat() {
    }

    public static String purchaseOrder(int seq) {
        return "PO/" + DocumentSequenceService.fyShort() + "/" + pad(seq, 5);
    }

    public static String grn(int seq) {
        return "GRN/" + DocumentSequenceService.fyShort() + "/" + pad(seq, 5);
    }

    public static String supplierReturn(int seq) {
        return "SR/" + DocumentSequenceService.fyShort() + "/" + pad(seq, 5);
    }

    public static String stockAudit(int seq) {
        return "AUDIT-" + DocumentSequenceService.istDayPeriod() + "-" + pad(seq, 3);
    }

    public static String supplierPayment(int seq) {
        return "SP-" + Year.now().getValue() + "-" + pad(seq, 5);
    }

    public static String supplierCreditNote(int seq) {
        return "SCN-" + Year.now().getValue() + "-" + pad(seq, 5);
    }

    public static String invoice(int seq) {
        return "INV/" + DocumentSequenceService.fyShort() + "/" + pad(seq, 6);
    }

    public static String salesReturn(int seq) {
        return "INV-RET/" + DocumentSequenceService.fyShort() + "/" + pad(seq, 6);
    }

    public static String quotation(int seq) {
        return "QT/" + DocumentSequenceService.fyShort() + "/" + pad(seq, 5);
    }

    /** No financial-year segment, matching the pre-existing RX-NNNNN format — the counter never resets. */
    public static String prescription(int seq) {
        return "RX-" + pad(seq, 5);
    }

    private static String pad(int value, int width) {
        return String.format("%0" + width + "d", value);
    }
}
