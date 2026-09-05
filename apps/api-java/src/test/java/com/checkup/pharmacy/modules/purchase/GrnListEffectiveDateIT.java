package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The Purchase/Gate-Inward list ({@code GoodsReceiptNoteRepository.search}) ranges and
 * orders by {@code COALESCE(confirmedAt, createdAt, supplierInvoiceDate)}. A GRN whose
 * {@code createdAt} predates {@code DateRange.MIN} (a junk value from a historical
 * data load) used to vanish from the list while still counting toward the summary
 * cards — "the badge says 9+ but the tab is empty".
 */
@Transactional
class GrnListEffectiveDateIT extends AbstractPostgresIT {

    @Autowired private PurchasesService purchasesService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager em;

    private String pharmacyId;
    private String supplierId;
    private String medicineId;
    private String userId;

    @BeforeEach
    void seed() {
        pharmacyId = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + u())).getId();
        userId = userRepository.save(User.create(pharmacyId, "Om Owner",
                "owner-" + u() + "@test.local", "9000000001", "hash", Role.OWNER)).getId();
        supplierId = supplierRepository.save(Supplier.create(pharmacyId, "Acme")).getId();
        medicineId = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12"))).getId();
        em.flush();
        em.clear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    private static String u() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private String confirmedGrn() {
        GrnItemRequest line = new GrnItemRequest(medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, "B-" + u(),
                Instant.now().plus(400, ChronoUnit.DAYS), 0, 10, 0,
                "UNIT", 1, new BigDecimal("10.00"), new BigDecimal("20.00"), BigDecimal.ZERO, new BigDecimal("12"));
        String grnId = purchasesService.createGrn(new CreateGrnRequest(
                supplierId, null, "INV-" + u(), Instant.now(), null, List.of(line), false, null)).id();
        purchasesService.confirmGrn(grnId);
        em.flush();
        em.clear();
        return grnId;
    }

    @Test
    void confirmedGrnAppearsInTheStatusFilteredAndUnfilteredList() {
        String grnId = confirmedGrn();

        assertThat(purchasesService.listGrns("CONFIRMED", null, null, null, false, 1, 20).items())
                .extracting(i -> i.id()).contains(grnId);
        assertThat(purchasesService.listGrns(null, null, null, null, false, 1, 20).items())
                .extracting(i -> i.id()).contains(grnId);
    }

    @Test
    void confirmedGrnWithAPre1970CreatedAtStillAppears() {
        String grnId = confirmedGrn();
        // Unparseable date that fell back to the epoch in IST -> 1969-12-31T18:30:00Z,
        // just before DateRange.MIN (1970-01-01Z). The old `g.createdAt >= :from`
        // dropped it from the list even with no date filter.
        em.createNativeQuery("UPDATE goods_receipt_notes SET \"createdAt\" = TIMESTAMP '1969-12-31 18:30:00+00' WHERE id = :id")
                .setParameter("id", grnId).executeUpdate();
        em.clear();

        assertThat(purchasesService.listGrns("CONFIRMED", null, null, null, false, 1, 20).items())
                .extracting(i -> i.id()).contains(grnId);
    }

    @Test
    void listIsOrderedByConfirmDateNewestFirst() {
        String older = confirmedGrn();
        em.createNativeQuery("UPDATE goods_receipt_notes SET \"confirmedAt\" = :t WHERE id = :id")
                .setParameter("t", Instant.now().minus(40, ChronoUnit.DAYS))
                .setParameter("id", older)
                .executeUpdate();
        em.clear();
        String newer = confirmedGrn();

        List<String> ids = purchasesService.listGrns("CONFIRMED", null, null, null, false, 1, 20)
                .items().stream().map(i -> i.id()).toList();
        assertThat(ids).containsSubsequence(newer, older);
    }
}
