package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
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
 * Two tills cutting the same strip at the same instant.
 *
 * <p>NOT {@code @Transactional}: the two billing calls run on their own threads with
 * their own transactions, so the seeded batch has to be genuinely committed for them
 * to see it. Each method seeds a unique pharmacy; the IT database is dropped and
 * rebuilt per suite run, so nothing here leaks into another test.
 *
 * <p>What is under test is the pessimistic row lock in
 * {@code InventoryRepository.lockAllByIdInAndPharmacyId} (SELECT ... FOR UPDATE):
 * the second transaction must WAIT for the first to commit, then read the reduced
 * stock and reject cleanly — not race past the check and drive the batch negative,
 * and not be retried forever (insufficient stock is a business failure, not a
 * transient write conflict — see RetryOnConflict).
 */
class LooseDispensingConcurrencyIT extends AbstractPostgresIT {

    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
    @Autowired private UserRepository userRepository;

    private String pharmacyId;
    private String userId;
    private String batchId;

    @BeforeEach
    void seed() {
        String u = UUID.randomUUID().toString().substring(0, 8);
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Race Pharmacy " + u, "race-" + u));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "race-" + u + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = Medicine.create("Amlodipine 5 " + u, new BigDecimal("12"));
        medicine.setPackaging(10, "TABLET");
        medicineRepository.save(medicine);

        pharmacyId = pharmacy.getId();
        userId = user.getId();

        // ONE sealed pack = 10 loose pieces on hand.
        batchId = inventoryRepository.save(Inventory.create(pharmacy.getId(), medicine.getId(), "RACE-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 1,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();

        PharmacyMedicineOverride o = PharmacyMedicineOverride.create(pharmacy.getId(), medicine.getId());
        o.setAllowLooseSale(true);
        overrideRepository.save(o);
    }

    private CreateInvoiceRequest looseBill(int pieces) {
        return new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null, null, null,
                null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, pieces, null, BigDecimal.ZERO, null, "LOOSE")));
    }

    @Test
    @DisplayName("two tills each selling 7 loose from a 10-piece batch: one wins, one is refused, stock never goes negative")
    void concurrentLooseSalesAreSerialised() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CyclicBarrier startTogether = new CyclicBarrier(2);

        // Both threads try to take 7 pieces; only 10 exist. Whichever grabs the row
        // lock first sells; the other blocks, then sees 3 left and rejects.
        Callable<Object> sell = () -> {
            authenticate();
            try {
                startTogether.await(5, TimeUnit.SECONDS);
                return billingService.createInvoice(looseBill(7));
            } catch (RuntimeException e) {
                return e;
            } finally {
                SecurityContextHolder.clearContext();
            }
        };

        Future<Object> a = pool.submit(sell);
        Future<Object> b = pool.submit(sell);
        Object ra = a.get(20, TimeUnit.SECONDS);
        Object rb = b.get(20, TimeUnit.SECONDS);
        pool.shutdownNow();

        long wins = List.of(ra, rb).stream().filter(r -> r instanceof InvoiceResponse).count();
        long refusals = List.of(ra, rb).stream().filter(r -> r instanceof ConflictException).count();
        assertThat(wins).as("exactly one sale committed").isEqualTo(1);
        assertThat(refusals).as("the other was cleanly refused, not retried into oblivion or 500'd")
                .isEqualTo(1);

        Inventory batch = inventoryRepository.findById(batchId).orElseThrow();
        assertThat(batch.getQuantity()).as("the one pack was cut").isEqualTo(0);
        assertThat(batch.getLooseUnits()).as("10 - 7 sold = 3 loose, never negative").isEqualTo(3);
        assertThat(batch.availablePieces(10)).isEqualTo(3L);
    }

    @Test
    @DisplayName("two tills whose loose sales BOTH fit are both committed, and the stock lands exactly right")
    void concurrentLooseSalesThatBothFitBothCommit() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CyclicBarrier startTogether = new CyclicBarrier(2);

        // 4 + 4 = 8 <= 10: both must succeed and the batch must end at exactly 2 loose.
        Callable<Object> sell = () -> {
            authenticate();
            try {
                startTogether.await(5, TimeUnit.SECONDS);
                return billingService.createInvoice(looseBill(4));
            } catch (RuntimeException e) {
                return e;
            } finally {
                SecurityContextHolder.clearContext();
            }
        };

        Future<Object> a = pool.submit(sell);
        Future<Object> b = pool.submit(sell);
        Object ra = a.get(20, TimeUnit.SECONDS);
        Object rb = b.get(20, TimeUnit.SECONDS);
        pool.shutdownNow();

        assertThat(ra).as("first sale").isInstanceOf(InvoiceResponse.class);
        assertThat(rb).as("second sale").isInstanceOf(InvoiceResponse.class);

        Inventory batch = inventoryRepository.findById(batchId).orElseThrow();
        assertThat(batch.getQuantity()).isEqualTo(0);
        assertThat(batch.getLooseUnits()).as("10 - 4 - 4 = 2, with no lost update").isEqualTo(2);
    }

    private void authenticate() {
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }
}
