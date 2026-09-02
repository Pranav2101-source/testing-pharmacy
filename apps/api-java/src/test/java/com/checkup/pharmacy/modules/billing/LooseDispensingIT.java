package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
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
 * Loose ("cut strip") dispensing, end to end against a real Postgres.
 *
 * <p>The catalogue medicine here has {@code unitsPerPack = 10} and the pharmacy has
 * switched loose selling on for it. A strip of 10 at MRP 20 means a per-piece MRP of
 * exactly 2.00, which keeps the money assertions readable while still exercising the
 * per-piece GST path.
 */
@Transactional
class LooseDispensingIT extends AbstractPostgresIT {

    @Autowired private BillingService billingService;
    @Autowired private com.checkup.pharmacy.modules.inventory.InventoryService inventoryService;
    @Autowired private com.checkup.pharmacy.modules.medicine.MedicineService medicineService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private com.checkup.pharmacy.modules.inventory.InventoryMovementRepository movementRepository;
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private com.checkup.pharmacy.modules.customer.CustomerRepository customerRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String medicineId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));

        Medicine medicine = Medicine.create("Paracetamol 500", new BigDecimal("12"));
        medicine.setPackaging(10, "TABLET");
        medicineRepository.save(medicine);

        pharmacyId = pharmacy.getId();
        medicineId = medicine.getId();
        // 10 packs @ MRP 20.00 => 100 pieces, per-piece MRP 2.00
        batchId = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-1", future(),
                10, new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();

        entityManager.flush();
        entityManager.clear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private void allowLoose() {
        PharmacyMedicineOverride o = PharmacyMedicineOverride.create(pharmacyId, medicineId);
        o.setAllowLooseSale(true);
        overrideRepository.save(o);
        entityManager.flush();
        entityManager.clear();
    }

    private Inventory batch() {
        return inventoryRepository.findById(batchId).orElseThrow();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private static Instant future() {
        return Instant.now().plus(365, ChronoUnit.DAYS);
    }

    private CreateInvoiceRequest looseBill(int pieces) {
        return new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, pieces, null, BigDecimal.ZERO, null, "LOOSE")));
    }

    @Test
    @DisplayName("selling 8 loose tablets breaks one pack and keeps the remainder")
    void sellsLooseAndBreaksOnePack() {
        allowLoose();

        InvoiceResponse invoice = billingService.createInvoice(looseBill(8));
        entityManager.flush();
        entityManager.clear();

        Inventory b = batch();
        assertThat(b.getQuantity()).as("one pack broken open").isEqualTo(9);
        assertThat(b.getLooseUnits()).as("10 - 8 pieces left loose").isEqualTo(2);

        assertThat(invoice.items()).hasSize(1);
        var line = invoice.items().get(0);
        assertThat(line.saleUnit()).isEqualTo("LOOSE");
        assertThat(line.quantity()).isEqualTo(8);
        // The stored line keeps the printed PACK MRP (20.00) — a reprint shows the real
        // strip MRP — and `rate` is the per-piece price the customer was charged (2.00).
        assertThat(line.mrp()).as("pack MRP on the line").isEqualByComparingTo("20.00");
        assertThat(line.rate()).as("per-piece rate charged").isEqualByComparingTo("2.00");
        // 8 x 2.00 = 16.00; the stored tax reconciles to it (a paisa over: CGST and SGST
        // must each round to 2dp and stay equal — see GstCalculator's own tests).
        assertThat(line.rate().multiply(new BigDecimal(line.quantity())))
                .as("qty x rate reconciles with the line amount on the bill")
                .isCloseTo(line.amount(), org.assertj.core.data.Offset.offset(new BigDecimal("0.01")));
        assertThat(line.taxableAmount().add(line.cgst()).add(line.sgst()).add(line.igst()))
                .isCloseTo(new BigDecimal("16.00"), org.assertj.core.data.Offset.offset(new BigDecimal("0.01")));
    }

    @Test
    @DisplayName("the stock movement is recorded in pieces so a physical count still reconciles")
    void movementIsInPieces() {
        allowLoose();
        billingService.createInvoice(looseBill(8));
        entityManager.flush();

        Object[] row = (Object[]) entityManager.createQuery(
                        "SELECT m.quantity, m.quantityBefore, m.quantityAfter, m.baseUnit FROM InventoryMovement m "
                        + "WHERE m.inventoryId = :id AND m.referenceType = 'INVOICE'")
                .setParameter("id", batchId)
                .getSingleResult();
        assertThat(row[0]).as("pieces dispensed").isEqualTo(8);
        assertThat(row[1]).as("100 pieces before").isEqualTo(100);
        assertThat(row[2]).as("92 pieces after").isEqualTo(92);
        assertThat(row[3]).as("row is tagged as counted in tablets, not packs").isEqualTo("TABLET");
    }

    @Test
    @DisplayName("a pack sale leaves baseUnit null; sales velocity folds a loose sale to a pack fraction")
    void packMovementHasNoBaseUnitAndVelocityIsCoherent() {
        allowLoose();
        // One whole-pack sale (baseUnit stays null) + one 8-tablet loose sale (0.8 of a pack).
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 1, null, BigDecimal.ZERO, null, "PACK"))));
        entityManager.flush();
        entityManager.clear();
        billingService.createInvoice(looseBill(8));
        entityManager.flush();
        entityManager.clear();

        String packBaseUnit = (String) entityManager.createQuery(
                        "SELECT m.baseUnit FROM InventoryMovement m WHERE m.inventoryId = :id "
                        + "AND m.referenceType = 'INVOICE' AND m.quantity = 1")
                .setParameter("id", batchId).getSingleResult();
        assertThat(packBaseUnit).as("a pack row stays pack-scale").isNull();

        // 1 pack + (8 / 10) pack = 1.8 pack-equivalent, NOT 1 + 8 = 9.
        double totalPacks = movementRepository.aggregateSalesByMedicine(
                        pharmacyId, Instant.now().minus(1, ChronoUnit.DAYS), Instant.now().plus(1, ChronoUnit.DAYS))
                .stream().filter(r -> medicineId.equals(r.getMedicineId())).findFirst().orElseThrow()
                .getTotalQuantity();
        assertThat(totalPacks).isCloseTo(1.8, org.assertj.core.data.Offset.offset(0.001));
    }

    @Test
    @DisplayName("a second loose sale draws from the open pack before breaking another")
    void drawsFromLooseRemainderFirst() {
        allowLoose();
        billingService.createInvoice(looseBill(8));   // -> 9 packs, 2 loose
        entityManager.flush();
        entityManager.clear();

        billingService.createInvoice(looseBill(1));   // 1 from the 2 loose, no new break
        entityManager.flush();
        entityManager.clear();

        Inventory b = batch();
        assertThat(b.getQuantity()).isEqualTo(9);
        assertThat(b.getLooseUnits()).isEqualTo(1);
    }

    @Test
    @DisplayName("loose sale is refused when the pharmacy has not enabled it for this medicine")
    void refusedWhenNotEnabled() {
        assertThatThrownBy(() -> billingService.createInvoice(looseBill(5)))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("Loose selling is not enabled");
    }

    @Test
    @DisplayName("loose sale is refused when the catalogue medicine has no pack size")
    void refusedWhenNoUnitsPerPack() {
        Medicine m = medicineRepository.findById(medicineId).orElseThrow();
        m.setPackaging(null, "TABLET");
        medicineRepository.save(m);
        allowLoose();

        assertThatThrownBy(() -> billingService.createInvoice(looseBill(5)))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("cannot be sold loose");
    }

    @Test
    @DisplayName("cannot dispense more loose pieces than the batch holds")
    void cannotOverdrawPieces() {
        allowLoose();
        assertThatThrownBy(() -> billingService.createInvoice(looseBill(101)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("piece(s) available");
    }

    @Test
    @DisplayName("a pack line and a loose line on one bill both post, and the header equals the sum of lines")
    void mixedPackAndLooseBill() {
        allowLoose();
        String batch2 = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-2", future(),
                5, new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();
        entityManager.flush();
        entityManager.clear();

        CreateInvoiceRequest mixed = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 8, null, BigDecimal.ZERO, null, "LOOSE"),
                        new InvoiceItemRequest(batch2, 2, null, BigDecimal.ZERO, null, "PACK")));

        InvoiceResponse invoice = billingService.createInvoice(mixed);
        entityManager.flush();
        entityManager.clear();

        assertThat(invoice.items()).hasSize(2);
        BigDecimal lineSum = invoice.items().stream()
                .map(i -> i.taxableAmount().add(i.cgst()).add(i.sgst()).add(i.igst()))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        // 8 loose @ 2.00 (~16.00) + 2 packs @ 20.00 (~40.00) ≈ 56.00, within per-line paisa rounding
        assertThat(lineSum).isCloseTo(new BigDecimal("56.00"), org.assertj.core.data.Offset.offset(new BigDecimal("0.02")));

        assertThat(inventoryRepository.findById(batchId).orElseThrow().getLooseUnits()).isEqualTo(2);
        assertThat(inventoryRepository.findById(batch2).orElseThrow().getQuantity()).isEqualTo(3);
    }

    @Test
    @DisplayName("cancelling a loose sale puts the pieces back LOOSE, not as a sealed pack")
    void cancellingReturnsPiecesLoose() {
        allowLoose();
        InvoiceResponse invoice = billingService.createInvoice(looseBill(8));  // -> 9 packs, 2 loose
        entityManager.flush();
        entityManager.clear();

        billingService.cancelInvoice(invoice.id(), "wrong customer");
        entityManager.flush();
        entityManager.clear();

        Inventory b = batch();
        assertThat(b.getQuantity()).as("the broken pack is not magically re-sealed").isEqualTo(9);
        assertThat(b.getLooseUnits()).as("2 remainder + 8 returned = 10 loose").isEqualTo(10);
        assertThat(b.availablePieces(10)).as("total pieces back to 100").isEqualTo(100L);
    }

    @Test
    @DisplayName("a loose line can be refunded, but the cut tablets are never put back in stock")
    void looseLineRefundsWithoutRestock() {
        allowLoose();
        InvoiceResponse invoice = billingService.createInvoice(looseBill(8));   // -> 9 packs, 2 loose
        entityManager.flush();
        entityManager.clear();

        String lineId = invoice.items().get(0).id();
        // Ask for RESTOCK — the server must force WRITEOFF for a loose line anyway.
        var returnReq = new com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest("changed mind",
                List.of(new com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest(lineId, 4, "RESTOCK")), null);

        var ret = billingService.createReturn(invoice.id(), returnReq);
        entityManager.flush();
        entityManager.clear();

        assertThat(ret.totalAmount()).as("the customer is refunded for 4 tablets").isGreaterThan(BigDecimal.ZERO);
        Inventory b = batch();
        assertThat(b.getQuantity()).as("no pack put back").isEqualTo(9);
        assertThat(b.getLooseUnits()).as("the 2 loose remainder is unchanged — cut tablets don't return").isEqualTo(2);
    }

    @Test
    @DisplayName("an expired batch that is nothing but a cut-strip remainder can still be written off")
    void expiredLooseOnlyRemainderIsWrittenOff() {
        // A strip was cut for loose sales down to a 6-tablet remainder, then the batch
        // expired. quantity is 0, so the write-off loop used to skip it silently — it
        // stayed on the expiry report and the 3B exposure forever, ITC never reversed.
        String expired = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "OLD-LOOSE",
                Instant.now().minus(20, ChronoUnit.DAYS), 0, new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();
        Inventory e = inventoryRepository.findById(expired).orElseThrow();
        e.setLooseUnits(6);
        inventoryRepository.save(e);
        entityManager.flush();
        entityManager.clear();

        var result = inventoryService.writeOffExpired(
                new com.checkup.pharmacy.modules.inventory.dto.WriteOffExpiredRequest(
                        List.of(expired), "expired cut strip"));
        entityManager.flush();
        entityManager.clear();

        assertThat(result.batchesWrittenOff()).as("the batch is no longer silently skipped").isEqualTo(1);
        // 6 tablets at a per-piece purchase rate of 10.00 / 10 = 1.00 => Rs.6.00 of cost,
        // and 12% of that as blocked ITC.
        assertThat(result.costWrittenOff()).isEqualByComparingTo(new BigDecimal("6.00"));
        assertThat(result.itcToReverse()).isEqualByComparingTo(new BigDecimal("0.72"));

        Inventory after = inventoryRepository.findById(expired).orElseThrow();
        assertThat(after.getLooseUnits()).as("the remainder is cleared").isZero();
        Long moves = entityManager.createQuery(
                        "SELECT COUNT(m) FROM InventoryMovement m WHERE m.inventoryId = :id "
                        + "AND CAST(m.type AS string) = 'EXPIRY_REMOVAL' AND m.baseUnit = 'TABLET'", Long.class)
                .setParameter("id", expired).getSingleResult();
        assertThat(moves).as("a piece-denominated ledger row explains the loss").isEqualTo(1L);
    }

    @Test
    @DisplayName("reserving loose pieces holds whole packs so billing and reservedQuantity stay in one unit")
    void looseReservationRoundsUpToPacks() {
        allowLoose();
        var reserve = new com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest("sess-1",
                List.of(new com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest.Item(batchId, 12, "LOOSE")));
        inventoryService.reserve(reserve);
        entityManager.flush();
        entityManager.clear();

        // 12 pieces of a 10-pack -> 2 packs held
        assertThat(batch().getReservedQuantity()).isEqualTo(2);
    }

    // ── Indian-market guards ──────────────────────────────────────────────────

    @Test
    @DisplayName("a Schedule X medicine cannot be sold loose")
    void scheduleXCannotBeSoldLoose() {
        Medicine m = medicineRepository.findById(medicineId).orElseThrow();
        m.applyFields(null, null, null, null, "X", null, new BigDecimal("12"), "tablet", null, "strip", "10 tablets");
        m.setPackaging(10, "TABLET");
        medicineRepository.save(m);
        allowLoose();

        assertThatThrownBy(() -> billingService.createInvoice(looseBill(5)))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("Schedule X");
    }

    @Test
    @DisplayName("asking for whole packs' worth as loose is refused — bill it as packs so strips stay sealed")
    void wholePackAsLooseIsRefused() {
        allowLoose();
        assertThatThrownBy(() -> billingService.createInvoice(looseBill(20)))   // 2 full packs
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("full pack");

        // ...but a partial-over-pack amount (a real 1.5-strip course) is fine
        billingService.createInvoice(looseBill(15));
        entityManager.flush();
        entityManager.clear();
        assertThat(batch().getQuantity()).isEqualTo(8);   // broke 2 strips
        assertThat(batch().getLooseUnits()).isEqualTo(5);
    }

    @Test
    @DisplayName("forceLoose lets the cashier deliberately cut a sealed strip past the whole-pack guard")
    void forceLooseWaivesTheWholePackGuard() {
        allowLoose();
        // 10 tablets = exactly 1 sealed strip, and there are 10 sealed strips — normally
        // 422'd. With forceLoose the cashier has said "cut it anyway" (torn foil, etc.).
        var bill = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 10, null, BigDecimal.ZERO, null, "LOOSE", true)));
        billingService.createInvoice(bill);
        entityManager.flush();
        entityManager.clear();

        Inventory b = batch();
        assertThat(b.getQuantity()).as("one sealed strip cut open").isEqualTo(9);
        assertThat(b.getLooseUnits()).as("all 10 dispensed, none left").isZero();
    }

    @Test
    @DisplayName("a whole-pack amount IS allowed as loose when there aren't enough sealed packs to sell instead")
    void wholePackAsLooseAllowedWhenSealedStockFallsShort() {
        allowLoose();
        // Batch down to 1 sealed pack + 12 loose = 22 pieces. Billing 20 (2 packs'
        // worth) as loose used to 422 "sell it as 2 packs" — but only 1 sealed pack
        // exists, so that advice is a dead end and cutting is the only way to fill it.
        Inventory inv = batch();
        inv.setQuantity(1);
        inv.setLooseUnits(12);
        inventoryRepository.save(inv);
        entityManager.flush();
        entityManager.clear();

        billingService.createInvoice(looseBill(20));
        entityManager.flush();
        entityManager.clear();

        Inventory b = batch();
        assertThat(b.getQuantity()).as("the last sealed pack was cut").isEqualTo(0);
        assertThat(b.getLooseUnits()).as("12 loose + 8 from the cut strip = 20 dispensed, 2 left").isEqualTo(2);
    }

    @Test
    @DisplayName("a loose reservation holds packs by the pharmacy's OWN pack size, not just the catalogue's")
    void looseReservationUsesEffectivePackSize() {
        // Catalogue does not classify the pack; the pharmacy sets it to 10 via its override.
        Medicine m = medicineRepository.findById(medicineId).orElseThrow();
        m.setPackaging(null, "TABLET");
        medicineRepository.save(m);
        PharmacyMedicineOverride o = PharmacyMedicineOverride.create(pharmacyId, medicineId);
        o.applyLoosePos(true, 10);
        overrideRepository.save(o);
        entityManager.flush();
        entityManager.clear();

        var reserve = new com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest("sess-upp",
                List.of(new com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest.Item(batchId, 6, "LOOSE")));
        inventoryService.reserve(reserve);
        entityManager.flush();
        entityManager.clear();

        // 6 pieces / 10-per-pack -> ceil = 1 pack held. Reading the catalogue's (absent)
        // pack size instead would fall back to u = 1 and try to hold 6 whole packs.
        assertThat(batch().getReservedQuantity()).isEqualTo(1);
    }

    @Test
    @DisplayName("a pharmacy pack-size override is used when the catalogue has none")
    void perPharmacyUnitsPerPackOverride() {
        Medicine m = medicineRepository.findById(medicineId).orElseThrow();
        m.setPackaging(null, "TABLET");   // catalogue doesn't know the pack size
        medicineRepository.save(m);
        PharmacyMedicineOverride o = PharmacyMedicineOverride.create(pharmacyId, medicineId);
        o.applyLoosePos(true, 10);        // this pharmacy sets it
        overrideRepository.save(o);
        entityManager.flush();
        entityManager.clear();

        billingService.createInvoice(looseBill(8));
        entityManager.flush();
        entityManager.clear();
        assertThat(batch().getQuantity()).isEqualTo(9);
        assertThat(batch().getLooseUnits()).isEqualTo(2);
    }

    @Test
    @DisplayName("the /inventory batch response exposes looseUnits and the loose opt-in")
    void inventoryResponseCarriesLooseFields() {
        allowLoose();
        billingService.createInvoice(looseBill(8));
        entityManager.flush();
        entityManager.clear();

        var page = inventoryService.list(null, medicineId, false, false, false, null, false, 1, 20);
        var row = page.items().stream().filter(i -> i.id().equals(batchId)).findFirst().orElseThrow();
        assertThat(row.looseUnits()).isEqualTo(2);
        assertThat(row.medicine().allowLooseSale()).isTrue();
        assertThat(row.medicine().unitsPerPack()).isEqualTo(10);
    }

    // ── Turning loose selling on (the POS settings action) ────────────────────

    @Test
    @DisplayName("enabling loose selling records the opt-in and reports the effective pack size")
    void enableLooseSelling() {
        var resp = medicineService.setLoosePosSettings(medicineId,
                new com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest(true, null));
        assertThat(resp.allowLooseSale()).isTrue();
        assertThat(resp.effectiveUnitsPerPack()).isEqualTo(10);   // from the catalogue
    }

    @Test
    @DisplayName("enabling loose selling is refused when no pack size is known anywhere")
    void enableLooseRefusedWithoutPackSize() {
        Medicine m = medicineRepository.findById(medicineId).orElseThrow();
        m.setPackaging(null, "TABLET");
        medicineRepository.save(m);
        entityManager.flush();
        entityManager.clear();

        assertThatThrownBy(() -> medicineService.setLoosePosSettings(medicineId,
                new com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest(true, null)))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("no pack size");
    }

    @Test
    @DisplayName("enabling loose with a pharmacy-supplied pack size is accepted only when it is confirmed")
    void enableLooseWithOwnPackSize() {
        Medicine m = medicineRepository.findById(medicineId).orElseThrow();
        m.setPackaging(null, "TABLET");   // catalogue has no pack size
        medicineRepository.save(m);
        entityManager.flush();
        entityManager.clear();

        // A caller-supplied pack size with no confirmation is refused — a wrong number
        // would silently misprice every loose sale.
        assertThatThrownBy(() -> medicineService.setLoosePosSettings(medicineId,
                new com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest(true, 15, null, null)))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("against a real strip");

        var resp = medicineService.setLoosePosSettings(medicineId,
                new com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest(true, 15, null, true));
        assertThat(resp.allowLooseSale()).isTrue();
        assertThat(resp.unitsPerPack()).isEqualTo(15);
        assertThat(resp.effectiveUnitsPerPack()).isEqualTo(15);
        assertThat(resp.looseConfirmedAt()).isNotNull();
    }

    // ── Batch B: repeat-bill, reservations, re-print ─────────────────────────

    @Test
    @DisplayName("the invoice line snapshots the base unit for the re-printed bill")
    void invoiceLineCarriesBaseUnit() {
        Medicine m = medicineRepository.findById(medicineId).orElseThrow();
        m.applyFields(null, null, null, null, null, null, new BigDecimal("12"), "Tablet", null, "strip", "10 tablets");
        medicineRepository.save(m);
        allowLoose();

        var invoice = billingService.createInvoice(looseBill(8));
        entityManager.flush();
        entityManager.clear();

        var fresh = billingService.getInvoice(invoice.id());
        assertThat(fresh.items().get(0).saleUnit()).isEqualTo("LOOSE");
        assertThat(fresh.items().get(0).baseUnit()).isEqualTo("TABLET");
    }

    @Test
    @DisplayName("reserving a few loose pieces against an already-open strip holds no packs from other tills")
    void looseReservationHoldsNothingWhenRemainderCovers() {
        allowLoose();
        billingService.createInvoice(looseBill(8));   // -> 9 packs, 2 loose
        entityManager.flush();
        entityManager.clear();

        // Cart wants 2 loose; the batch has 2 open — nothing sealed is cut, so nothing is held.
        var reserve = new com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest("sess-x",
                List.of(new com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest.Item(batchId, 2, "LOOSE")));
        inventoryService.reserve(reserve);
        entityManager.flush();
        entityManager.clear();
        assertThat(batch().getReservedQuantity()).isEqualTo(0);
    }

    @Test
    @DisplayName("a customer's regular loose order comes back as a loose line on repeat-bill")
    void repeatBillCarriesLoose() {
        allowLoose();
        String customerId = customerRepository.save(
                com.checkup.pharmacy.modules.customer.Customer.create(pharmacyId, "Chronic Patient")).getId();
        entityManager.flush();
        entityManager.clear();

        CreateInvoiceRequest bill = new CreateInvoiceRequest(customerId, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 8, null, BigDecimal.ZERO, null, "LOOSE")));
        billingService.createInvoice(bill);
        entityManager.flush();
        entityManager.clear();

        var repeat = billingService.getRepeatCart(customerId);
        assertThat(repeat.items()).hasSize(1);
        assertThat(repeat.items().get(0).saleUnit()).isEqualTo("LOOSE");
        assertThat(repeat.items().get(0).quantity()).isEqualTo(8);
        assertThat(repeat.items().get(0).unitsPerPack()).isEqualTo(10);
        assertThat(repeat.unavailable()).isEmpty();
    }

    @Test
    @DisplayName("looseByDefault and the confirmed timestamp round-trip; default is dropped if loose is off")
    void looseDefaultAndConfirm() {
        var r = medicineService.setLoosePosSettings(medicineId,
                new com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest(true, null, true, true));
        assertThat(r.looseByDefault()).isTrue();
        assertThat(r.looseConfirmedAt()).isNotNull();

        // Turning loose off clears the default; the confirmation stamp is kept.
        var off = medicineService.setLoosePosSettings(medicineId,
                new com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest(false, null, null, null));
        assertThat(off.allowLooseSale()).isFalse();
        assertThat(off.looseByDefault()).isFalse();
        assertThat(off.looseConfirmedAt()).isNotNull();
    }

    @Test
    @DisplayName("bulk-enable only flips the switch for medicines with a pack size already on record — never a client-supplied one, never marked confirmed")
    void bulkEnableLoose() {
        // medicineId has a catalogue pack size (10) from the seed. A row for it is
        // accepted; the client's unitsPerPack is ignored and the size stays UNCONFIRMED
        // (a bulk action never checks a real strip).
        var ok = medicineService.bulkEnableLoose(List.of(
                new com.checkup.pharmacy.modules.medicine.MedicineService.BulkLooseRow(medicineId, 999, true)));
        assertThat(ok).hasSize(1);
        assertThat(ok.get(0).allowLooseSale()).isTrue();
        assertThat(ok.get(0).effectiveUnitsPerPack()).as("catalogue size, not the client's 999").isEqualTo(10);
        assertThat(ok.get(0).unitsPerPack()).as("no redundant override pack size written").isNull();
        assertThat(ok.get(0).looseConfirmedAt()).as("bulk never confirms a pack size").isNull();
        assertThat(ok.get(0).looseByDefault()).isTrue();

        // A medicine with NO structured pack size cannot be bulk-enabled — it has to be
        // done individually, where the dialog shows the size and requires the tick.
        Medicine noSize = Medicine.create("Amox 250", new BigDecimal("12"));
        noSize.setPackaging(null, "CAPSULE");
        medicineRepository.save(noSize);
        entityManager.flush();
        entityManager.clear();
        assertThatThrownBy(() -> medicineService.bulkEnableLoose(List.of(
                new com.checkup.pharmacy.modules.medicine.MedicineService.BulkLooseRow(noSize.getId(), 15, false))))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("no pack size on record");

        Medicine schX = Medicine.create("Alprax", new BigDecimal("12"));
        schX.applyFields(null, null, null, null, "X", null, new BigDecimal("12"), "tablet", null, "strip", "10");
        schX.setPackaging(10, "TABLET");
        medicineRepository.save(schX);
        entityManager.flush();
        entityManager.clear();

        assertThatThrownBy(() -> medicineService.bulkEnableLoose(List.of(
                new com.checkup.pharmacy.modules.medicine.MedicineService.BulkLooseRow(schX.getId(), 10, false))))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class);
    }

    @Test
    @DisplayName("enabling loose selling is refused for a Schedule X medicine")
    void enableLooseRefusedForScheduleX() {
        Medicine m = medicineRepository.findById(medicineId).orElseThrow();
        m.applyFields(null, null, null, null, "X", null, new BigDecimal("12"), "tablet", null, "strip", "10 tablets");
        m.setPackaging(10, "TABLET");
        medicineRepository.save(m);
        entityManager.flush();
        entityManager.clear();

        assertThatThrownBy(() -> medicineService.setLoosePosSettings(medicineId,
                new com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest(true, null)))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("Schedule X");
    }
}
