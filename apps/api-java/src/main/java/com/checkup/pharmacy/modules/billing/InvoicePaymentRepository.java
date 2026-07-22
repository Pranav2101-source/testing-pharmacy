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
     * Cash collected in the window against invoices raised at ANY time — principally
     * customers settling a credit account.
     *
     * <p>This money is physically in the drawer today. Counting only invoices meant it
     * was invisible to the day's closure (the parent invoice was reported under
     * `creditSales`, on whatever date it was raised), so every settlement showed up as
     * unexplained surplus cash on the one figure an owner uses to judge whether money
     * has gone missing.
     *
     * <p>Keyed on {@code paidAt}, not {@code createdAt}: the question is when the cash
     * changed hands, not when the row was written.
     */
    // Enum compared as text, matching sumByPaymentModeInRange and InventoryRepository.search:
    // a typed enum literal makes Hibernate emit an unquoted ::PaymentMode cast, and
    // Postgres lower-cases that to a type name the Prisma-owned schema does not define.
    @Query("""
            SELECT COALESCE(SUM(p.amount), 0) FROM InvoicePayment p
            WHERE p.pharmacyId = :pharmacyId
              AND CAST(p.paymentMode AS string) = 'CASH'
              AND p.paidAt >= :from AND p.paidAt <= :to
            """)
    BigDecimal sumCashCollectedInRange(@Param("pharmacyId") String pharmacyId,
                                       @Param("from") Instant from, @Param("to") Instant to);
}
