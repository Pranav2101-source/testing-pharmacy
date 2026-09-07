package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnResponse;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Two counters each keying in a GRN for the same brand-new, never-before-seen
 * medicine at the same instant.
 *
 * <p>NOT {@code @Transactional}: the two {@code createGrn} calls run on their own
 * threads with their own transactions, so each one's advisory lock (see
 * {@code AdvisoryLock}) is genuinely acquired and released by Postgres, not by a
 * shared test transaction that never commits.
 *
 * <p>What is under test is {@code PurchasesService.resolveMedicineRefs}'s
 * find-or-create race: before the advisory lock existed, both transactions could
 * run their {@code findFirstByPharmacyIdAndNameIgnoreCase} lookup before either
 * had committed an INSERT, each see nothing, and each create its own
 * {@code PharmacyMedicine} row for the same product — silently splitting its
 * stock and sale history across two identities forever after.
 */
class GrnLocalMedicineConcurrencyIT extends AbstractPostgresIT {

    @Autowired private PurchasesService purchasesService;
    @Autowired private PharmacyMedicineRepository pharmacyMedicineRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private UserRepository userRepository;

    private String pharmacyId;
    private String userId;
    private String supplierId;

    @BeforeEach
    void seed() {
        String u = unique();
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("GRN Race Pharmacy " + u, "grn-race-" + u));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "grn-race-" + u + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        userId = user.getId();
        supplierId = supplierRepository.save(Supplier.create(pharmacyId, "Race Distributors")).getId();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private GrnItemRequest unmatchedLine(String name, String batchNumber) {
        return new GrnItemRequest(null, null, name, "Local Pharma", null, "500mg", "TABLET", "STRIP",
                "3004", null, batchNumber, Instant.now().plus(365, ChronoUnit.DAYS), 0, 10, 0,
                null, null, new BigDecimal("10.00"), new BigDecimal("20.00"), BigDecimal.ZERO, new BigDecimal("12"));
    }

    private CreateGrnRequest grnFor(String name, String batch) {
        return new CreateGrnRequest(supplierId, null, "INV-" + unique(), Instant.now(),
                null, List.of(unmatchedLine(name, batch)), false, null);
    }

    /** Authenticates this thread, waits for its sibling, then receives one GRN naming {@code batch}. */
    private Callable<GrnResponse> receiveAs(String name, String batch, CyclicBarrier startTogether) {
        return () -> {
            authenticateAs(userId, pharmacyId, Role.OWNER);
            try {
                startTogether.await(5, TimeUnit.SECONDS);
                GrnResponse grn = purchasesService.createGrn(grnFor(name, batch));
                return purchasesService.confirmGrn(grn.id());
            } finally {
                SecurityContextHolder.clearContext();
            }
        };
    }

    @Test
    @DisplayName("two GRNs naming the same brand-new local medicine at the same instant share one identity, not two")
    void concurrentGrnsForTheSameNewLocalMedicineShareOneIdentity() throws Exception {
        String sharedName = "Concurrent Local " + unique();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CyclicBarrier startTogether = new CyclicBarrier(2);

        // Two distinct batch numbers so both receipts succeed outright — the point under test
        // is the shared identity they resolve to, not batch-level stock contention (that is
        // LooseDispensingConcurrencyIT's job).
        Future<GrnResponse> a = pool.submit(receiveAs(sharedName, "RACE-A", startTogether));
        Future<GrnResponse> b = pool.submit(receiveAs(sharedName, "RACE-B", startTogether));
        GrnResponse ra = a.get(20, TimeUnit.SECONDS);
        GrnResponse rb = b.get(20, TimeUnit.SECONDS);
        pool.shutdownNow();

        String localIdA = ra.items().get(0).localMedicineId();
        String localIdB = rb.items().get(0).localMedicineId();
        assertThat(localIdA).isNotNull();
        assertThat(localIdA).as("both GRNs must resolve to the same local-medicine identity").isEqualTo(localIdB);

        long count = pharmacyMedicineRepository.findAll().stream()
                .filter(m -> m.getPharmacyId().equals(pharmacyId) && m.getName().equalsIgnoreCase(sharedName))
                .count();
        assertThat(count).as("exactly one PharmacyMedicine row must exist for this name, not one per racer")
                .isEqualTo(1);
    }
}
