package com.checkup.pharmacy.modules.dispensing;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.DispensingStrategy;
import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.util.BaseUnits;
import com.checkup.pharmacy.common.util.GstCalculator;
import com.checkup.pharmacy.common.util.PackUnits;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.dispensing.dto.DispensingPlan;
import com.checkup.pharmacy.modules.dispensing.dto.DispensingPlanRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicine;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionItem;
import com.checkup.pharmacy.modules.prescription.PrescriptionItemRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The one authority on <b>which batch a medicine dispenses from and how</b>.
 *
 * <p>Before this existed, batch selection was scattered: the backend hardcoded FEFO
 * ({@code InventoryRepository.findFefoCandidates}), the LIFA/LILA toggle was a
 * frontend-only expiry sort that only the manual billing search read, and pack /
 * loose / round-up logic was duplicated between {@code prescriptionToCart.ts} and
 * {@code BillingService}. Every dispensing surface now asks this service for a
 * {@link DispensingPlan} instead of choosing batches itself:
 *
 * <ul>
 *   <li>New Billing — manual search &amp; batch picker (order comes from here)</li>
 *   <li>Quick Add and Repeat Last Bill</li>
 *   <li>EMR / prescription fulfilment ({@link #planForPrescription})</li>
 *   <li>loose (cut-strip) dispensing — the pack/loose decision lives here once</li>
 * </ul>
 *
 * <h2>What it guarantees</h2>
 * <ol>
 *   <li><b>Only sellable stock.</b> ACTIVE status only — which by construction
 *       excludes recalled (QUARANTINE), damaged and expired batches — plus
 *       {@code expiryDate &gt; now} and unreserved stock left. Same filter for both
 *       strategies; see {@link InventoryRepository}.</li>
 *   <li><b>The configured order.</b> {@code LILA_FEFO} (default) — earliest valid
 *       expiry first. {@code LIFA} — most recently received batch first. Both fully
 *       deterministic (tie-break on id); see {@link BatchOrdering}.</li>
 *   <li><b>Correct multi-batch allocation.</b> Walks batches in order filling the
 *       required piece count, splitting across batches, choosing packs vs. loose
 *       units per batch, rounding up to a whole pack when a strip cannot be cut, and
 *       reporting any shortfall rather than silently under-dispensing.</li>
 * </ol>
 *
 * <p>Actual stock decrement and its row locking stay in {@code BillingService} —
 * this service decides, billing enforces. The strategy in effect is snapshotted
 * onto each {@code Invoice} so a later change never rewrites a past sale.
 */
@Service
public class DispensingService {

    private final PharmacyRepository pharmacyRepository;
    private final InventoryRepository inventoryRepository;
    private final MedicineRepository medicineRepository;
    private final PharmacyMedicineRepository pharmacyMedicineRepository;
    private final PharmacyMedicineOverrideRepository overrideRepository;
    private final PrescriptionRepository prescriptionRepository;
    private final PrescriptionItemRepository prescriptionItemRepository;
    private final AuditService auditService;

    public DispensingService(PharmacyRepository pharmacyRepository,
                             InventoryRepository inventoryRepository,
                             MedicineRepository medicineRepository,
                             PharmacyMedicineRepository pharmacyMedicineRepository,
                             PharmacyMedicineOverrideRepository overrideRepository,
                             PrescriptionRepository prescriptionRepository,
                             PrescriptionItemRepository prescriptionItemRepository,
                             AuditService auditService) {
        this.pharmacyRepository = pharmacyRepository;
        this.inventoryRepository = inventoryRepository;
        this.medicineRepository = medicineRepository;
        this.pharmacyMedicineRepository = pharmacyMedicineRepository;
        this.overrideRepository = overrideRepository;
        this.prescriptionRepository = prescriptionRepository;
        this.prescriptionItemRepository = prescriptionItemRepository;
        this.auditService = auditService;
    }

    // ── Strategy setting ─────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public DispensingStrategy strategyFor(String pharmacyId) {
        return pharmacyRepository.findById(pharmacyId)
                .map(Pharmacy::getDispensingStrategy)
                .orElse(DispensingStrategy.DEFAULT);
    }

    @Transactional(readOnly = true)
    public DispensingStrategy currentStrategy() {
        return strategyFor(TenantContext.pharmacyId());
    }

    /**
     * Changes the pharmacy-wide strategy. Affects only FUTURE dispensing — past
     * invoices carry their own snapshot and are never touched. Audited like any
     * other settings change (mirrors {@code BillingService.saveBillingPreferences}).
     */
    @Transactional
    public DispensingStrategy updateStrategy(String rawStrategy) {
        String pharmacyId = TenantContext.pharmacyId();
        DispensingStrategy next;
        try {
            next = DispensingStrategy.parse(rawStrategy);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException(e.getMessage());
        }
        Pharmacy pharmacy = pharmacyRepository.findById(pharmacyId)
                .orElseThrow(() -> new NotFoundException("Pharmacy not found"));
        DispensingStrategy previous = pharmacy.getDispensingStrategy();
        pharmacy.setDispensingStrategy(next);

        auditService.log(AuditEntry
                .of(AuditModule.SETTINGS, "UPDATE", "DispensingStrategy")
                .pharmacyId(pharmacyId).userId(TenantContext.userId()).entityId(pharmacyId)
                .oldData(Map.<String, Object>of("strategy", previous == null ? "null" : previous.name()))
                .newData(Map.<String, Object>of("strategy", next.name())));
        return next;
    }

    // ── Ordering primitives (shared with InventoryService: Quick Add, picker) ─

    /** Sorts a caller-fetched batch list by the current pharmacy strategy. */
    public List<Inventory> orderBatches(List<Inventory> batches) {
        return orderBatches(batches, currentStrategy());
    }

    public List<Inventory> orderBatches(List<Inventory> batches, DispensingStrategy strategy) {
        List<Inventory> copy = new ArrayList<>(batches);
        copy.sort(BatchOrdering.comparator(strategy));
        return copy;
    }

    /**
     * The single best batch per medicine under the current strategy, from a
     * caller-fetched candidate list — for Quick Add and Repeat Last Bill.
     */
    public Map<String, Inventory> topBatchPerMedicine(List<Inventory> candidates) {
        Comparator<Inventory> order = BatchOrdering.comparator(currentStrategy());
        Map<String, Inventory> best = new HashMap<>();
        for (Inventory b : candidates) {
            if (b.getMedicineId() == null) {
                continue;
            }
            best.merge(b.getMedicineId(), b, (a, c) -> order.compare(a, c) <= 0 ? a : c);
        }
        return best;
    }

    // ── Plans ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public DispensingPlan plan(List<DispensingPlanRequest.Line> requestedLines) {
        String pharmacyId = TenantContext.pharmacyId();
        DispensingStrategy strategy = strategyFor(pharmacyId);
        Instant now = Instant.now();

        List<DispensingPlan.Line> lines = new ArrayList<>();
        for (int i = 0; i < requestedLines.size(); i++) {
            DispensingPlanRequest.Line req = requestedLines.get(i);
            boolean hasCatalogue = req.medicineId() != null && !req.medicineId().isBlank();
            boolean hasLocal = req.localMedicineId() != null && !req.localMedicineId().isBlank();
            if (hasCatalogue == hasLocal) {
                throw new BadRequestException("Line " + (i + 1)
                        + " needs exactly one of medicineId / localMedicineId — got "
                        + (hasCatalogue ? "both" : "neither") + ".");
            }
            if (req.requiredPieces() <= 0) {
                throw new BadRequestException("Line " + (i + 1)
                        + ": requiredPieces must be a positive whole number (got " + req.requiredPieces() + ").");
            }
            // A garbage id on an explicit request IS an error the caller should see.
            MedicineContext ctx = resolveContext(pharmacyId, blankToNull(req.medicineId()),
                    blankToNull(req.localMedicineId()), blankToNull(req.schedule()), now);
            lines.add(allocate(ctx, req.requiredPieces(), strategy));
        }
        return new DispensingPlan(strategy.name(), lines);
    }

    /**
     * Auto-dispensing plan for a clinic/counter prescription: every line that is
     * catalogue-linked and still owes quantity, resolved to real batches with the
     * configured strategy. Lines still awaiting a manual quantity
     * ({@code needsQuantityConfirmation}) or an unmatched medicine are left out —
     * the pharmacist resolves those first, exactly as the triage screen already
     * requires.
     */
    @Transactional(readOnly = true)
    public DispensingPlan planForPrescription(String prescriptionId) {
        String pharmacyId = TenantContext.pharmacyId();
        Prescription rx = prescriptionRepository.findByIdAndPharmacyId(prescriptionId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Prescription not found"));
        DispensingStrategy strategy = strategyFor(pharmacyId);
        Instant now = Instant.now();

        // Only the lines worth planning: catalogue-linked, quantity known, still owing.
        // A prescription line always carries a CATALOGUE medicineId (linkItemToMedicine /
        // the EMR matcher only ever set one), so this path never touches local medicines.
        List<PrescriptionItem> billable = new ArrayList<>();
        for (PrescriptionItem item : prescriptionItemRepository.findByPrescriptionId(rx.getId())) {
            if (item.getMedicineId() != null && !item.needsQuantityConfirmation()
                    && item.getQuantity() - item.getDispensedQty() > 0) {
                billable.add(item);
            }
        }
        if (billable.isEmpty()) {
            return new DispensingPlan(strategy.name(), List.of());
        }

        // Three queries for the whole prescription, not three per line: the medicines,
        // this pharmacy's overrides on them, and every sellable batch for the lot.
        Set<String> medicineIds = new HashSet<>();
        billable.forEach(i -> medicineIds.add(i.getMedicineId()));
        Map<String, Medicine> medById = new HashMap<>();
        medicineRepository.findAllById(medicineIds).forEach(m -> medById.put(m.getId(), m));
        Map<String, PharmacyMedicineOverride> overrideByMedicineId = overridesFor(pharmacyId, medById.keySet());
        Map<String, List<Inventory>> batchesByMedicineId = medById.isEmpty()
                ? Map.of()
                : groupByEffectiveMedicine(inventoryRepository
                        .findSellableBatchesForEffectiveMedicines(pharmacyId, medById.keySet(), now));

        List<DispensingPlan.Line> lines = new ArrayList<>();
        for (PrescriptionItem item : billable) {
            int owed = item.getQuantity() - item.getDispensedQty();
            Medicine m = medById.get(item.getMedicineId());
            if (m == null) {
                // The catalogue medicine was deleted after this line was linked — report
                // it as an unmet line the pharmacist can act on, don't fail the whole plan.
                lines.add(new DispensingPlan.Line(item.getMedicineId(), null, item.getMedicineName(),
                        item.getSchedule(), owed, 0, false, owed, null, "MEDICINE_UNAVAILABLE",
                        "\"" + item.getMedicineName() + "\" is no longer in the catalogue — "
                        + "link this line to a current medicine or substitute it.", List.of()));
                continue;
            }
            MedicineContext ctx = catalogueContext(m, overrideByMedicineId.get(m.getId()), item.getSchedule(),
                    batchesByMedicineId.getOrDefault(m.getId(), List.of()));
            lines.add(allocate(ctx, owed, strategy));
        }
        return new DispensingPlan(strategy.name(), lines);
    }

    private Map<String, PharmacyMedicineOverride> overridesFor(String pharmacyId, Set<String> medicineIds) {
        Map<String, PharmacyMedicineOverride> out = new HashMap<>();
        if (!medicineIds.isEmpty()) {
            for (PharmacyMedicineOverride o : overrideRepository
                    .findByIdPharmacyIdAndIdMedicineIdIn(pharmacyId, medicineIds)) {
                out.put(o.getMedicineId(), o);
            }
        }
        return out;
    }

    /** Groups sellable batches by the catalogue medicine they should be dispensed AS — see {@code EffectiveMedicine}. */
    private static Map<String, List<Inventory>> groupByEffectiveMedicine(List<Inventory> batches) {
        Map<String, List<Inventory>> out = new HashMap<>();
        for (Inventory i : batches) {
            String eff = i.getMedicineId() != null
                    ? i.getMedicineId()
                    : (i.getLocalMedicine() != null ? i.getLocalMedicine().getLinkedMedicineId() : null);
            if (eff != null) {
                out.computeIfAbsent(eff, k -> new ArrayList<>()).add(i);
            }
        }
        return out;
    }

    // ── Medicine context ─────────────────────────────────────────────────────

    /**
     * The catalogue behaviour + sellable batches for one requested line. Mirrors
     * {@code InventoryService.enrich}'s resolution (see {@code EffectiveMedicine}) —
     * a batch received against a LINKED local identity borrows its catalogue
     * medicine's pack size, loose-sale opt-in and GST.
     */
    private MedicineContext resolveContext(String pharmacyId, String medicineId, String localMedicineId,
                                           String schedule, Instant now) {
        // A local medicine that has been confirmed LINKED behaves exactly like its
        // catalogue target from here on.
        if (localMedicineId != null) {
            PharmacyMedicine local = pharmacyMedicineRepository
                    .findByIdAndPharmacyId(localMedicineId, pharmacyId).orElse(null);
            if (local == null) {
                throw new NotFoundException(
                        "No medicine found for localMedicineId \"" + localMedicineId + "\" at this pharmacy.");
            }
            if (local.getMatchStatus() == MedicineMatchStatus.LINKED && local.getLinkedMedicineId() != null) {
                medicineId = local.getLinkedMedicineId();
                localMedicineId = null;
            } else {
                // Genuinely local — no loose-sale support, no override, GST/schedule from itself.
                List<Inventory> batches = inventoryRepository
                        .findSellableBatchesForLocalMedicine(pharmacyId, local.getId(), now);
                return new MedicineContext(null, local.getId(), local.getName(),
                        firstNonBlank(schedule, local.getSchedule()), local.getGstRate(), local.getHsnCode(),
                        null, BaseUnits.resolve(null, local.getForm()), local.getUnit(), null, false, batches);
            }
        }

        final String lookupId = medicineId;
        Medicine m = medicineRepository.findById(lookupId)
                .orElseThrow(() -> new NotFoundException("No catalogue medicine found for id \"" + lookupId + "\"."));
        PharmacyMedicineOverride override = overrideRepository
                .findByIdPharmacyIdAndIdMedicineIdIn(pharmacyId, Set.of(m.getId()))
                .stream().findFirst().orElse(null);
        List<Inventory> batches = inventoryRepository
                .findSellableBatchesForEffectiveMedicine(pharmacyId, m.getId(), now);
        return catalogueContext(m, override, schedule, batches);
    }

    /** Builds the dispensing context for a catalogue medicine from already-fetched data. */
    private static MedicineContext catalogueContext(Medicine m, PharmacyMedicineOverride override,
                                                    String schedule, List<Inventory> sellableBatches) {
        Integer upp = PharmacyMedicineOverride.effectiveUnitsPerPack(override, m);
        boolean allowLoose = override != null && override.isAllowLooseSale() && upp != null && upp > 1;
        return new MedicineContext(m.getId(), null, m.getName(),
                firstNonBlank(schedule, m.getSchedule()), m.getGstRate(), m.getHsnCode(),
                upp, BaseUnits.resolve(m.getBaseUnit(), m.getForm()), m.getUnit(), m.getPackSize(),
                allowLoose, sellableBatches);
    }

    // ── Allocation ───────────────────────────────────────────────────────────

    private DispensingPlan.Line allocate(MedicineContext ctx, int requiredPieces, DispensingStrategy strategy) {
        int upp = ctx.unitsPerPack() != null && ctx.unitsPerPack() > 1 ? ctx.unitsPerPack() : 1;
        boolean scheduleX = "X".equalsIgnoreCase(ctx.schedule() == null ? "" : ctx.schedule().trim());
        boolean looseOkForMedicine = ctx.allowLooseSale() && upp > 1 && !scheduleX;

        List<Inventory> ordered = orderBatches(ctx.sellableBatches(), strategy);
        // Non-empty means SOME physical stock exists (the query already filters to
        // unreserved packs OR a loose remainder) — so if nothing gets allocated it is
        // the pack/loose rules blocking it, not an empty shelf.
        boolean hasPhysicalStock = !ordered.isEmpty();

        List<DispensingPlan.Allocation> allocations = new ArrayList<>();
        int consumed = 0;

        for (Inventory b : ordered) {
            if (consumed >= requiredPieces) {
                break;
            }
            int packsAvail = Math.max(0, b.getQuantity() - b.getReservedQuantity());
            int looseAvail = Math.max(0, b.getLooseUnits());
            // A batch with no MRP cannot be priced per piece, so it can only sell as
            // whole packs — same rule BillingService enforces on the sale itself.
            boolean batchLooseOk = looseOkForMedicine
                    && b.getMrp() != null && b.getMrp().signum() > 0;
            int capacityPieces = batchLooseOk
                    ? packsAvail * upp + looseAvail
                    : packsAvail * upp;
            if (capacityPieces <= 0) {
                continue;
            }

            int want = Math.min(requiredPieces - consumed, capacityPieces);
            Chunk chunk = resolveChunk(upp, batchLooseOk, want, packsAvail, looseAvail);
            if (chunk == null) {
                continue;
            }
            allocations.add(buildAllocation(b, ctx, chunk, upp));
            consumed += chunk.piecesConsumed();
        }

        boolean fully = consumed >= requiredPieces; // the course is covered (rounded-up still covers it)
        Integer shortfall = consumed < requiredPieces ? requiredPieces - consumed : null;
        Integer roundedUp = consumed > requiredPieces ? consumed : null;
        String unit = unitLabel(ctx.baseUnit());
        // The sale-unit vocabulary for this medicine — "strip"/"bottle"/"tube" — and
        // whether it is a measured volume/weight, so a bottle is never told to "cut a
        // strip" and a part-bottle prescription reads as an expected round-up, not a fault.
        String packWord = PackUnits.packUnitLabel(ctx.unit(), ctx.baseUnit());
        boolean measured = PackUnits.isMeasured(ctx.baseUnit());
        int packsRounded = consumed / Math.max(1, upp);

        String unmetReason = null;
        String message = null;
        if (allocations.isEmpty()) {
            if (!hasPhysicalStock) {
                unmetReason = "NO_STOCK";
                message = "No in-date, sellable stock of \"" + ctx.name() + "\" at this pharmacy right now.";
            } else {
                unmetReason = "NO_SELLABLE_UNIT";
                message = measured
                        ? "\"" + ctx.name() + "\" has stock, but less than one full sealed " + packWord
                                + " on the shelf — restock a full " + packWord + "."
                        : "\"" + ctx.name() + "\" has stock, but less than one full pack"
                                + (scheduleX ? " and Schedule X medicines can't be split into loose units"
                                             : " and loose (cut-strip) selling is off for it here")
                                + " — turn on loose selling for this medicine, or restock a full pack.";
            }
        } else if (shortfall != null) {
            unmetReason = "PARTIAL";
            message = "Only " + consumed + " of " + requiredPieces + " " + unit + " could be allocated — "
                    + shortfall + " " + unit + " short. Bill what's available and reorder, or substitute.";
        } else if (roundedUp != null) {
            unmetReason = "ROUNDED_UP";
            message = measured
                    // A sealed bottle/tube genuinely cannot be split — rounding up to whole
                    // packs is the correct, expected outcome, not a policy workaround.
                    ? requiredPieces + " " + unit + " prescribed — billing " + packsRounded + " "
                            + PackUnits.plural(packWord, packsRounded) + " (" + consumed + " " + unit
                            + "). A sealed " + packWord + " can't be split."
                    : requiredPieces + " " + unit + " was rounded up to " + consumed + " (" + packsRounded
                            + " full " + PackUnits.plural(packWord, packsRounded) + ") because \"" + ctx.name()
                            + "\" can't be sold as loose pieces here"
                            + (scheduleX ? " (Schedule X)" : "") + ". Enable loose selling to bill the exact amount.";
        }

        return new DispensingPlan.Line(ctx.medicineId(), ctx.localMedicineId(), ctx.name(), ctx.schedule(),
                requiredPieces, consumed, fully, shortfall, roundedUp, unmetReason, message, allocations);
    }

    /** A short unit word for pharmacist-facing messages — "tablets", "capsules", "units", ... */
    private static String unitLabel(String baseUnit) {
        if (baseUnit == null) {
            return "units";
        }
        return switch (baseUnit.trim().toUpperCase()) {
            case "TABLET" -> "tablets";
            case "CAPSULE" -> "capsules";
            case "ML" -> "ml";
            case "GM" -> "g";
            default -> "units";
        };
    }

    /**
     * One batch's contribution — the single-batch pack/loose decision, ported
     * verbatim from {@code prescriptionToCart.resolveSaleUnit} so a prescription
     * resolves identically whether the frontend or this engine does it.
     */
    private static Chunk resolveChunk(int upp, boolean looseOk, int wantPieces, int packsAvail, int looseAvail) {
        int packs = Math.max(packsAvail, 0);
        if (upp <= 1) {
            int qty = Math.min(wantPieces, packs);
            return qty > 0 ? new Chunk("PACK", qty, qty) : null;
        }
        int loose = Math.max(looseAvail, 0);
        boolean wholeMultiple = wantPieces > 0 && wantPieces % upp == 0;
        int packsNeeded = wantPieces / upp;

        // Sell whole packs when it IS a whole number of packs and enough sealed
        // packs cover it — unless the already-open remainder alone does. Mirrors
        // BillingService's own guard against cutting a sealed strip needlessly.
        if (wholeMultiple && packs >= packsNeeded && !(looseOk && loose >= wantPieces)) {
            return new Chunk("PACK", packsNeeded, packsNeeded * upp);
        }
        if (looseOk) {
            int qty = Math.min(wantPieces, packs * upp + loose);
            return qty > 0 ? new Chunk("LOOSE", qty, qty) : null;
        }
        // No cutting here — round UP to the nearest whole pack rather than short the
        // course, capped at packs actually on the shelf.
        int desiredPacks = Math.min((int) Math.ceil((double) wantPieces / upp), packs);
        return desiredPacks > 0 ? new Chunk("PACK", desiredPacks, desiredPacks * upp) : null;
    }

    private static DispensingPlan.Allocation buildAllocation(Inventory b, MedicineContext ctx, Chunk chunk, int upp) {
        boolean loose = "LOOSE".equals(chunk.saleUnit());
        BigDecimal packMrp = b.getMrp() != null ? b.getMrp() : BigDecimal.ZERO;
        BigDecimal unitMrp = loose && upp > 1 ? GstCalculator.perPieceMrp(packMrp, upp) : packMrp;
        BigDecimal gstRate = ctx.gstRate() != null ? ctx.gstRate() : BigDecimal.ZERO;
        // Preview only: zero line discount, intra-state. IGST is applied at invoice
        // level from the bill's own flag, exactly as billing and the store do.
        GstCalculator.MrpGstBreakdown gst = GstCalculator.calcGstFromMrp(
                unitMrp, chunk.quantity(), BigDecimal.ZERO, gstRate, false);
        int availableStock = Math.max(0, b.getQuantity() - b.getReservedQuantity());
        return new DispensingPlan.Allocation(
                b.getId(), b.getBatchNumber(), b.getExpiryDate(), chunk.saleUnit(), chunk.quantity(),
                ctx.unitsPerPack(), ctx.baseUnit(), ctx.unit(), ctx.packSize(),
                packMrp, unitMrp, GstCalculator.round2(unitMrp),
                gstRate, ctx.hsnCode(), ctx.allowLooseSale(), Math.max(0, b.getLooseUnits()), availableStock,
                gst.taxableAmount(), gst.cgst(), gst.sgst(), gst.igst(), gst.amount());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String firstNonBlank(String a, String b) {
        return a != null && !a.isBlank() ? a : b;
    }

    private record Chunk(String saleUnit, int quantity, int piecesConsumed) {
    }

    private record MedicineContext(
            String medicineId,
            String localMedicineId,
            String name,
            String schedule,
            BigDecimal gstRate,
            String hsnCode,
            Integer unitsPerPack,
            String baseUnit,
            /** {@code Medicine.unit} — packaging word ("Strip", "Bottle", "Tube"), for pharmacist-facing messages. */
            String unit,
            /** {@code Medicine.packSize} — free-text catalogue label ("100ml", "1x15"), display-only. */
            String packSize,
            boolean allowLooseSale,
            List<Inventory> sellableBatches
    ) {
        private MedicineContext {
            sellableBatches = sellableBatches == null ? List.of() : sellableBatches;
        }
    }
}
