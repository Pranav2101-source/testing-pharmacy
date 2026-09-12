package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.enums.InvoiceStatus;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.enums.PaymentStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.billing.Invoice;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Settles, before step 4 touches {@code BillingService}, whether a ledger entry
 * can safely reference an invoice created earlier in the SAME transaction.
 *
 * <p>WHY THIS NEEDED ITS OWN TEST
 * <p>{@code customer_ledger_entries.invoiceId} references {@code invoices.id}
 * with an ordinary (non-deferrable) foreign key — Postgres checks it at
 * statement time, not at commit. {@code BillingService.createInvoice} will need
 * to call {@code invoiceRepository.save(invoice)} and then
 * {@code customerLedgerService.postSale(..., invoice.getId(), ...)} inside the
 * same transaction, and whether that is safe depends entirely on whether
 * Hibernate flushes the invoice INSERT before the ledger-entry INSERT. That is
 * an implementation detail of the persistence provider, not something to assume
 * — so it is tested directly here, once, rather than discovered the first time
 * a real bill is posted on credit.
 */
@Transactional
class CustomerLedgerInvoiceLinkageIT extends AbstractPostgresIT {

    @Autowired private CustomerLedgerService ledgerService;
    @Autowired private CustomerLedgerEntryRepository ledgerRepository;
    @Autowired private InvoiceRepository invoiceRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String customerId;
    private String userId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        pharmacyId = pharmacy.getId();
        User user = userRepository.save(User.create(pharmacyId, "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        userId = user.getId();
        customerId = customerRepository.save(Customer.create(pharmacyId, "Test Customer")).getId();
        entityManager.flush();
        entityManager.clear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private Invoice minimalInvoice() {
        return Invoice.create(pharmacyId, "INV-" + unique(), userId, customerId, "Test Customer", null,
                null, null, null, null, PaymentMode.CREDIT, PaymentStatus.PENDING, false, null, null,
                new BigDecimal("1000.00"), BigDecimal.ZERO, new BigDecimal("1000.00"), BigDecimal.ZERO,
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("1000.00"),
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);
    }

    @Test
    @DisplayName("a ledger entry can reference an invoice saved earlier in the same transaction")
    void ledgerEntryCanLinkToASameTransactionInvoice() {
        Invoice invoice = minimalInvoice();
        invoiceRepository.save(invoice);

        // No explicit flush between save() and postSale() — this is the exact
        // sequence createInvoice() will use. If Hibernate's default flush
        // ordering does not insert the invoice before the ledger entry, this
        // throws a foreign-key violation right here, before it ever reaches
        // production billing code.
        assertThatCode(() -> ledgerService.postSale(pharmacyId, customerId, invoice.getId(),
                new BigDecimal("1000.00"), userId))
                .doesNotThrowAnyException();

        entityManager.flush();
        entityManager.clear();

        CustomerLedgerEntry entry = ledgerRepository.findStatementAscending(pharmacyId, customerId).get(0);
        assertThat(entry.getInvoiceId()).isEqualTo(invoice.getId());
        assertThat(invoiceRepository.findById(invoice.getId())).isPresent();
    }

    @Test
    @DisplayName("the same ordering holds when the invoice row is explicitly flushed first")
    void explicitFlushBetweenInvoiceAndLedgerEntryAlsoWorks() {
        // The safer variant, in case the unflushed case above ever needs a
        // fallback: an explicit flush after saving the invoice guarantees the
        // row exists before the ledger insert is attempted, independent of
        // Hibernate's default ordering.
        Invoice invoice = minimalInvoice();
        invoiceRepository.save(invoice);
        entityManager.flush();

        assertThatCode(() -> ledgerService.postSale(pharmacyId, customerId, invoice.getId(),
                new BigDecimal("500.00"), userId))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("cancelling an invoice after its ledger entry exists does not delete the money trail")
    void invoiceLinkSurvivesDeletionViaSetNull() {
        // Not a real cancel flow (that stays on the Invoice row) — this proves
        // the FK's ON DELETE SET NULL behaviour the migration declared, so a
        // ledger row can never be silently deleted just because the invoice it
        // referenced is removed.
        Invoice invoice = minimalInvoice();
        invoiceRepository.save(invoice);
        ledgerService.postSale(pharmacyId, customerId, invoice.getId(), new BigDecimal("200.00"), userId);
        entityManager.flush();
        entityManager.clear();

        invoiceRepository.deleteById(invoice.getId());
        entityManager.flush();
        entityManager.clear();

        CustomerLedgerEntry entry = ledgerRepository.findStatementAscending(pharmacyId, customerId).get(0);
        assertThat(entry.getInvoiceId()).isNull();
        assertThat(entry.getDuesDelta()).isEqualByComparingTo("200.00");
    }
}
