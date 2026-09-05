package com.checkup.pharmacy.modules.supplierpayment;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.PurchasesService;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.supplierpayment.dto.CreatePaymentRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Money paid out to distributors, and the payables view a pharmacy pays against.
 *
 * <p>Previously uncovered. The figure under test — {@code outstanding} — is the one
 * an owner reads before writing a cheque, and its javadoc records a real past bug:
 * it used to be re-derived as "confirmed GRNs minus payments", which silently
 * ignored supplier returns and migrated opening balances, so two screens could
 * disagree about what was owed. These tests pin it to the stored ledger balance so
 * that cannot regress.
 */
@Transactional
class SupplierPaymentIT extends AbstractPostgresIT {

    @Autowired private SupplierPaymentService paymentService;
    @Autowired private PurchasesService purchasesService;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String supplierId;
    private String medicineId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        supplierId = supplierRepository.save(Supplier.create(pharmacyId, "Acme Distributors")).getId();
        medicineId = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12"))).getId();

        flushAndClear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    /** A confirmed GRN — the thing that puts a payable on the supplier's ledger. */
    private String receiveGoods(String batchNumber, int qty, String costPerUnit) {
        var item = new GrnItemRequest(medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, batchNumber,
                Instant.now().plus(365, ChronoUnit.DAYS), 0, qty, 0, null, null,
                new BigDecimal(costPerUnit), new BigDecimal("200.00"), BigDecimal.ZERO, BigDecimal.ZERO);
        String grnId = purchasesService.createGrn(new CreateGrnRequest(
                supplierId, null, "INV-" + unique(), Instant.now(), null, List.of(item), false, null)).id();
        flushAndClear();
        purchasesService.confirmGrn(grnId);
        flushAndClear();
        return grnId;
    }

    private CreatePaymentRequest payment(String amount) {
        return new CreatePaymentRequest(supplierId, null, new BigDecimal(amount), "CASH",
                "REF-" + unique(), "monthly settlement", Instant.now());
    }

    private BigDecimal ledgerBalance() {
        return supplierRepository.findById(supplierId).orElseThrow().getLedgerBalance();
    }

    @Nested
    @DisplayName("recording a payment")
    class Create {

        @Test
        @DisplayName("reduces the supplier's outstanding balance by the amount paid")
        void reducesLedgerBalance() {
            receiveGoods("B-1", 10, "100.00");
            BigDecimal owedBefore = ledgerBalance();

            paymentService.create(payment("500.00"));
            flushAndClear();

            assertThat(ledgerBalance()).isEqualByComparingTo(owedBefore.subtract(new BigDecimal("500.00")));
        }

        @Test
        @DisplayName("allocates a payment number and echoes the details back")
        void allocatesNumberAndEchoesDetails() {
            var created = paymentService.create(payment("500.00"));

            assertThat(created.paymentNumber()).isNotBlank();
            assertThat(created.amount()).isEqualByComparingTo(new BigDecimal("500.00"));
            assertThat(created.paymentMode()).isEqualTo("CASH");
            assertThat(created.supplier()).isNotNull();
            assertThat(created.supplier().name()).isEqualTo("Acme Distributors");
        }

        @Test
        @DisplayName("two payments give two different numbers")
        void numbersAreUnique() {
            var first = paymentService.create(payment("100.00"));
            flushAndClear();
            var second = paymentService.create(payment("200.00"));
            flushAndClear();

            assertThat(first.paymentNumber()).isNotEqualTo(second.paymentNumber());
        }

        @Test
        @DisplayName("successive payments accumulate against the balance")
        void paymentsAccumulate() {
            receiveGoods("B-1", 10, "100.00");
            BigDecimal owedBefore = ledgerBalance();

            paymentService.create(payment("300.00"));
            flushAndClear();
            paymentService.create(payment("200.00"));
            flushAndClear();

            assertThat(ledgerBalance()).isEqualByComparingTo(owedBefore.subtract(new BigDecimal("500.00")));
        }

        @Test
        @DisplayName("overpaying drives the balance negative — an advance, not an error")
        void overpaymentGoesNegative() {
            // A pharmacy legitimately pays a distributor in advance. The balance must
            // be allowed below zero and read as credit, not be clamped or refused.
            receiveGoods("B-1", 1, "100.00");
            BigDecimal owedBefore = ledgerBalance();

            paymentService.create(payment("999999.00"));
            flushAndClear();

            assertThat(ledgerBalance()).isEqualByComparingTo(owedBefore.subtract(new BigDecimal("999999.00")));
            assertThat(ledgerBalance()).isNegative();
        }

        @Test
        @DisplayName("an unknown supplier is rejected")
        void unknownSupplierRejected() {
            assertThatThrownBy(() -> paymentService.create(new CreatePaymentRequest(
                    "does-not-exist", null, new BigDecimal("100"), "CASH", null, null, Instant.now())))
                    .isInstanceOf(NotFoundException.class);
        }

