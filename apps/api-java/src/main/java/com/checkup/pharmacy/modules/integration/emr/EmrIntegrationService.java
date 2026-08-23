package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.validation.ValidationPatterns;
import com.checkup.pharmacy.modules.billing.Invoice;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionItem;
import com.checkup.pharmacy.modules.prescription.PrescriptionItemRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class EmrIntegrationService {

    private static final Duration NOT_PURCHASED_AFTER = Duration.ofHours(2);

    private final PrescriptionRepository prescriptionRepository;
    private final PrescriptionItemRepository itemRepository;
    private final InvoiceRepository invoiceRepository;
    private final MedicineRepository medicineRepository;
    private final InventoryRepository inventoryRepository;
    private final DocumentSequenceService sequenceService;

    public EmrIntegrationService(PrescriptionRepository prescriptionRepository,
                                 PrescriptionItemRepository itemRepository,
                                 InvoiceRepository invoiceRepository,
                                 MedicineRepository medicineRepository,
                                 InventoryRepository inventoryRepository,
                                 DocumentSequenceService sequenceService) {
        this.prescriptionRepository = prescriptionRepository;
        this.itemRepository = itemRepository;
        this.invoiceRepository = invoiceRepository;
        this.medicineRepository = medicineRepository;
        this.inventoryRepository = inventoryRepository;
        this.sequenceService = sequenceService;
    }

    @Transactional
    public EmrPrescriptionSnapshot ingest(EmrPrescriptionIngestRequest request) {
        String pharmacyId = TenantContext.pharmacyId();
        String externalTenantId = request.externalTenantId().trim();
        String externalPrescriptionId = request.externalPrescriptionId().trim();

        // Validated once, ahead of the create/amend branch below, so both paths get the
        // same integrity check rather than the amend path silently skipping it.
        Set<String> externalItemIds = new HashSet<>();
        for (var item : request.items()) {
            if (!externalItemIds.add(item.externalItemId().trim())) {
                throw new BadRequestException("Duplicate externalItemId: " + item.externalItemId());
            }
        }

        var existing = prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                        pharmacyId, externalTenantId, externalPrescriptionId);
        if (existing.isPresent()) {
            return applyAmendment(existing.get(), request);
        }

        Map<String, Medicine> resolvedByExternalItemId = matchIngestItems(request.items());

        int sequence = sequenceService.next(pharmacyId, DocumentSequenceService.PRESCRIPTION,
                DocumentSequenceService.PERIOD_ALL);
        Prescription prescription = Prescription.createFromEmr(pharmacyId,
                DocumentNumberFormat.prescription(sequence), externalTenantId, externalPrescriptionId,
                blankToNull(request.externalPrescriptionNumber()), request.doctorName().trim(),
                blankToNull(request.doctorRegNo()), ValidationPatterns.normalizeMobile(request.doctorPhone()),
                ValidationPatterns.normalizeName(request.patientName()), request.patientAge(),
                ValidationPatterns.normalizeMobile(request.patientPhone()), blankToNull(request.patientGender()),
                request.prescribedDate(), request.validUntil(), blankToNull(request.notes()));
        prescriptionRepository.save(prescription);

        List<PrescriptionItem> items = request.items().stream()
                .map(item -> {
                    Medicine resolved = resolvedByExternalItemId.get(item.externalItemId().trim());
                    return PrescriptionItem.createFromEmr(pharmacyId, prescription.getId(),
                        item.externalItemId().trim(), item.medicineName().trim(),
                        resolved == null ? null : resolved.getId(),
                        blankToNull(item.schedule()), item.quantity(), blankToNull(item.dosage()),
                        blankToNull(item.duration()), blankToNull(item.notes()));
                })
                .toList();
        itemRepository.saveAll(items);
        return snapshot(prescription, items, List.of(), Instant.now());
    }

    /**
     * Applies a re-push of a prescription the clinic already sent — a doctor's edit,
     * re-sent under the same externalEmrPrescriptionId. A pure retry (identical data) is
     * just an amendment that happens to change nothing; there is no separate code path for
     * it, and no harm in re-saving the same values.
     *
     * <h2>Why ACTIVE only</h2>
     * Stricter than {@link #cancel}'s guard, which still allows a PARTIAL prescription:
     * cancelling one only stops FUTURE dispensing, but amending one would mean rewriting
     * lines a pharmacist has already sold against — a quantity or a whole line changing
     * under a patient who already paid for it. There is no version of that which is safe,
     * so the whole prescription locks the moment status leaves ACTIVE. A clinic that needs
     * to change a prescription after dispensing has started has to cancel and send a new
     * one — same as a pharmacist would have to.
     *
     * <h2>Why items are merged, not replaced wholesale</h2>
     * Specifically to protect one thing: a pharmacist who already linked an unmatched line
     * to the right catalogue entry by hand, before any amendment arrived. A line whose
     * medicine name is unchanged keeps its existing medicineId untouched, even though every
     * other field on it (quantity, dosage, ...) is overwritten. Only a line whose name
     * actually changed is re-matched against the catalogue — a changed name may no longer
     * be the same medicine, so carrying the old link forward would be wrong in the other
     * direction. Because the ACTIVE guard above already guarantees nothing on this
     * prescription has been dispensed, every line is safe to update or delete outright;
     * there is no per-line dispensedQty check left to make.
     */
    @Transactional
    public EmrPrescriptionSnapshot applyAmendment(Prescription existing, EmrPrescriptionIngestRequest request) {
        if (existing.getStatus() != PrescriptionStatus.ACTIVE) {
            throw new ConflictException("Cannot amend prescription " + existing.getExternalEmrPrescriptionId()
                    + " — status is " + existing.getStatus()
                    + ". Cancel it and send a new one instead of re-pushing an edit.");
        }

        List<PrescriptionItem> currentItems = itemRepository.findByPrescriptionId(existing.getId());
        Map<String, PrescriptionItem> remainingByExternalItemId = currentItems.stream()
                .collect(Collectors.toMap(PrescriptionItem::getExternalEmrItemId, Function.identity()));

        // Only items that are new, or whose name changed, need a fresh catalogue lookup —
        // an unchanged name keeps whatever link it already had, matched or not.
        List<EmrPrescriptionIngestRequest.Item> needsMatch = request.items().stream()
                .filter(item -> {
                    PrescriptionItem current = remainingByExternalItemId.get(item.externalItemId().trim());
                    return current == null || !sameName(current.getMedicineName(), item.medicineName());
                })
                .toList();
        // Skipped rather than delegated when empty: matchIngestItems always issues a query
        // (a placeholder term when its input is empty, to sidestep Postgres's empty-IN-list
        // restriction) — fine for the create path, where it is called at most once, but a
        // no-op amendment (every line unchanged) would otherwise pay for a query whose
        // answer nothing here reads.
        Map<String, Medicine> resolvedByExternalItemId = needsMatch.isEmpty()
                ? Map.of() : matchIngestItems(needsMatch);

        List<PrescriptionItem> saved = new ArrayList<>();
        for (var item : request.items()) {
            String externalItemId = item.externalItemId().trim();
            // Removed from the map as it is claimed, so whatever is left afterwards is
            // exactly the lines this push did not mention — see the deletion below.
            PrescriptionItem current = remainingByExternalItemId.remove(externalItemId);
            Medicine resolved = resolvedByExternalItemId.get(externalItemId);

            if (current == null) {
                String medicineId = resolved == null ? null : resolved.getId();
                saved.add(PrescriptionItem.createFromEmr(existing.getPharmacyId(), existing.getId(), externalItemId,
                        item.medicineName().trim(), medicineId, blankToNull(item.schedule()), item.quantity(),
                        blankToNull(item.dosage()), blankToNull(item.duration()), blankToNull(item.notes())));
            } else {
                boolean nameChanged = !sameName(current.getMedicineName(), item.medicineName());
                String medicineId = nameChanged
                        ? (resolved == null ? null : resolved.getId())
                        : current.getMedicineId();
                current.applyEmrAmendment(item.medicineName().trim(), medicineId, blankToNull(item.schedule()),
                        item.quantity(), blankToNull(item.dosage()), blankToNull(item.duration()),
                        blankToNull(item.notes()));
                saved.add(current);
            }
        }
        itemRepository.saveAll(saved);

        // Whatever is left in the map was on the prescription before this push and is not
        // in it now — the doctor removed the line. Safe to delete outright: the ACTIVE
        // guard above already established nothing on this prescription has been dispensed.
        if (!remainingByExternalItemId.isEmpty()) {
            itemRepository.deleteAll(remainingByExternalItemId.values());
        }

        existing.applyEmrAmendment(request.doctorName().trim(), blankToNull(request.doctorRegNo()),
                ValidationPatterns.normalizeMobile(request.doctorPhone()),
                ValidationPatterns.normalizeName(request.patientName()), request.patientAge(),
                ValidationPatterns.normalizeMobile(request.patientPhone()), blankToNull(request.patientGender()),
                request.prescribedDate(), request.validUntil(), blankToNull(request.notes()));
        prescriptionRepository.save(existing);

        // No invoices to look up: the ACTIVE guard above guarantees none exist yet — the
        // first sale against this prescription is what would have moved it off ACTIVE.
        return snapshot(existing, saved, List.of(), Instant.now());
    }

    private static boolean sameName(String a, String b) {
        return normalize(a).equals(normalize(b));
    }

    @Transactional(readOnly = true)
    public EmrPrescriptionSnapshot get(String externalTenantId, String externalPrescriptionId) {
        String pharmacyId = TenantContext.pharmacyId();
        Prescription prescription = prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                        pharmacyId, externalTenantId.trim(), externalPrescriptionId.trim())
                .orElseThrow(() -> new NotFoundException("EMR prescription not found"));
        return snapshot(prescription, Instant.now());
    }

    /**
     * Withdraws a prescription the clinic already pushed — a doctor cancelling it, a
     * duplicate send, a patient who no longer needs it.
     *
     * <p>Without this, the only way to stop a pharmacy dispensing a withdrawn prescription
     * was a phone call: nothing on the EMR side could reach a prescription once it had been
     * ingested. The gap was structural, not an oversight — {@link Prescription#cancel()} has
     * existed since the counter-prescription flow, but nothing on the machine surface ever
     * called it. A prescription a clinic withdrew was, from the pharmacy's side,
     * indistinguishable from one still valid.
     *
     * <p>Same two rules as the staff-facing cancel ({@code PrescriptionService.cancel}),
     * deliberately not relaxed or tightened for the machine caller: a fully dispensed
     * prescription cannot be undone by cancelling it — the medicine already left the
     * pharmacy — and cancelling twice is a no-op error, not a second cancellation. A
     * PARTIAL prescription CAN still be cancelled, same as the staff path: the remaining
     * unfilled lines are what gets withdrawn, and what was already sold stays sold.
     */
    @Transactional
    public EmrPrescriptionSnapshot cancel(String externalTenantId, String externalPrescriptionId) {
        String pharmacyId = TenantContext.pharmacyId();
        Prescription prescription = prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                        pharmacyId, externalTenantId.trim(), externalPrescriptionId.trim())
                .orElseThrow(() -> new NotFoundException("EMR prescription not found"));
        if (prescription.getStatus() == PrescriptionStatus.DISPENSED) {
            throw new ConflictException("Cannot cancel a dispensed prescription");
        }
        if (prescription.getStatus() == PrescriptionStatus.CANCELLED) {
            throw new ConflictException("Prescription is already cancelled");
        }
        prescription.cancel();
        prescriptionRepository.save(prescription);
        return snapshot(prescription, Instant.now());
    }

    @Transactional(readOnly = true)
    public EmrMedicineMatchResponse matchMedicines(EmrMedicineMatchRequest request) {
        String pharmacyId = TenantContext.pharmacyId();
        Set<String> externalItemIds = new HashSet<>();
        for (var item : request.items()) {
            if (!externalItemIds.add(item.externalItemId())) {
                throw new BadRequestException("Duplicate externalItemId: " + item.externalItemId());
            }
        }
        Set<String> lowerNames = request.items().stream().map(EmrMedicineMatchRequest.Item::name)
                .map(EmrIntegrationService::normalize).collect(Collectors.toSet());
        Set<String> lowerGenerics = request.items().stream().map(EmrMedicineMatchRequest.Item::genericName)
                .filter(Objects::nonNull).filter(s -> !s.isBlank())
                .map(EmrIntegrationService::normalize).collect(Collectors.toSet());
        // Hibernate/Postgres do not portably accept an empty IN collection.
        if (lowerNames.isEmpty()) lowerNames = Set.of("__no_name__");
        if (lowerGenerics.isEmpty()) lowerGenerics = Set.of("__no_generic__");

        List<Medicine> candidates = new ArrayList<>(medicineRepository.findActiveForEmrMatch(lowerNames, lowerGenerics));
        Map<String, Medicine> direct = activeMedicinesById(request.items().stream()
                .map(EmrMedicineMatchRequest.Item::medicineId)
                .filter(Objects::nonNull).filter(s -> !s.isBlank()).toList());
        direct.values().forEach(m -> {
            if (candidates.stream().noneMatch(c -> c.getId().equals(m.getId()))) candidates.add(m);
        });

        Map<String, Match> matches = new LinkedHashMap<>();
        for (var item : request.items()) {
            Match match = match(item, direct, candidates);
            matches.put(item.externalItemId(), match);
        }

        Set<String> matchedIds = matches.values().stream().map(Match::medicine)
                .filter(Objects::nonNull).map(Medicine::getId).collect(Collectors.toSet());
        Map<String, List<Inventory>> stock = matchedIds.isEmpty() ? Map.of()
                : inventoryRepository.findActiveNonExpiredByMedicineIdIn(pharmacyId, matchedIds, Instant.now()).stream()
                        .collect(Collectors.groupingBy(Inventory::getMedicineId));

        List<EmrMedicineMatchResponse.Item> response = request.items().stream().map(item -> {
            Match match = matches.get(item.externalItemId());
            Medicine medicine = match.medicine();
            if (medicine == null) {
                return new EmrMedicineMatchResponse.Item(item.externalItemId(), match.strategy(), null, null,
                        null, null, null, null, 0, null, match.strategy().startsWith("AMBIGUOUS"));
            }
            List<Inventory> batches = stock.getOrDefault(medicine.getId(), List.of());
            int available = batches.stream().mapToInt(b -> Math.max(0, b.getQuantity() - b.getReservedQuantity())).sum();
            BigDecimal price = batches.stream()
                    .filter(b -> b.getQuantity() - b.getReservedQuantity() > 0)
                    .map(Inventory::getMrp).filter(Objects::nonNull).min(BigDecimal::compareTo).orElse(null);
            return new EmrMedicineMatchResponse.Item(item.externalItemId(), match.strategy(), medicine.getId(),
                    medicine.getName(), medicine.getGenericName(), medicine.getStrength(), medicine.getForm(),
                    medicine.getUnit(), available, price, false);
        }).toList();
        return new EmrMedicineMatchResponse(response);
    }

    /**
     * Resolves each EMR ingest item against the pharmacy catalogue by name/strength,
     * keyed by trimmed externalItemId. The item's own medicineId is EMR-internal and
     * is never a valid pharmacy Medicine id, so it is deliberately not used for lookup.
     * Unmatched items are simply absent from the result (medicineId stays null).
     */
    private Map<String, Medicine> matchIngestItems(List<EmrPrescriptionIngestRequest.Item> items) {
        Set<String> lowerNames = items.stream().map(EmrPrescriptionIngestRequest.Item::medicineName)
                .map(EmrIntegrationService::normalize).collect(Collectors.toSet());
        if (lowerNames.isEmpty()) lowerNames = Set.of("__no_name__");
        List<Medicine> candidates = new ArrayList<>(
                medicineRepository.findActiveForEmrMatch(lowerNames, Set.of("__no_generic__")));

        Map<String, Medicine> resolved = new LinkedHashMap<>();
        for (var item : items) {
            var matchItem = new EmrMedicineMatchRequest.Item(item.externalItemId(), null,
                    item.medicineName(), null, item.strength(), null);
            Medicine medicine = match(matchItem, Map.of(), candidates).medicine();
            if (medicine != null) resolved.put(item.externalItemId().trim(), medicine);
        }
        return resolved;
    }

    private EmrPrescriptionSnapshot snapshot(Prescription prescription, Instant now) {
        String pharmacyId = prescription.getPharmacyId();
        List<PrescriptionItem> items = itemRepository
                .findByPharmacyIdAndPrescriptionIdIn(pharmacyId, List.of(prescription.getId()));
        List<Invoice> invoices = invoiceRepository
                .findByPharmacyIdAndPrescriptionIdOrderByCreatedAtAsc(pharmacyId, prescription.getId());
        return snapshot(prescription, items, invoices, now);
    }

    private static EmrPrescriptionSnapshot snapshot(Prescription prescription, List<PrescriptionItem> items,
                                                    List<Invoice> invoices, Instant now) {
        String status = deriveStatus(prescription.getStatus(), prescription.getReceivedAt(),
                items.stream().map(PrescriptionItem::getDispensedQty).toList(), now);
        return new EmrPrescriptionSnapshot(prescription.getPharmacyId(), prescription.getId(),
                prescription.getPrescriptionNumber(), prescription.getExternalEmrTenantId(),
                prescription.getExternalEmrPrescriptionId(), prescription.getExternalEmrPrescriptionNumber(), status,
                prescription.getReceivedAt(), items.stream().map(i -> new EmrPrescriptionSnapshot.Item(
                        i.getExternalEmrItemId(), i.getMedicineId(), i.getMedicineName(), i.getQuantity(),
                        i.getDispensedQty())).toList(), invoices.stream().map(i -> new EmrPrescriptionSnapshot.Invoice(
                        i.getId(), i.getInvoiceNumber(), i.getStatus().name(), i.getPaymentStatus().name(),
                        i.getTotalAmount(), i.getReturnedAmount(), i.getCreatedAt())).toList());
    }

    static String deriveStatus(PrescriptionStatus storedStatus, Instant receivedAt,
                               List<Integer> dispensedQuantities, Instant now) {
        if (storedStatus == PrescriptionStatus.DISPENSED) return "DISPENSED";
        if (storedStatus == PrescriptionStatus.PARTIAL) return "PARTIALLY_PURCHASED";
        if (storedStatus != PrescriptionStatus.ACTIVE) return storedStatus.name();
        boolean nothingDispensed = dispensedQuantities.stream().allMatch(qty -> qty == null || qty == 0);
        if (receivedAt != null && nothingDispensed
                && !now.isBefore(receivedAt.plus(NOT_PURCHASED_AFTER))) {
            return "NOT_PURCHASED";
        }
        return "RECEIVED";
    }

    private Map<String, Medicine> activeMedicinesById(Collection<String> ids) {
        Set<String> distinct = ids.stream().filter(Objects::nonNull).filter(s -> !s.isBlank()).collect(Collectors.toSet());
        if (distinct.isEmpty()) return Map.of();
        return medicineRepository.findAllById(distinct).stream().filter(Medicine::isActive)
                .collect(Collectors.toMap(Medicine::getId, Function.identity()));
    }

    /**
     * Two candidates tying on the same name (or generic+strength+form) is a different problem
     * from finding none at all — one is a duplicate in this pharmacy's own catalogue, the
     * other is a genuinely unknown product — and collapsing both to plain UNMATCHED told a
     * pharmacist "not found" when the real answer was "found twice, pick one". AMBIGUOUS_*
     * still resolves to no medicineId (nothing here can safely pick between two candidates on
     * its own), but names the actual reason so it can be shown differently — see
     * {@link EmrMedicineMatchResponse.Item#ambiguous}.
     */
    private static Match match(EmrMedicineMatchRequest.Item item, Map<String, Medicine> direct,
                               List<Medicine> candidates) {
        if (item.medicineId() != null && direct.containsKey(item.medicineId())) {
            return new Match("EXACT_ID", direct.get(item.medicineId()));
        }
        List<Medicine> exactName = candidates.stream()
                .filter(m -> normalize(m.getName()).equals(normalize(item.name())))
                .filter(m -> compatible(m, item)).toList();
        if (exactName.size() == 1) return new Match("EXACT_NAME", exactName.getFirst());
        if (exactName.size() > 1) return new Match("AMBIGUOUS_NAME", null);

        if (item.genericName() != null && !item.genericName().isBlank()) {
            List<Medicine> exactGeneric = candidates.stream()
                    .filter(m -> normalize(m.getGenericName()).equals(normalize(item.genericName())))
                    .filter(m -> compatible(m, item)).toList();
            if (exactGeneric.size() == 1) return new Match("GENERIC_STRENGTH_FORM", exactGeneric.getFirst());
            if (exactGeneric.size() > 1) return new Match("AMBIGUOUS_GENERIC", null);
        }
        return new Match("UNMATCHED", null);
    }

    private static boolean compatible(Medicine medicine, EmrMedicineMatchRequest.Item item) {
        return (item.strength() == null || item.strength().isBlank()
                || normalize(medicine.getStrength()).equals(normalize(item.strength())))
                && (item.form() == null || item.form().isBlank()
                || normalize(medicine.getForm()).equals(normalize(item.form())));
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private record Match(String strategy, Medicine medicine) {
    }
}
