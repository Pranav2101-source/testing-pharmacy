package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
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
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.cache.CacheManager;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@code getDashboardStats} runs nine serial aggregate queries and is hit on every home
 * and sales screen load. It is now cached in-process per pharmacy (default 30s) so a busy
 * pharmacy's staff cannot fan that set out dozens of times a minute against a small
 * connection pool.
 *
 * <p>This pins both halves of the tradeoff: a second call inside the window is served from
 * cache (the whole point), and clearing the cache produces a fresh, updated result (so the
 * staleness really is bounded by the TTL and an eviction).
 */
@Transactional
class DashboardStatsCacheIT extends AbstractPostgresIT {

    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;
    @Autowired @Qualifier("caffeineCacheManager") private CacheManager caffeineCacheManager;

    private String pharmacyId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Cache Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("18")));
        batchId = inventoryRepository.save(Inventory.create(pharmacyId, medicine.getId(), "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("50.00"), new BigDecimal("100.00"), 10, 5)).getId();
        entityManager.flush();
        entityManager.clear();
        caffeineCacheManager.getCache("dashboardStats").clear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void sale() {
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID",
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 1, null, BigDecimal.ZERO, null))));
        entityManager.flush();
        entityManager.clear();
    }

    @Test
    @DisplayName("a second call inside the TTL is served from cache; clearing it recomputes fresh")
    void statsAreCachedThenRefreshedOnEvict() {
        sale();
        long firstCount = billingService.getDashboardStats().todayCount();
        assertThat(firstCount).isEqualTo(1);

        sale(); // a second bill — the cache must NOT see it yet

        assertThat(billingService.getDashboardStats().todayCount())
                .as("served from the 30s cache — still the count from the first call")
                .isEqualTo(firstCount);

        caffeineCacheManager.getCache("dashboardStats").clear();

        assertThat(billingService.getDashboardStats().todayCount())
                .as("after eviction the aggregates run again and pick up both bills")
                .isEqualTo(2);
    }

    @Test
    @DisplayName("the cache is per pharmacy — one tenant's stats never leak into another's")
    void cacheIsTenantScoped() {
        sale();
        assertThat(billingService.getDashboardStats().todayCount()).isEqualTo(1);

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        entityManager.flush();
        entityManager.clear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThat(billingService.getDashboardStats().todayCount())
                .as("the other pharmacy has its own key and its own (empty) result")
                .isZero();
    }
}