        @Test
        @DisplayName("an invalid payment mode is a 400 naming the accepted values")
        void invalidPaymentModeRejected() {
            assertThatThrownBy(() -> paymentService.create(new CreatePaymentRequest(
                    supplierId, null, new BigDecimal("100"), "BITCOIN", null, null, Instant.now())))
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("CASH");
        }

        @Test
        @DisplayName("a rejected payment leaves the balance untouched")
        void rejectedPaymentDoesNotMoveBalance() {
            receiveGoods("B-1", 10, "100.00");
            BigDecimal owedBefore = ledgerBalance();

            assertThatThrownBy(() -> paymentService.create(new CreatePaymentRequest(
                    supplierId, null, new BigDecimal("100"), "BITCOIN", null, null, Instant.now())))
                    .isInstanceOf(BadRequestException.class);
            flushAndClear();

            assertThat(ledgerBalance()).isEqualByComparingTo(owedBefore);
        }
    }

    @Nested
    @DisplayName("linking a payment to a specific GRN")
    class GrnLinkage {

        @Test
        @DisplayName("a payment can be tied to a GRN and reports it back")
        void paymentCanReferenceGrn() {
            String grnId = receiveGoods("B-1", 10, "100.00");

            var created = paymentService.create(new CreatePaymentRequest(
                    supplierId, grnId, new BigDecimal("500.00"), "UPI", null, null, Instant.now()));
            flushAndClear();

            assertThat(created.grn()).isNotNull();
            assertThat(created.grn().id()).isEqualTo(grnId);
        }

        @Test
        @DisplayName("a GRN belonging to a DIFFERENT supplier is refused")
        void grnMustBelongToTheSupplierBeingPaid() {
            // Otherwise a payment to supplier A could be filed against supplier B's
            // bill, and neither ledger would reconcile.
            String grnId = receiveGoods("B-1", 10, "100.00");
            String otherSupplier = supplierRepository.save(Supplier.create(pharmacyId, "Other Distributors")).getId();
            flushAndClear();

            assertThatThrownBy(() -> paymentService.create(new CreatePaymentRequest(
                    otherSupplier, grnId, new BigDecimal("100"), "CASH", null, null, Instant.now())))
                    .isInstanceOf(NotFoundException.class)
                    .hasMessageContaining("GRN not found for this supplier");
        }

        @Test
        @DisplayName("an unknown GRN id is refused")
        void unknownGrnRejected() {
            assertThatThrownBy(() -> paymentService.create(new CreatePaymentRequest(
                    supplierId, "does-not-exist", new BigDecimal("100"), "CASH", null, null, Instant.now())))
                    .isInstanceOf(NotFoundException.class);
        }

        @Test
        @DisplayName("a blank grnId is treated as 'no GRN', not as a lookup miss")
        void blankGrnIdIsTreatedAsAbsent() {
            var created = paymentService.create(new CreatePaymentRequest(
                    supplierId, "   ", new BigDecimal("100"), "CASH", null, null, Instant.now()));

            assertThat(created.grn()).isNull();
        }
    }

    @Nested
    @DisplayName("the payables view an owner pays against")
    class Balances {

        @Test
        @DisplayName("outstanding comes from the stored ledger balance, not purchased-minus-paid")
        void outstandingTracksLedgerBalance() {
            receiveGoods("B-1", 10, "100.00");
            paymentService.create(payment("400.00"));
            flushAndClear();

            var balance = paymentService.getSupplierBalance(supplierId);
            assertThat(balance.outstanding()).isEqualByComparingTo(ledgerBalance());
        }

        @Test
        @DisplayName("totalPaid reflects payments recorded")
        void totalPaidReflectsPayments() {
            receiveGoods("B-1", 10, "100.00");
            paymentService.create(payment("300.00"));
            flushAndClear();
            paymentService.create(payment("200.00"));
            flushAndClear();

            var balance = paymentService.getSupplierBalance(supplierId);
            assertThat(balance.totalPaid()).isEqualByComparingTo(new BigDecimal("500.00"));
        }

        @Test
        @DisplayName("a supplier with no activity reports zeroes, not nulls")
        void emptySupplierReportsZeroes() {
            // The suppliers page renders this for a newly-added distributor; a null
            // here would render as "₹null" or crash the row.
            var balance = paymentService.getSupplierBalance(supplierId);

            assertThat(balance.totalPurchased()).isNotNull().isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(balance.totalPaid()).isNotNull().isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(balance.outstanding()).isNotNull();
            assertThat(balance.overdueAmount()).isNotNull().isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(balance.overdueGrns()).isEmpty();
        }

        @Test
        @DisplayName("an unknown supplier's balance is a 404")
        void unknownSupplierBalanceIsNotFound() {
            assertThatThrownBy(() -> paymentService.getSupplierBalance("does-not-exist"))
                    .isInstanceOf(NotFoundException.class);
        }

