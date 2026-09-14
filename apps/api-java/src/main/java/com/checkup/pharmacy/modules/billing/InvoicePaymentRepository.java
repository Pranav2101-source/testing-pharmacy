package com.checkup.pharmacy.modules.billing;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public interface InvoicePaymentRepository extends JpaRepository<InvoicePayment, String> {

    List<InvoicePayment> findByInvoiceIdOrderByPaidAtAsc(String invoiceId);

    /**
     * Money collected in the window, per mode, against invoices raised at ANY time —
     * the tenders taken at checkout, plus customers settling a credit account later.
     *
     * <p>This money physically changed hands today. Counting only invoices meant a
     * settlement was invisible to the day's closure (the parent invoice was reported
     * under `creditSales`, on whatever date it was raised), so every settlement showed
     * up as unexplained surplus cash on the one figure an owner uses to judge whether
     * money has gone missing.
     *
     * <p>Keyed on {@code paidAt}, not {@code createdAt}: the question is when the money
     * changed hands, not when the row was written.
     *
     * <p>Cancelled invoices are excluded. Before split tender this could not matter — a
     * bill with money against it could not be cancelled at all — but a cancelled bill
     * now carries the tender rows it was created with, and counting them would leave
     * the drawer expecting cash that was handed back.
     */
    // Enum compared as text, matching InvoiceRepository and InventoryRepository.search:
    // a typed enum literal makes Hibernate emit an unquoted ::PaymentMode cast, and
    // Postgres lower-cases that to a type name the Prisma-owned schema does not define.
    @Query("""
            SELECT CAST(p.paymentMode AS string) AS mode, COALESCE(SUM(p.amount), 0) AS total,
                   COUNT(DISTINCT p.invoiceId) AS bills
            FROM InvoicePayment p
            WHERE p.pharmacyId = :pharmacyId
              AND p.paidAt >= :from AND p.paidAt <= :to
              AND EXISTS (SELECT 1 FROM Invoice i WHERE i.id = p.invoiceId AND i.isCancelled = false)
            GROUP BY p.paymentMode
            """)
    List<ModeMixRow> sumByModeInRange(@Param("pharmacyId") String pharmacyId,
                                      @Param("from") Instant from, @Param("to") Instant to);

    interface ModeMixRow {
        String getMode();
        BigDecimal getTotal();
        long getBills();
    }
}
