package com.checkup.pharmacy.modules.supplier;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.PurchasesService;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.supplierpayment.SupplierPaymentService;
import com.checkup.pharmacy.modules.supplierpayment.dto.CreatePaymentRequest;
import com.checkup.pharmacy.modules.suppliercreditnote.SupplierCreditNoteService;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.CreateCreditNoteRequest;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.UpdateCreditNoteStatusRequest;
import com.checkup.pharmacy.modules.supplierreturn.SupplierReturnsService;
import com.checkup.pharmacy.modules.supplierreturn.dto.CreateSupplierReturnRequest;
import com.checkup.pharmacy.modules.supplierreturn.dto.SupplierReturnItemRequest;
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
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The supplier ledger balance — what the pharmacy owes, and therefore what it pays
 * against.
 *
 * <p>Three unrelated flows move this one running total: confirming a goods receipt
 * increases it, recording a payment decreases it, confirming a supplier return
 * decreases it. Each lives in a different module, and none of them owned the number.
 * These tests treat the balance as the thing under test rather than any one flow,
 * because that is where the arithmetic has to agree.
 */
@Transactional
class SupplierLedgerIT extends AbstractPostgresIT {

    @Autowired private PurchasesService purchasesService;
    @Autowired private SupplierPaymentService paymentService;
    @Autowired private SupplierReturnsService returnsService;
    @Autowired private SupplierCreditNoteService creditNoteService;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private InventoryRepository inventoryRepository;
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

    private BigDecimal balance() {
        return supplierRepository.findById(supplierId).orElseThrow().getLedgerBalance();
    }

    /** Receives `qty` units at Rs.100 each, 0% GST — so the GRN total is exactly qty x 100. */
    private String receiveStock(String batchNumber, int qty) {
        var item = new GrnItemRequest(medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, batchNumber,
                Instant.now().plus(365, ChronoUnit.DAYS), 0, qty, 0, null, null,
                new BigDecimal("100.00"), new BigDecimal("200.00"), BigDecimal.ZERO, BigDecimal.ZERO);
        String grnId = purchasesService.createGrn(new CreateGrnRequest(
                supplierId, null, "INV-" + unique(), Instant.now(), null, List.of(item), false, null)).id();
        flushAndClear();
        purchasesService.confirmGrn(grnId);
        flushAndClear();
        return grnId;
    }

    private String inventoryIdFor(String batchNumber) {
        return inventoryRepository
                .findByPharmacyIdAndMedicineIdAndBatchNumber(pharmacyId, medicineId, batchNumber)
                .orElseThrow().getId();
    }

