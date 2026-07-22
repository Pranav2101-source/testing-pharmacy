package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.enums.MigrationEntityType;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.migration.dto.CreateSessionRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
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
import java.time.format.DateTimeFormatter;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The CSV-import onboarding wizard: bringing a pharmacy's existing suppliers,
 * customers, doctors and stock into the system from whatever they used before.
 *
 * <p>The interesting risk here is not the happy path — it is what happens the
 * SECOND time a file touches a row that already exists (a re-run, or two CSVs that
 * both mention the same supplier), and what rollback can and cannot undo.
 */
@Transactional
class MigrationIT extends AbstractPostgresIT {

    @Autowired private MigrationService migrationService;
    @Autowired private MigrationCreatedRecordRepository createdRecordRepository;
    @Autowired private MigrationSessionRepository sessionRepository;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private InventoryMovementRepository movementRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String userId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        userId = user.getId();

        flushAndClear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private String createSession() {
        String id = migrationService.createSession(new CreateSessionRequest("Legacy System", null)).id();
        flushAndClear();
        return id;
    }

    private static final Map<String, String> IDENTITY = Map.ofEntries(
            Map.entry("supplierName", "supplierName"), Map.entry("gstin", "gstin"),
            Map.entry("phone", "phone"), Map.entry("openingBalance", "openingBalance"),
            Map.entry("creditLimit", "creditLimit"), Map.entry("openingDue", "openingDue"),
            Map.entry("medicineName", "medicineName"), Map.entry("batchNumber", "batchNumber"),
            Map.entry("expiryDate", "expiryDate"), Map.entry("quantity", "quantity"),
            Map.entry("mrp", "mrp"), Map.entry("purchaseRate", "purchaseRate"));

    @Test
    @DisplayName("a new supplier gets its opening balance")
    void newSupplierGetsOpeningBalance() {
        String sessionId = createSession();
        String csv = "supplierName,gstin,phone,openingBalance\nAcme Distributors,,9876543210,5000\n";

        migrationService.commitSuppliers(sessionId, csv, IDENTITY);
        flushAndClear();

        Supplier supplier = supplierRepository.findByPharmacyId(pharmacyId).stream()
                .filter(s -> s.getName().equals("Acme Distributors")).findFirst().orElseThrow();
        assertThat(supplier.getLedgerBalance()).isEqualByComparingTo(new BigDecimal("5000"));
        assertThat(createdRecordRepository.findBySessionIdAndEntityType(sessionId, MigrationEntityType.SUPPLIERS))
                .as("a created supplier must be tracked so rollback can undo it")
                .hasSize(1);
    }

    /**
     * The bug this pins: re-importing a CSV that matches an EXISTING supplier used
     * to overwrite {@code ledgerBalance} with the file's openingBalance — clobbering
     * whatever the system had already tracked from real GRNs, payments and returns.
     * Worse, because only newly-CREATED suppliers get a MigrationCreatedRecord, a
     * rollback of that second import had nothing to restore the real balance FROM.
     *
     * <p>commitCustomers already protected the analogous field (creditUsed) for
     * exactly this reason — see the comment there — suppliers just hadn't been
     * brought in line with it.
     */
    @Test
    @DisplayName("re-importing a matched supplier must not overwrite its real ledger balance")
    void matchedSupplierBalanceIsNotOverwritten() {
        Supplier existing = supplierRepository.save(Supplier.create(pharmacyId, "Acme Distributors"));
        existing.adjustLedgerBalance(new BigDecimal("12345.67")); // a real, tracked balance
        supplierRepository.save(existing);
        flushAndClear();

        String sessionId = createSession();
        // Same name, so findMatchingForImport matches the existing row; the file's
        // openingBalance must NOT replace the real figure above.
        String csv = "supplierName,gstin,phone,openingBalance\nAcme Distributors,,9876543210,999\n";
        migrationService.commitSuppliers(sessionId, csv, IDENTITY);
        flushAndClear();

        assertThat(supplierRepository.findById(existing.getId()).orElseThrow().getLedgerBalance())
                .as("the import must not clobber a balance the system already tracks")
                .isEqualByComparingTo(new BigDecimal("12345.67"));
    }

