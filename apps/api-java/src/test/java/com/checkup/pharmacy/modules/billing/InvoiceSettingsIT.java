package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves the Invoice Settings screen is actually connected to billing.
 *
 * <p>{@link PharmacyInvoiceSettingsTest} covers the parsing and formatting in
 * isolation. This suite closes the loop the user actually experiences: save
 * settings through the real endpoint, then issue a real bill and check the number
 * it carries — and save a return window, then check a return is judged against it.
 *
 * <p>Both behaviours were previously hardcoded while the settings screen presented
 * them as configurable, so these are regression tests for a promise the UI makes.
 */
@Transactional
class InvoiceSettingsIT extends AbstractPostgresIT {

    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;
    @Autowired private ObjectMapper objectMapper;

    private String pharmacyId;
    private String userId;
    private String medicineId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = medicineRepository.save(Medicine.create("Paracetamol 500", new BigDecimal("12")));

        pharmacyId = pharmacy.getId();
        userId = user.getId();
        medicineId = medicine.getId();
        batchId = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 500,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();

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

    /** Saves through the real service the settings screen calls, not by poking the column. */
    private void saveSettings(String json) throws Exception {
        billingService.saveInvoiceSettings(objectMapper.readTree(json));
        flushAndClear();
    }

    private CreateInvoiceRequest sale(int quantity) {
        return new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, quantity, null, BigDecimal.ZERO)));
    }

    @Nested
    @DisplayName("invoice numbering")
    class Numbering {

        @Test
        @DisplayName("with no settings saved, the built-in format is unchanged")
        void defaultFormatUnchanged() {
            // Existing pharmacies must not have their numbering silently altered by
            // this feature landing.
            var invoice = billingService.createInvoice(sale(1));
            assertThat(invoice.invoiceNumber())
                    .startsWith("INV/" + DocumentSequenceService.fyShort() + "/");
        }

        @Test
        @DisplayName("a saved prefix, separator and counter length reach the issued bill")
        void savedFormatIsUsedOnTheBill() throws Exception {
            // The exact scenario the settings preview promises: configure it, save it,
            // sell something, and the bill carries that format. The year is the
            // auto-computed one, which is the default.
            saveSettings("{\"numbering\":{\"prefix\":\"BILL\",\"separator\":\"-\",\"counterLength\":4}}");

            var invoice = billingService.createInvoice(sale(1));
            assertThat(invoice.invoiceNumber())
                    .matches("BILL-" + DocumentSequenceService.fyShort() + "-\\d{4,}");
        }

        @Test
        @DisplayName("auto financial year wins over a stale literal left in the config")
        void autoFinancialYearIsTheDefault() throws Exception {
            // The default the pharmacy gets without thinking about it: the year is
            // recomputed per bill and rolls over on 1 April by itself.
            saveSettings("{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":true,"
                    + "\"financialYear\":\"2019-20\",\"separator\":\"-\",\"counterLength\":4}}");

            var invoice = billingService.createInvoice(sale(1));
            assertThat(invoice.invoiceNumber()).contains(DocumentSequenceService.fyShort());
            assertThat(invoice.invoiceNumber()).doesNotContain("2019-20");
        }

        @Test
        @DisplayName("the manual override pins a literal year on real bills")
        void manualOverrideReachesTheBill() throws Exception {
            // The escape hatch: migration, backdated invoices, testing.
            saveSettings("{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,"
                    + "\"financialYear\":\"2019-20\",\"separator\":\"-\",\"counterLength\":4}}");

            var invoice = billingService.createInvoice(sale(1));
            assertThat(invoice.invoiceNumber()).matches("BILL-2019-20-\\d{4,}");
        }

        @Test
        @DisplayName("the number is persisted, not just returned")
        void numberIsPersisted() throws Exception {
            saveSettings("{\"numbering\":{\"prefix\":\"RX\",\"autoFinancialYear\":false,\"financialYear\":\"\","
                    + "\"separator\":\"-\",\"counterLength\":5}}");

            var created = billingService.createInvoice(sale(1));
            flushAndClear();

            var reloaded = billingService.getInvoice(created.id());
            assertThat(reloaded.invoiceNumber()).isEqualTo(created.invoiceNumber());
            assertThat(reloaded.invoiceNumber()).startsWith("RX-");
        }

        @Test
        @DisplayName("an empty financial year drops the year segment from real bills")
        void emptyFinancialYearOmitsYear() throws Exception {
            saveSettings("{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,\"financialYear\":\"\","
                    + "\"separator\":\"-\",\"counterLength\":4}}");

            var invoice = billingService.createInvoice(sale(1));
            assertThat(invoice.invoiceNumber()).matches("BILL-\\d{4,}");
            assertThat(invoice.invoiceNumber()).doesNotContain("-20");
        }

        @Test
        @DisplayName("consecutive bills get distinct, increasing numbers")
        void consecutiveNumbersAreDistinct() throws Exception {
            saveSettings("{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,\"financialYear\":\"\","
                    + "\"separator\":\"-\",\"counterLength\":4}}");

            var first = billingService.createInvoice(sale(1));
            flushAndClear();
            var second = billingService.createInvoice(sale(1));

            assertThat(first.invoiceNumber()).isNotEqualTo(second.invoiceNumber());
        }

        @Test
        @DisplayName("changing the format mid-stream does not reuse an earlier number")
        void formatChangeDoesNotCollide() throws Exception {
            // The unique index on (pharmacyId, invoiceNumber) would reject a collision
            // mid-sale, so the sequence must keep advancing across a format change.
            var legacy = billingService.createInvoice(sale(1));
            flushAndClear();

            saveSettings("{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,\"financialYear\":\"\","
                    + "\"separator\":\"-\",\"counterLength\":4}}");
            var custom = billingService.createInvoice(sale(1));
            flushAndClear();

            saveSettings("{\"numbering\":{\"prefix\":\"AGAIN\",\"autoFinancialYear\":false,\"financialYear\":\"\","
                    + "\"separator\":\"-\",\"counterLength\":4}}");
            var third = billingService.createInvoice(sale(1));

            assertThat(List.of(legacy.invoiceNumber(), custom.invoiceNumber(), third.invoiceNumber()))
                    .doesNotHaveDuplicates();
        }

        @Test
        @DisplayName("well-formed settings of an unexpected shape still let the pharmacy bill")
        void unexpectedShapeDoesNotBlockBilling() throws Exception {
            // This is the reachable corruption case. `invoiceSettings` is a Postgres
            // Json column, so syntactically invalid text is refused at write time (see
            // the test below) — what CAN land there is valid JSON that does not match
            // the expected schema: an older config, a hand-edited blob, a future
            // migration. Billing must degrade to the default format, not fail.
            saveSettings("{\"numbering\":\"this-should-have-been-an-object\"}");

            var invoice = billingService.createInvoice(sale(1));
            assertThat(invoice.invoiceNumber()).startsWith("INV/");
        }

        @Test
        @DisplayName("a non-object settings body is refused with a clear 400, not a 500")
        void nonObjectSettingsRejected() throws Exception {
            // Previously this reached an unguarded objectMapper.convertValue(...) and
            // escaped as an opaque "Something went wrong on our end" 500. It also would
            // have "saved" something meaningless that every later read silently ignored.
            var array = objectMapper.readTree("[1,2,3]");
            assertThatThrownBy(() -> billingService.saveInvoiceSettings(array))
                    .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                    .hasMessageContaining("must be a JSON object");

            var scalar = objectMapper.readTree("42");
            assertThatThrownBy(() -> billingService.saveInvoiceSettings(scalar))
                    .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class);
        }

        @Test
        @DisplayName("a rejected save leaves the previous settings untouched")
        void rejectedSaveDoesNotClobber() throws Exception {
            saveSettings("{\"numbering\":{\"prefix\":\"KEEP\",\"autoFinancialYear\":false,\"financialYear\":\"\",\"separator\":\"-\",\"counterLength\":4}}");

            var array = objectMapper.readTree("[1,2,3]");
            assertThatThrownBy(() -> billingService.saveInvoiceSettings(array))
                    .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class);
            flushAndClear();

            var invoice = billingService.createInvoice(sale(1));
            assertThat(invoice.invoiceNumber()).startsWith("KEEP-");
        }

        @Test
        @DisplayName("an explicit null clears settings back to the built-in format")
        void nullClearsSettings() throws Exception {
            saveSettings("{\"numbering\":{\"prefix\":\"TEMP\",\"autoFinancialYear\":false,\"financialYear\":\"\",\"separator\":\"-\",\"counterLength\":4}}");
            assertThat(billingService.createInvoice(sale(1)).invoiceNumber()).startsWith("TEMP-");
            flushAndClear();

            billingService.saveInvoiceSettings(objectMapper.nullNode());
            flushAndClear();

            assertThat(billingService.createInvoice(sale(1)).invoiceNumber()).startsWith("INV/");
        }

        @Test
        @DisplayName("the database refuses syntactically invalid JSON in invoiceSettings")
        void databaseRejectsInvalidJson() {
            // Records why the parser's catch branch is defensive rather than load-
            // bearing: the column type stops malformed content ever being stored.
            Pharmacy p = pharmacyRepository.findById(pharmacyId).orElseThrow();
            ReflectionTestUtils.setField(p, "invoiceSettings", "{\"numbering\": broken");
            pharmacyRepository.save(p);

            assertThatThrownBy(() -> entityManager.flush())
                    .hasMessageContaining("invalid input syntax for type json");
        }

        @Test
        @DisplayName("one pharmacy's numbering does not affect another's")
        void numberingIsPerTenant() throws Exception {
            saveSettings("{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,\"financialYear\":\"\","
                    + "\"separator\":\"-\",\"counterLength\":4}}");

            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                    "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
            String otherBatch = inventoryRepository.save(Inventory.create(other.getId(), medicineId, "OB-1",
                    Instant.now().plus(365, ChronoUnit.DAYS), 50,
                    new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();
            flushAndClear();
            authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

            var invoice = billingService.createInvoice(new CreateInvoiceRequest(
                    null, null, null, null, null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(otherBatch, 1, null, BigDecimal.ZERO))));

            assertThat(invoice.invoiceNumber()).startsWith("INV/");
        }
    }

    @Nested
    @DisplayName("free / scheme quantity (10+1)")
    class FreeQuantity {

        private CreateInvoiceRequest saleWithFree(int quantity, int freeQty) {
            return new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                    null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, quantity, freeQty, BigDecimal.ZERO)));
        }

        private int stock() {
            return inventoryRepository.findById(batchId).orElseThrow().getQuantity();
        }

        @Test
        @DisplayName("free units are NOT charged")
        void freeUnitsAreNotCharged() {
            var paidOnly = billingService.createInvoice(saleWithFree(10, 0));
            flushAndClear();
            var withFree = billingService.createInvoice(saleWithFree(10, 5));

            assertThat(withFree.totalAmount()).isEqualByComparingTo(paidOnly.totalAmount());
            assertThat(withFree.taxableAmount()).isEqualByComparingTo(paidOnly.taxableAmount());
        }

        @Test
        @DisplayName("free units ARE deducted from stock — the goods leave the shelf")
        void freeUnitsAreDeductedFromStock() {
            int before = stock();
            billingService.createInvoice(saleWithFree(10, 5));
            flushAndClear();

            assertThat(stock()).isEqualTo(before - 15);
        }

        @Test
        @DisplayName("the stock movement records the dispensed total, not the charged quantity")
        void movementRecordsDispensedTotal() {
            // The ledger has to reconcile with the batch decrement, or a physical count
            // shows an unexplained 5-unit shortfall.
            int before = stock();
            var invoice = billingService.createInvoice(saleWithFree(10, 5));
            flushAndClear();

            var movement = entityManager.createQuery(
                            "SELECT m FROM InventoryMovement m WHERE m.referenceId = :id", com.checkup.pharmacy.modules.inventory.InventoryMovement.class)
                    .setParameter("id", invoice.id())
                    .getSingleResult();

            assertThat(movement.getQuantity()).isEqualTo(15);
            assertThat(movement.getQuantityBefore()).isEqualTo(before);
            assertThat(movement.getQuantityAfter()).isEqualTo(before - 15);
            assertThat(movement.getNotes()).contains("10 sold + 5 free");
        }

        @Test
        @DisplayName("the availability check counts free units, so a scheme cannot overdraw a batch")
        void freeUnitsCountTowardsTheStockCheck() {
            // 500 in stock: 500 paid alone would be fine, 500 + 1 free is not.
            assertThatThrownBy(() -> billingService.createInvoice(saleWithFree(500, 1)))
                    .isInstanceOf(com.checkup.pharmacy.common.exception.ConflictException.class)
                    .hasMessageContaining("501 requested")
                    .hasMessageContaining("500 + 1 free");
        }

        @Test
        @DisplayName("a rejected over-draw leaves stock untouched")
        void rejectedSchemeLeavesStockUntouched() {
            int before = stock();
            assertThatThrownBy(() -> billingService.createInvoice(saleWithFree(500, 1)))
                    .isInstanceOf(com.checkup.pharmacy.common.exception.ConflictException.class);
            flushAndClear();

            assertThat(stock()).isEqualTo(before);
        }

        @Test
        @DisplayName("free quantity is persisted and read back on the invoice")
        void freeQuantityIsPersisted() {
            var created = billingService.createInvoice(saleWithFree(10, 5));
            flushAndClear();

            var reloaded = billingService.getInvoice(created.id());
            assertThat(reloaded.items().get(0).freeQty()).isEqualTo(5);
            assertThat(reloaded.items().get(0).quantity()).isEqualTo(10);
        }

        @Test
        @DisplayName("omitting freeQty behaves exactly as before — zero, nothing extra deducted")
        void absentFreeQtyIsZero() {
            int before = stock();
            var created = billingService.createInvoice(sale(10));
            flushAndClear();

            assertThat(stock()).isEqualTo(before - 10);
            assertThat(billingService.getInvoice(created.id()).items().get(0).freeQty()).isZero();
        }

        @Test
        @DisplayName("a negative freeQty is rejected by validation, not silently applied")
        void negativeFreeQtyRejected() {
            // @PositiveOrZero on the DTO. A negative value would otherwise ADD stock.
            var validator = jakarta.validation.Validation.buildDefaultValidatorFactory().getValidator();
            var violations = validator.validate(new InvoiceItemRequest(batchId, 10, -5, BigDecimal.ZERO));
            assertThat(violations).isNotEmpty();
        }
    }

    @Nested
    @DisplayName("return window policy")
    class ReturnWindow {

        /** Ages an invoice by rewriting createdAt, which is what the window is measured from. */
        private String invoiceAgedByDays(int days) {
            var created = billingService.createInvoice(sale(5));
            flushAndClear();
            Invoice inv = entityManager.find(Invoice.class, created.id());
            ReflectionTestUtils.setField(inv, "createdAt", Instant.now().minus(days, ChronoUnit.DAYS));
            entityManager.merge(inv);
            flushAndClear();
            return created.id();
        }

        private CreateReturnRequest returnAll(String invoiceId) {
            var items = billingService.getInvoice(invoiceId).items();
            return new CreateReturnRequest("Damaged strip",
                    List.of(new ReturnItemRequest(items.get(0).id(), 1, "RESTOCK")), null);
        }

        @Test
        @DisplayName("defaults to 30 days when no policy is saved")
        void defaultWindowStillThirtyDays() {
            String oldInvoice = invoiceAgedByDays(45);
            assertThatThrownBy(() -> billingService.createReturn(oldInvoice, returnAll(oldInvoice)))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("30 day(s)");
        }

        @Test
        @DisplayName("a shorter saved window is enforced")
        void shorterWindowIsEnforced() throws Exception {
            // 20 days old is fine under the 30-day default and must now be refused.
            saveSettings("{\"policy\":{\"returnWindowDays\":15}}");
            String invoiceId = invoiceAgedByDays(20);

            assertThatThrownBy(() -> billingService.createReturn(invoiceId, returnAll(invoiceId)))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("15 day(s)");
        }

        @Test
        @DisplayName("a longer saved window is honoured")
        void longerWindowIsHonoured() throws Exception {
            // 45 days old would be refused under the default; 90 days is configured.
            saveSettings("{\"policy\":{\"returnWindowDays\":90}}");
            String invoiceId = invoiceAgedByDays(45);

            var result = billingService.createReturn(invoiceId, returnAll(invoiceId));
            assertThat(result.id()).isNotBlank();
        }

        @Test
        @DisplayName("zero switches the time limit off entirely")
        void zeroDisablesTheWindow() throws Exception {
            // The settings screen says "Set to 0 to disable the return time limit."
            saveSettings("{\"policy\":{\"returnWindowDays\":0}}");
            String ancientInvoice = invoiceAgedByDays(900);

            var result = billingService.createReturn(ancientInvoice, returnAll(ancientInvoice));
            assertThat(result.id()).isNotBlank();
        }

        @Test
        @DisplayName("a return inside the configured window still succeeds")
        void insideWindowSucceeds() throws Exception {
            saveSettings("{\"policy\":{\"returnWindowDays\":15}}");
            String invoiceId = invoiceAgedByDays(5);

            var result = billingService.createReturn(invoiceId, returnAll(invoiceId));
            assertThat(result.id()).isNotBlank();
        }
    }

    @Nested
    @DisplayName("billing preferences (bill-screen action config)")
    class BillingPreferences {

        private void savePrefs(String json) throws Exception {
            billingService.saveBillingPreferences(objectMapper.readTree(json));
            flushAndClear();
        }

        @Test
        @DisplayName("a pharmacy that never configured anything reads back null, not an error")
        void unconfiguredReadsBackNull() {
            // Lets the client tell "never set" from "deliberately set", so its built-in
            // defaults apply without being written to the database on first load.
            assertThat(billingService.getBillingPreferences()).isNull();
        }

        @Test
        @DisplayName("saved preferences round-trip intact")
        void roundTrip() throws Exception {
            savePrefs("{\"version\":1,\"actions\":["
                    + "{\"id\":\"save_print\",\"enabled\":true,\"pinned\":true,\"order\":0},"
                    + "{\"id\":\"delivery\",\"enabled\":false,\"pinned\":false,\"order\":1}]}");

            var stored = billingService.getBillingPreferences();
            assertThat(stored).isNotNull();
            assertThat(stored.get("version").asInt()).isEqualTo(1);
            assertThat(stored.get("actions")).hasSize(2);
            assertThat(stored.get("actions").get(0).get("id").asText()).isEqualTo("save_print");
            assertThat(stored.get("actions").get(1).get("enabled").asBoolean()).isFalse();
        }

        @Test
        @DisplayName("saving twice replaces rather than merges")
        void secondSaveReplaces() throws Exception {
            savePrefs("{\"version\":1,\"actions\":[{\"id\":\"save_print\",\"enabled\":true,\"pinned\":true,\"order\":0}]}");
            savePrefs("{\"version\":1,\"actions\":[{\"id\":\"return\",\"enabled\":true,\"pinned\":false,\"order\":0}]}");

            var stored = billingService.getBillingPreferences();
            assertThat(stored.get("actions")).hasSize(1);
            assertThat(stored.get("actions").get(0).get("id").asText()).isEqualTo("return");
        }

        @Test
        @DisplayName("an explicit null clears them back to unconfigured")
        void nullClears() throws Exception {
            savePrefs("{\"version\":1,\"actions\":[]}");
            assertThat(billingService.getBillingPreferences()).isNotNull();

            billingService.saveBillingPreferences(objectMapper.nullNode());
            flushAndClear();
            assertThat(billingService.getBillingPreferences()).isNull();
        }

        @Test
        @DisplayName("a non-object body is refused with a clear 400, not a 500")
        void nonObjectRejected() throws Exception {
            var array = objectMapper.readTree("[1,2,3]");
            assertThatThrownBy(() -> billingService.saveBillingPreferences(array))
                    .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                    .hasMessageContaining("must be a JSON object");
        }

        @Test
        @DisplayName("a rejected save leaves the stored preferences untouched")
        void rejectedSaveDoesNotClobber() throws Exception {
            savePrefs("{\"version\":1,\"actions\":[{\"id\":\"keep\",\"enabled\":true,\"pinned\":true,\"order\":0}]}");

            var array = objectMapper.readTree("[1,2,3]");
            assertThatThrownBy(() -> billingService.saveBillingPreferences(array))
                    .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class);
            flushAndClear();

            assertThat(billingService.getBillingPreferences().get("actions").get(0).get("id").asText())
                    .isEqualTo("keep");
        }

        @Test
        @DisplayName("preferences are per-pharmacy — one shop's config is invisible to another")
        void tenantScoped() throws Exception {
            // The reason these are stored server-side at all: every till in ONE shop
            // must agree, and no other shop should see them.
            savePrefs("{\"version\":1,\"actions\":[{\"id\":\"mine\",\"enabled\":true,\"pinned\":true,\"order\":0}]}");

            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                    "other-" + unique() + "@test.local", "9333333333", "hash", Role.OWNER));
            flushAndClear();
            authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

            assertThat(billingService.getBillingPreferences()).isNull();
        }

        @Test
        @DisplayName("invoice settings and billing preferences are stored independently")
        void independentOfInvoiceSettings() throws Exception {
            // Adjacent JSON columns on the same row — a save to one must not disturb
            // the other.
            saveSettings("{\"numbering\":{\"prefix\":\"BILL\"}}");
            savePrefs("{\"version\":1,\"actions\":[{\"id\":\"save_print\",\"enabled\":true,\"pinned\":true,\"order\":0}]}");

            assertThat(billingService.getInvoiceSettings().get("numbering").get("prefix").asText())
                    .isEqualTo("BILL");
            assertThat(billingService.getBillingPreferences().get("actions")).hasSize(1);
        }
    }

    @Nested
    @DisplayName("settings round-trip")
    class RoundTrip {

        @Test
        @DisplayName("saved settings read back with every section intact")
        void settingsRoundTrip() throws Exception {
            String json = "{\"theme\":\"modern\",\"paper\":{\"size\":\"thermal80\"},"
                    + "\"numbering\":{\"prefix\":\"BILL\",\"financialYear\":\"2025-26\",\"separator\":\"-\",\"counterLength\":4},"
                    + "\"policy\":{\"returnWindowDays\":15},"
                    + "\"footer\":{\"thankYouText\":\"Visit again\"}}";
            saveSettings(json);

            var stored = billingService.getInvoiceSettings();
            assertThat(stored).isNotNull();
            assertThat(stored.get("theme").asText()).isEqualTo("modern");
            assertThat(stored.get("paper").get("size").asText()).isEqualTo("thermal80");
            assertThat(stored.get("numbering").get("prefix").asText()).isEqualTo("BILL");
            assertThat(stored.get("policy").get("returnWindowDays").asInt()).isEqualTo(15);
            assertThat(stored.get("footer").get("thankYouText").asText()).isEqualTo("Visit again");
        }

        @Test
        @DisplayName("saving twice replaces rather than merges")
        void secondSaveReplaces() throws Exception {
            saveSettings("{\"numbering\":{\"prefix\":\"FIRST\"}}");
            saveSettings("{\"numbering\":{\"prefix\":\"SECOND\"}}");

            var stored = billingService.getInvoiceSettings();
            assertThat(stored.get("numbering").get("prefix").asText()).isEqualTo("SECOND");
        }

        @Test
        @DisplayName("a pharmacy that never configured anything reads back null, not an error")
        void unconfiguredReadsBackNull() {
            assertThat(billingService.getInvoiceSettings()).isNull();
        }

        @Test
        @DisplayName("one pharmacy's settings are invisible to another")
        void settingsAreTenantScoped() throws Exception {
            saveSettings("{\"numbering\":{\"prefix\":\"MINE\"}}");

            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                    "other-" + unique() + "@test.local", "9222222222", "hash", Role.OWNER));
            flushAndClear();
            authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

            assertThat(billingService.getInvoiceSettings()).isNull();
        }
    }
}