    @Test
    @DisplayName("a new supplier starts with a zero balance")
    void newSupplierOwesNothing() {
        assertThat(balance()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("confirming a goods receipt increases what the pharmacy owes")
    void receiptIncreasesBalance() {
        receiveStock("BATCH-A", 10); // Rs.1000

        assertThat(balance()).isEqualByComparingTo(new BigDecimal("1000.00"));
    }

    @Test
    @DisplayName("paying the supplier reduces what is owed")
    void paymentReducesBalance() {
        receiveStock("BATCH-A", 10); // owes 1000

        paymentService.create(new CreatePaymentRequest(supplierId, null, new BigDecimal("400"),
                "CASH", null, null, Instant.now()));
        flushAndClear();

        assertThat(balance()).isEqualByComparingTo(new BigDecimal("600.00"));
    }

    @Test
    @DisplayName("sending goods back reduces what is owed")
    void supplierReturnReducesBalance() {
        receiveStock("BATCH-A", 10); // owes 1000
        String inventoryId = inventoryIdFor("BATCH-A");

        var item = new SupplierReturnItemRequest(inventoryId, medicineId, "Amoxicillin 250",
                "BATCH-A", Instant.now().plus(365, ChronoUnit.DAYS), 3,
                new BigDecimal("100.00"), BigDecimal.ZERO, "DAMAGED");
        String returnId = returnsService.create(new CreateSupplierReturnRequest(
                supplierId, null, null, List.of(item))).id();
        flushAndClear();

        returnsService.confirm(returnId);
        flushAndClear();

        assertThat(balance())
                .as("3 of 10 units sent back at Rs.100 = Rs.300 less owed")
                .isEqualByComparingTo(new BigDecimal("700.00"));
        assertThat(inventoryRepository.findById(inventoryId).orElseThrow().getQuantity())
                .as("returned goods leave the shelf")
                .isEqualTo(7);
    }

    /**
     * The three flows applied in sequence against one supplier.
     *
     * <p>Each is individually correct; what this pins is that they AGREE. The balance
     * is a running total none of the three modules owns, so an arithmetic sign error
     * or a lost update in any one of them shows up here and nowhere else.
     */
    @Test
    @DisplayName("receipts, returns and payments compose into one consistent balance")
    void allThreeFlowsCompose() {
        receiveStock("BATCH-A", 10); // +1000
        receiveStock("BATCH-B", 5);  // +500  -> 1500

        String inventoryId = inventoryIdFor("BATCH-A");
        var item = new SupplierReturnItemRequest(inventoryId, medicineId, "Amoxicillin 250",
                "BATCH-A", Instant.now().plus(365, ChronoUnit.DAYS), 2,
                new BigDecimal("100.00"), BigDecimal.ZERO, "DAMAGED");
        String returnId = returnsService.create(new CreateSupplierReturnRequest(
                supplierId, null, null, List.of(item))).id();
        flushAndClear();
        returnsService.confirm(returnId); // -200 -> 1300
        flushAndClear();

        paymentService.create(new CreatePaymentRequest(supplierId, null, new BigDecimal("300"),
                "UPI", null, null, Instant.now())); // -300 -> 1000
        flushAndClear();

        assertThat(balance())
                .as("1000 + 500 - 200 - 300")
                .isEqualByComparingTo(new BigDecimal("1000.00"));
    }

    @Test
    @DisplayName("applying a standalone credit note reduces what is owed")
    void standaloneAppliedCreditNoteReducesBalance() {
        receiveStock("BATCH-A", 10); // owes 1000

        var note = creditNoteService.create(new CreateCreditNoteRequest(
                supplierId, null, new BigDecimal("150"), "SUP-CN-001", "Pricing correction", Instant.now()));
        flushAndClear();
        creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("APPLIED", null));
        flushAndClear();

        assertThat(balance())
                .as("a standalone credit note has no other adjustment anywhere else in the system")
                .isEqualByComparingTo(new BigDecimal("850.00"));
    }

    @Test
    @DisplayName("a credit note raised against an already-confirmed return does not double-adjust the balance")
    void returnLinkedCreditNoteDoesNotDoubleAdjustBalance() {
        receiveStock("BATCH-A", 10); // owes 1000
        String inventoryId = inventoryIdFor("BATCH-A");

        var item = new SupplierReturnItemRequest(inventoryId, medicineId, "Amoxicillin 250",
                "BATCH-A", Instant.now().plus(365, ChronoUnit.DAYS), 3,
                new BigDecimal("100.00"), BigDecimal.ZERO, "DAMAGED");
        String returnId = returnsService.create(new CreateSupplierReturnRequest(
                supplierId, null, null, List.of(item))).id();
        flushAndClear();
        returnsService.confirm(returnId); // -300, already credited -> 700
        flushAndClear();

        var note = creditNoteService.create(new CreateCreditNoteRequest(
                supplierId, returnId, new BigDecimal("300"), null, null, Instant.now()));
        flushAndClear();
        creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("APPLIED", null));
        flushAndClear();

        assertThat(balance())
                .as("the return's own confirm() already credited this — applying the note must not credit it again")
                .isEqualByComparingTo(new BigDecimal("700.00"));
    }

    @Test
    @DisplayName("cancelling a credit note never adjusts the balance")
    void cancelledCreditNoteDoesNotAdjustBalance() {
        receiveStock("BATCH-A", 10); // owes 1000

        var note = creditNoteService.create(new CreateCreditNoteRequest(
                supplierId, null, new BigDecimal("150"), null, null, Instant.now()));
        flushAndClear();
        creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("CANCELLED", null));
        flushAndClear();

