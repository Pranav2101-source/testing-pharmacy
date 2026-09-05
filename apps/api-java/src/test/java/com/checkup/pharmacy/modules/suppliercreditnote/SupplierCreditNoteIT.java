package com.checkup.pharmacy.modules.suppliercreditnote;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.PurchasesService;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
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
 * Supplier credit notes — the ledger-balance side of this (whether applying one
 * actually reduces what the pharmacy owes) is covered end-to-end in
 * {@link com.checkup.pharmacy.modules.supplier.SupplierLedgerIT} alongside the
 * other flows that touch the same running total. This suite covers what's
 * specific to this module: validation, status-transition rules, tenant
 * isolation, and the return-linkage rule.
 */
@Transactional
class SupplierCreditNoteIT extends AbstractPostgresIT {

    @Autowired private SupplierCreditNoteService creditNoteService;
    @Autowired private PurchasesService purchasesService;
    @Autowired private SupplierReturnsService returnsService;
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

    private CreateCreditNoteRequest standaloneReq(BigDecimal amount) {
        return new CreateCreditNoteRequest(supplierId, null, amount, "SUP-REF-" + unique(), "notes", Instant.now());
    }

    @Test
    @DisplayName("a created standalone credit note starts PENDING and carries its reference")
    void createdStandaloneCreditNoteIsPending() {
        var created = creditNoteService.create(standaloneReq(new BigDecimal("100")));

        assertThat(created.status()).isEqualTo("PENDING");
        assertThat(created.reference()).startsWith("SUP-REF-");
        assertThat(created.supplierReturn()).isNull();
    }

    @Test
    @DisplayName("applying a credit note is refused a second time")
    void cannotApplyTwice() {
        var note = creditNoteService.create(standaloneReq(new BigDecimal("100")));
        flushAndClear();
        creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("APPLIED", null));
        flushAndClear();

        assertThatThrownBy(() -> creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("APPLIED", null)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("cancelling an already-cancelled credit note is refused")
    void cannotCancelTwice() {
        var note = creditNoteService.create(standaloneReq(new BigDecimal("100")));
        flushAndClear();
        creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("CANCELLED", null));
        flushAndClear();

        assertThatThrownBy(() -> creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("CANCELLED", null)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("an unrecognized status value is rejected")
    void invalidStatusRejected() {
        var note = creditNoteService.create(standaloneReq(new BigDecimal("100")));
        flushAndClear();

        assertThatThrownBy(() -> creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("BOGUS", null)))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("explicitly setting status back to PENDING is rejected")
    void explicitPendingRejected() {
        var note = creditNoteService.create(standaloneReq(new BigDecimal("100")));
        flushAndClear();

        assertThatThrownBy(() -> creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("PENDING", null)))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("linking a credit note to a return that isn't confirmed yet is rejected")
    void cannotLinkToUnconfirmedReturn() {
        // An empty item list is enough: the credit note's "must be CONFIRMED" check
        // runs before it ever looks at the return's items, so a DRAFT return with no
        // items still proves the point without needing real stock to return.
        var draftReturn = returnsService.create(new CreateSupplierReturnRequest(supplierId, null, null, List.of()));
        flushAndClear();

        assertThatThrownBy(() -> creditNoteService.create(
                new CreateCreditNoteRequest(supplierId, draftReturn.id(), new BigDecimal("100"), null, null, Instant.now())))
                .isInstanceOf(NotFoundException.class)
                .hasMessageContaining("Confirmed supplier return not found");
    }

    @Test
    @DisplayName("linking a credit note to another supplier's return is rejected")
    void cannotLinkToAnotherSuppliersReturn() {
        String otherSupplierId = supplierRepository.save(Supplier.create(pharmacyId, "Other Distributor")).getId();
        flushAndClear();

        var item = new SupplierReturnItemRequest(inventoryIdAfterReceiving("BATCH-A", 10), medicineId,
                "Amoxicillin 250", "BATCH-A", Instant.now().plus(365, ChronoUnit.DAYS), 2,
                new BigDecimal("100.00"), BigDecimal.ZERO, "DAMAGED");
        String returnId = returnsService.create(new CreateSupplierReturnRequest(supplierId, null, null, List.of(item))).id();
        flushAndClear();
        returnsService.confirm(returnId);
        flushAndClear();

        assertThatThrownBy(() -> creditNoteService.create(
                new CreateCreditNoteRequest(otherSupplierId, returnId, new BigDecimal("100"), null, null, Instant.now())))
                .isInstanceOf(NotFoundException.class);
    }

    private String inventoryIdAfterReceiving(String batchNumber, int qty) {
        var item = new GrnItemRequest(medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, batchNumber,
                Instant.now().plus(365, ChronoUnit.DAYS), 0, qty, 0, null, null,
                new BigDecimal("100.00"), new BigDecimal("200.00"), BigDecimal.ZERO, BigDecimal.ZERO);
        String grnId = purchasesService.createGrn(new CreateGrnRequest(
                supplierId, null, "INV-" + unique(), Instant.now(), null, List.of(item), false, null)).id();
        flushAndClear();
        purchasesService.confirmGrn(grnId);
        flushAndClear();
        return inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(pharmacyId, medicineId, batchNumber)
                .orElseThrow().getId();
    }

    @Test
    @DisplayName("a credit note for an unknown supplier is rejected")
    void unknownSupplierRejected() {
        assertThatThrownBy(() -> creditNoteService.create(
                new CreateCreditNoteRequest("does-not-exist", null, new BigDecimal("100"), null, null, Instant.now())))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("an unknown credit note id is reported as not found")
    void unknownCreditNoteIdIsNotFound() {
        assertThatThrownBy(() -> creditNoteService.getById("does-not-exist"))
                .isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> creditNoteService.updateStatus("does-not-exist", new UpdateCreditNoteStatusRequest("APPLIED", null)))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("another pharmacy's credit note is not visible")
    void cannotAccessAnotherPharmacysCreditNote() {
        var note = creditNoteService.create(standaloneReq(new BigDecimal("100")));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> creditNoteService.getById(note.id()))
                .isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> creditNoteService.updateStatus(note.id(), new UpdateCreditNoteStatusRequest("APPLIED", null)))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("the list view is tenant-scoped and totals only this pharmacy's pending credit")
    void listIsTenantScopedAndTotalsPending() {
        creditNoteService.create(standaloneReq(new BigDecimal("100")));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        String otherSupplierId = supplierRepository.save(Supplier.create(other.getId(), "Their Distributor")).getId();
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);
        creditNoteService.create(new CreateCreditNoteRequest(otherSupplierId, null, new BigDecimal("9999"), null, null, Instant.now()));
        flushAndClear();

        var page = creditNoteService.list(null, null, null, null, 1, 50);
        assertThat(page.items()).hasSize(1);
        assertThat(page.totalPendingCredit()).isEqualByComparingTo(new BigDecimal("9999"));
    }
}
