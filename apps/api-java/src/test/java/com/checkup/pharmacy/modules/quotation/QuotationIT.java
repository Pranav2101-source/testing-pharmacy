package com.checkup.pharmacy.modules.quotation;

import com.checkup.pharmacy.common.enums.QuotationStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository;
import com.checkup.pharmacy.modules.quotation.dto.CreateQuotationRequest;
import com.checkup.pharmacy.modules.quotation.dto.QuotationItemRequest;
import com.checkup.pharmacy.modules.quotation.dto.UpdateQuotationRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
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
 * Supplier quotations (RFQs) and their conversion into purchase orders.
 *
 * <p>The state machine is the substance here: DRAFT to SENT to RECEIVED to CONVERTED,
 * with EXPIRED as a side exit. Conversion is the only transition that creates
 * something — a purchase order committing the pharmacy to buy — so it is the one
 * whose guards actually matter.
 */
@Transactional
class QuotationIT extends AbstractPostgresIT {

    @Autowired private QuotationService quotationService;
    @Autowired private QuotationRepository quotationRepository;
    @Autowired private PurchaseOrderRepository purchaseOrderRepository;
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

    /** A quotation with one line; quotedRate null means "supplier has not replied yet". */
    private String createQuotation(BigDecimal quotedRate) {
        var item = new QuotationItemRequest(medicineId, "Amoxicillin 250", 10,
                quotedRate, new BigDecimal("200"), BigDecimal.ZERO, BigDecimal.ZERO, null);
        String id = quotationService.create(new CreateQuotationRequest(
                supplierId, Instant.now().plus(30, ChronoUnit.DAYS), null, List.of(item))).id();
        flushAndClear();
        return id;
    }

    /** Walks a quotation to RECEIVED, the only status convertible to a PO. */
    private String receivedQuotation(BigDecimal quotedRate) {
        String id = createQuotation(quotedRate);
        quotationService.markSent(id);
        flushAndClear();
        quotationService.markReceived(id);
        flushAndClear();
        return id;
    }

    private QuotationStatus statusOf(String id) {
        return quotationRepository.findById(id).orElseThrow().getStatus();
    }

    @Test
    @DisplayName("a new quotation starts as a draft")
    void newQuotationIsDraft() {
        assertThat(statusOf(createQuotation(new BigDecimal("100")))).isEqualTo(QuotationStatus.DRAFT);
    }

    @Test
    @DisplayName("the lifecycle runs draft to sent to received")
    void lifecycleProgresses() {
        String id = createQuotation(new BigDecimal("100"));

        quotationService.markSent(id);
        flushAndClear();
        assertThat(statusOf(id)).isEqualTo(QuotationStatus.SENT);

        quotationService.markReceived(id);
        flushAndClear();
        assertThat(statusOf(id)).isEqualTo(QuotationStatus.RECEIVED);
    }

    @Test
    @DisplayName("a quotation cannot skip straight from draft to received")
    void cannotSkipSentStep() {
        String id = createQuotation(new BigDecimal("100"));

        assertThatThrownBy(() -> quotationService.markReceived(id))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("SENT");
    }

    @Test
    @DisplayName("only a received quotation can become a purchase order")
    void onlyReceivedConverts() {
        String id = createQuotation(new BigDecimal("100"));

        assertThatThrownBy(() -> quotationService.convertToPo(id, null))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Only RECEIVED");
    }

    @Test
    @DisplayName("converting produces a purchase order and closes the quotation")
    void convertProducesPurchaseOrder() {
        String id = receivedQuotation(new BigDecimal("100"));
        long ordersBefore = purchaseOrderRepository.count();

        var result = quotationService.convertToPo(id, null);
        flushAndClear();

        assertThat(result.purchaseOrder()).isNotNull();
        assertThat(purchaseOrderRepository.count()).isEqualTo(ordersBefore + 1);
        assertThat(statusOf(id))
                .as("a converted quotation is finished")
                .isEqualTo(QuotationStatus.CONVERTED);
    }

    /**
     * Guards the lock added to convertToPo.
     *
     * <p>Sequentially this only exercises the RECEIVED status check. That check alone
     * was never sufficient: unlocked it is a check-then-act, so two concurrent
     * conversions both see RECEIVED and both raise a purchase order — one quotation
     * becoming two orders to the same supplier for the same goods. DuplicateSubmitGuard
     * does not cover it either; that is only wired to create endpoints.
     */
    @Test
    @DisplayName("a quotation converts exactly once")
    void convertsExactlyOnce() {
        String id = receivedQuotation(new BigDecimal("100"));
        quotationService.convertToPo(id, null);
        flushAndClear();
        long ordersAfterFirst = purchaseOrderRepository.count();

        assertThatThrownBy(() -> quotationService.convertToPo(id, null))
                .isInstanceOf(ConflictException.class);

        flushAndClear();
        assertThat(purchaseOrderRepository.count())
                .as("a rejected second conversion must not raise another order")
                .isEqualTo(ordersAfterFirst);
    }

    @Test
    @DisplayName("a quotation with no quoted rate cannot be converted")
    void cannotConvertWithoutQuotedRates() {
        // The supplier was asked but has not priced the line yet.
        String id = receivedQuotation(null);

        assertThatThrownBy(() -> quotationService.convertToPo(id, null))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("no quoted rate");
    }

    @Test
    @DisplayName("a converted quotation can no longer be edited")
    void convertedQuotationIsFrozen() {
        String id = receivedQuotation(new BigDecimal("100"));
        quotationService.convertToPo(id, null);
        flushAndClear();

        assertThatThrownBy(() -> quotationService.update(id,
                new UpdateQuotationRequest(null, "trying to change it", null)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("an expired quotation cannot be converted")
    void expiredQuotationCannotConvert() {
        String id = createQuotation(new BigDecimal("100"));
        quotationService.markSent(id);
        flushAndClear();
        quotationService.markExpired(id);
        flushAndClear();

        assertThat(statusOf(id)).isEqualTo(QuotationStatus.EXPIRED);
        assertThatThrownBy(() -> quotationService.convertToPo(id, null))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("another pharmacy's quotation is not visible")
    void cannotReadAnotherPharmacysQuotation() {
        String id = createQuotation(new BigDecimal("100"));

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> quotationService.getById(id))
                .isInstanceOf(NotFoundException.class);
    }
}