    @Test
    @DisplayName("a new customer gets its opening due as credit used")
    void newCustomerGetsOpeningDue() {
        String sessionId = createSession();
        String customerCsv = "customerName,phone,openingDue\nJohn Doe,9876543211,750\n";

        migrationService.commitCustomers(sessionId, customerCsv,
                Map.of("customerName", "customerName", "phone", "phone", "openingDue", "openingDue"));
        flushAndClear();

        Customer customer = customerRepository.findMatchingForImport(pharmacyId, "John Doe", "9876543211")
                .stream().findFirst().orElseThrow();
        assertThat(customer.getCreditUsed()).isEqualByComparingTo(new BigDecimal("750"));
    }

    @Test
    @DisplayName("re-importing a matched customer must not touch their real credit used")
    void matchedCustomerCreditUsedIsNotOverwritten() {
        Customer existing = customerRepository.save(Customer.create(pharmacyId, "John Doe"));
        existing.applyFields("John Doe", "9876543211", null, null, null, null, null, null, null,
                com.checkup.pharmacy.common.enums.CustomerType.CREDIT, BigDecimal.ZERO,
                new BigDecimal("5000"), null);
        existing.adjustCreditUsed(new BigDecimal("2000")); // real unpaid invoices
        customerRepository.save(existing);
        flushAndClear();

        String sessionId = createSession();
        String csv = "customerName,phone,openingDue\nJohn Doe,9876543211,999\n";
        migrationService.commitCustomers(sessionId, csv,
                Map.of("customerName", "customerName", "phone", "phone", "openingDue", "openingDue"));
        flushAndClear();

        assertThat(customerRepository.findById(existing.getId()).orElseThrow().getCreditUsed())
                .as("real unpaid invoices must not be replaced by the import's opening-due figure")
                .isEqualByComparingTo(new BigDecimal("2000"));
    }

    @Test
    @DisplayName("committing inventory creates a batch, a movement, and a rollback record")
    void commitInventoryCreatesBatchAndMovement() {
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12")));
        String sessionId = createSession();
        MedicineMapping mapping = com.checkup.pharmacy.modules.migration.MedicineMapping.create(pharmacyId, "amoxicillin 250");
        mapping.confirm(medicine.getId(), false, userId);
        mappingRepositorySave(mapping);
        flushAndClear();

        String expiry = Instant.now().plus(365, ChronoUnit.DAYS)
                .atZone(ZoneOffset.UTC).format(DateTimeFormatter.ISO_LOCAL_DATE);
        String csv = "medicineName,batchNumber,expiryDate,quantity,mrp,purchaseRate\n"
                + "Amoxicillin 250,BATCH-1," + expiry + ",100,20,10\n";

        migrationService.commitInventory(sessionId, csv, IDENTITY);
        flushAndClear();

        Inventory inv = inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(
                pharmacyId, medicine.getId(), "BATCH-1").orElseThrow();
        assertThat(inv.getQuantity()).isEqualTo(100);
        assertThat(movementRepository.findAll().stream()
                .anyMatch(m -> m.getInventoryId().equals(inv.getId())))
                .as("an opening-balance movement must exist for audit purposes")
                .isTrue();
        assertThat(createdRecordRepository.findBySessionIdAndEntityType(sessionId, MigrationEntityType.INVENTORY))
                .hasSize(1);
    }