        assertThat(balance()).isEqualByComparingTo(new BigDecimal("1000.00"));
    }

    @Test
    @DisplayName("a supplier return cannot be confirmed twice")
    void returnConfirmsExactlyOnce() {
        receiveStock("BATCH-A", 10);
        String inventoryId = inventoryIdFor("BATCH-A");

        var item = new SupplierReturnItemRequest(inventoryId, medicineId, "Amoxicillin 250",
                "BATCH-A", Instant.now().plus(365, ChronoUnit.DAYS), 3,
                new BigDecimal("100.00"), BigDecimal.ZERO, "DAMAGED");
        String returnId = returnsService.create(new CreateSupplierReturnRequest(
                supplierId, null, null, List.of(item))).id();
        flushAndClear();
        returnsService.confirm(returnId);
        flushAndClear();

        assertThatThrownBy(() -> returnsService.confirm(returnId))
                .isInstanceOf(ConflictException.class);

        flushAndClear();
        assertThat(balance())
                .as("a rejected second confirmation must not credit the supplier again")
                .isEqualByComparingTo(new BigDecimal("700.00"));
        assertThat(inventoryRepository.findById(inventoryId).orElseThrow().getQuantity())
                .as("nor take the stock twice")
                .isEqualTo(7);
    }

    @Test
    @DisplayName("goods cannot be returned beyond what is in stock")
    void cannotReturnMoreThanHeld() {
        receiveStock("BATCH-A", 5);
        String inventoryId = inventoryIdFor("BATCH-A");

        var item = new SupplierReturnItemRequest(inventoryId, medicineId, "Amoxicillin 250",
                "BATCH-A", Instant.now().plus(365, ChronoUnit.DAYS), 50,
                new BigDecimal("100.00"), BigDecimal.ZERO, "DAMAGED");
        String returnId = returnsService.create(new CreateSupplierReturnRequest(
                supplierId, null, null, List.of(item))).id();
        flushAndClear();

        assertThatThrownBy(() -> returnsService.confirm(returnId))
                .hasMessageContaining("only 5 in stock");

        flushAndClear();
        assertThat(balance())
                .as("a refused return must not credit the supplier")
                .isEqualByComparingTo(new BigDecimal("500.00"));
    }

    /**
     * The stored balance and the reported balance must describe the same debt.
     *
     * <p>{@code Supplier.ledgerBalance} is a running total maintained by GRN confirm,
     * payments, supplier returns, and (for standalone ones) applied credit notes.
     * {@code getSupplierBalance().outstanding} and {@code listOutstanding()}'s
     * per-supplier {@code outstanding} both now read that same field directly rather
     * than re-deriving it, specifically so they cannot drift apart the way they used
     * to the moment goods were sent back or a credit note applied.
     */
    @Test
    @DisplayName("the stored balance and the reported outstanding agree after a return")
    void storedAndReportedBalanceAgree() {
        receiveStock("BATCH-A", 10); // owes 1000
        String inventoryId = inventoryIdFor("BATCH-A");

        var item = new SupplierReturnItemRequest(inventoryId, medicineId, "Amoxicillin 250",
                "BATCH-A", Instant.now().plus(365, ChronoUnit.DAYS), 3,
                new BigDecimal("100.00"), BigDecimal.ZERO, "DAMAGED");
        String returnId = returnsService.create(new CreateSupplierReturnRequest(
                supplierId, null, null, List.of(item))).id();
        flushAndClear();
        returnsService.confirm(returnId);
        flushAndClear();

        BigDecimal reported = paymentService.getSupplierBalance(supplierId).outstanding();

        assertThat(reported)
                .as("stored ledgerBalance says 700 after a Rs.300 return; the payables "
                        + "screen must not say something different about the same supplier")
                .isEqualByComparingTo(balance());
    }

    /**
     * {@code listOutstanding} (the all-suppliers payables list) used to compute
     * {@code outstanding} independently as purchased-minus-paid, the exact formula
     * {@link #storedAndReportedBalanceAgree} above already proved wrong for the
     * single-supplier view — missing returns, migrated openings, and credit notes.
     * This pins the list view specifically, since nothing else exercises it.
     */
    @Test
    @DisplayName("the payables list agrees with the stored balance after a return and an applied credit note")
    void listOutstandingAgreesWithStoredBalance() {
        receiveStock("BATCH-A", 10); // owes 1000
        String inventoryId = inventoryIdFor("BATCH-A");

        var item = new SupplierReturnItemRequest(inventoryId, medicineId, "Amoxicillin 250",
                "BATCH-A", Instant.now().plus(365, ChronoUnit.DAYS), 3,
                new BigDecimal("100.00"), BigDecimal.ZERO, "DAMAGED");
        String returnId = returnsService.create(new CreateSupplierReturnRequest(
                supplierId, null, null, List.of(item))).id();
        flushAndClear();
        returnsService.confirm(returnId); // -300 -> 700
        flushAndClear();

        var note = creditNoteService.create(new CreateCreditNoteRequest(
                supplierId, null, new BigDecimal("100"), null, null, Instant.now()));
        flushAndClear();
        creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("APPLIED", null));
        flushAndClear();

        var listed = paymentService.listOutstanding().suppliers().stream()
                .filter(d -> d.id().equals(supplierId)).findFirst().orElseThrow();

        assertThat(listed.outstanding())
                .as("the payables list must show the same 600 the supplier's own ledgerBalance shows")
                .isEqualByComparingTo(balance())
                .isEqualByComparingTo(new BigDecimal("600.00"));
    }

    @Test
    @DisplayName("another pharmacy's supplier cannot be paid")
    void cannotPayAnotherPharmacysSupplier() {
        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        String foreignSupplierId = supplierRepository.save(
                Supplier.create(other.getId(), "Their Distributor")).getId();
        flushAndClear();

        assertThatThrownBy(() -> paymentService.create(new CreatePaymentRequest(
                foreignSupplierId, null, new BigDecimal("100"), "CASH", null, null, Instant.now())))
                .isInstanceOf(NotFoundException.class);

        assertThat(supplierRepository.findById(foreignSupplierId).orElseThrow().getLedgerBalance())
                .as("another tenant's ledger must be untouched")
                .isEqualByComparingTo(BigDecimal.ZERO);
    }
}