        @Test
        @DisplayName("the payables list omits suppliers who are owed nothing")
        void outstandingListSkipsSettledSuppliers() {
            // A fully-settled distributor cluttering the "who do we owe" screen makes
            // the screen useless; the filter is deliberate.
            var before = paymentService.listOutstanding();
            assertThat(before.suppliers()).isEmpty();
            assertThat(before.totalOutstanding()).isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("the payables list includes a supplier once goods are received")
        void outstandingListIncludesOwedSupplier() {
            receiveGoods("B-1", 10, "100.00");
            flushAndClear();

            var outstanding = paymentService.listOutstanding();
            assertThat(outstanding.suppliers()).hasSize(1);
            assertThat(outstanding.suppliers().get(0).name()).isEqualTo("Acme Distributors");
            assertThat(outstanding.totalOutstanding()).isGreaterThan(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("paying a supplier off in full removes them from the payables list")
        void settlingRemovesFromOutstandingList() {
            receiveGoods("B-1", 10, "100.00");
            BigDecimal owed = ledgerBalance();
            paymentService.create(new CreatePaymentRequest(supplierId, null, owed, "CASH", null, null, Instant.now()));
            flushAndClear();

            assertThat(paymentService.listOutstanding().suppliers()).isEmpty();
        }

        @Test
        @DisplayName("the payables list is sorted by who is owed the most")
        void outstandingListIsSortedByAmount() {
            receiveGoods("B-1", 5, "100.00");

            String bigSupplier = supplierRepository.save(Supplier.create(pharmacyId, "Big Distributors")).getId();
            flushAndClear();
            var item = new GrnItemRequest(medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, "B-BIG",
                    Instant.now().plus(365, ChronoUnit.DAYS), 0, 100, 0, null, null,
                    new BigDecimal("500.00"), new BigDecimal("900.00"), BigDecimal.ZERO, BigDecimal.ZERO);
            String grnId = purchasesService.createGrn(new CreateGrnRequest(
                    bigSupplier, null, "INV-" + unique(), Instant.now(), null, List.of(item), false, null)).id();
            flushAndClear();
            purchasesService.confirmGrn(grnId);
            flushAndClear();

            var outstanding = paymentService.listOutstanding();
            assertThat(outstanding.suppliers()).hasSize(2);
            assertThat(outstanding.suppliers().get(0).name()).isEqualTo("Big Distributors");
        }
    }

    @Nested
    @DisplayName("reads, listing and tenant isolation")
    class Reads {

        @Test
        @DisplayName("a recorded payment is retrievable by id")
        void paymentIsRetrievable() {
            var created = paymentService.create(payment("250.00"));
            flushAndClear();

            var fetched = paymentService.getById(created.id());
            assertThat(fetched.amount()).isEqualByComparingTo(new BigDecimal("250.00"));
            assertThat(fetched.notes()).isEqualTo("monthly settlement");
        }

        @Test
        @DisplayName("an unknown payment id is a 404")
        void unknownPaymentIsNotFound() {
            assertThatThrownBy(() -> paymentService.getById("does-not-exist"))
                    .isInstanceOf(NotFoundException.class);
        }

        @Test
        @DisplayName("listing shows this pharmacy's payments")
        void listsPayments() {
            paymentService.create(payment("100.00"));
            flushAndClear();
            paymentService.create(payment("200.00"));
            flushAndClear();

            var page = paymentService.list(null, null, null, null, 1, 20);
            assertThat(page.items()).hasSize(2);
            assertThat(page.total()).isEqualTo(2);
        }

        @Test
        @DisplayName("listing filters by supplier")
        void filtersBySupplier() {
            paymentService.create(payment("100.00"));
            flushAndClear();

            assertThat(paymentService.list(supplierId, null, null, null, 1, 20).items()).hasSize(1);
            assertThat(paymentService.list("some-other-supplier", null, null, null, 1, 20).items()).isEmpty();
        }

        @Test
        @DisplayName("an out-of-range page is clamped rather than throwing")
        void clampsPaging() {
            var page = paymentService.list(null, null, null, null, -5, 5000);
            assertThat(page.page()).isEqualTo(1);
            assertThat(page.limit()).isEqualTo(100);
        }

        @Test
        @DisplayName("another pharmacy cannot see or fetch this pharmacy's payments")
        void tenantIsolation() {
            var created = paymentService.create(payment("100.00"));
            flushAndClear();

            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                    "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
            flushAndClear();
            authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

            assertThatThrownBy(() -> paymentService.getById(created.id()))
                    .isInstanceOf(NotFoundException.class);
            assertThat(paymentService.list(null, null, null, null, 1, 20).items()).isEmpty();
            assertThat(paymentService.listOutstanding().suppliers()).isEmpty();
        }

        @Test
        @DisplayName("another pharmacy cannot pay this pharmacy's supplier")
        void cannotPayAnotherTenantsSupplier() {
            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                    "other-" + unique() + "@test.local", "9222222222", "hash", Role.OWNER));
            flushAndClear();
            authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

            assertThatThrownBy(() -> paymentService.create(payment("100.00")))
                    .isInstanceOf(NotFoundException.class);
        }
    }
}