    @Test
    @DisplayName("a batch that already exists for this medicine is skipped, not duplicated")
    void duplicateBatchIsSkipped() {
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12")));
        inventoryRepository.save(Inventory.create(pharmacyId, medicine.getId(), "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 50, new BigDecimal("10"), new BigDecimal("20"), 10, 5));
        flushAndClear();

        String sessionId = createSession();
        MedicineMapping mapping = MedicineMapping.create(pharmacyId, "amoxicillin 250");
        mapping.confirm(medicine.getId(), false, userId);
        mappingRepositorySave(mapping);
        flushAndClear();

        String expiry = Instant.now().plus(365, ChronoUnit.DAYS)
                .atZone(ZoneOffset.UTC).format(DateTimeFormatter.ISO_LOCAL_DATE);
        String csv = "medicineName,batchNumber,expiryDate,quantity,mrp,purchaseRate\n"
                + "Amoxicillin 250,BATCH-1," + expiry + ",100,20,10\n";
        var result = migrationService.commitInventory(sessionId, csv, IDENTITY);
        flushAndClear();

        assertThat(result.successRows()).isZero();
        assertThat(result.skippedRows()).isEqualTo(1);
        assertThat(inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(
                pharmacyId, medicine.getId(), "BATCH-1").orElseThrow().getQuantity())
                .as("the pre-existing batch's real quantity must be untouched, not doubled")
                .isEqualTo(50);
    }

    @Test
    @DisplayName("rollback removes created suppliers and inventory but leaves matched ones alone")
    void rollbackRemovesOnlyCreatedRecords() {
        Supplier preExisting = supplierRepository.save(Supplier.create(pharmacyId, "Old Supplier"));
        flushAndClear();

        String sessionId = createSession();
        String csv = "supplierName,gstin,phone,openingBalance\nBrand New Supplier,,9876543212,1000\n";
        migrationService.commitSuppliers(sessionId, csv, IDENTITY);
        flushAndClear();

        String newSupplierId = supplierRepository.findByPharmacyId(pharmacyId).stream()
                .filter(s -> s.getName().equals("Brand New Supplier")).findFirst().orElseThrow().getId();

        migrationService.rollbackSession(sessionId);
        flushAndClear();

        assertThat(supplierRepository.findById(newSupplierId))
                .as("a supplier CREATED by this session must be undone")
                .isEmpty();
        assertThat(supplierRepository.findById(preExisting.getId()))
                .as("a supplier that pre-dated the session must survive its rollback")
                .isPresent();
    }

    @Test
    @DisplayName("rollback deletes the inventory batch and its opening-balance movement")
    void rollbackRemovesInventoryAndMovement() {
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12")));
        String sessionId = createSession();
        MedicineMapping mapping = MedicineMapping.create(pharmacyId, "amoxicillin 250");
        mapping.confirm(medicine.getId(), false, userId);
        mappingRepositorySave(mapping);
        flushAndClear();

        String expiry = Instant.now().plus(365, ChronoUnit.DAYS)
                .atZone(ZoneOffset.UTC).format(DateTimeFormatter.ISO_LOCAL_DATE);
        String csv = "medicineName,batchNumber,expiryDate,quantity,mrp,purchaseRate\n"
                + "Amoxicillin 250,BATCH-1," + expiry + ",100,20,10\n";
        migrationService.commitInventory(sessionId, csv, IDENTITY);
        flushAndClear();
        String inventoryId = inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(
                pharmacyId, medicine.getId(), "BATCH-1").orElseThrow().getId();

        migrationService.rollbackSession(sessionId);
        flushAndClear();

        assertThat(inventoryRepository.findById(inventoryId)).isEmpty();
        assertThat(movementRepository.findAll().stream().anyMatch(m -> m.getInventoryId().equals(inventoryId)))
                .as("the movement referencing a deleted batch must go with it (FK dependency)")
                .isFalse();
    }

    @Test
    @DisplayName("a session cannot be rolled back twice")
    void rollbackIsNotRepeatable() {
        String sessionId = createSession();
        migrationService.commitSuppliers(sessionId,
                "supplierName,gstin,phone,openingBalance\nAcme,,9876543213,100\n", IDENTITY);
        flushAndClear();

        migrationService.rollbackSession(sessionId);
        flushAndClear();

        assertThat(sessionRepository.findById(sessionId).orElseThrow().getStatus())
                .isEqualTo(com.checkup.pharmacy.common.enums.MigrationSessionStatus.ROLLED_BACK);
        assertThatThrownBy(() -> migrationService.rollbackSession(sessionId))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("already been rolled back");
    }

    @Test
    @DisplayName("another pharmacy's migration session is not visible")
    void cannotAccessAnotherPharmacysSession() {
        String sessionId = createSession();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> migrationService.getSession(sessionId))
                .isInstanceOf(com.checkup.pharmacy.common.exception.NotFoundException.class);
    }

    // MedicineMappingRepository isn't autowired above to keep the field list short;
    // reach it via the entity manager instead of adding another @Autowired field.
    private void mappingRepositorySave(MedicineMapping mapping) {
        entityManager.persist(mapping);
    }
}
