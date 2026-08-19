package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
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
        var existing = prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                        pharmacyId, externalTenantId, externalPrescriptionId);
        if (existing.isPresent()) {
            return snapshot(existing.get(), Instant.now());
        }

        Set<String> externalItemIds = new HashSet<>();
        for (var item : request.items()) {
            if (!externalItemIds.add(item.externalItemId().trim())) {
                throw new BadRequestException("Duplicate externalItemId: " + item.externalItemId());
            }
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

    @Transactional(readOnly = true)
    public EmrPrescriptionSnapshot get(String externalTenantId, String externalPrescriptionId) {
        String pharmacyId = TenantContext.pharmacyId();
        Prescription prescription = prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                        pharmacyId, externalTenantId.trim(), externalPrescriptionId.trim())
                .orElseThrow(() -> new NotFoundException("EMR prescription not found"));
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
                return new EmrMedicineMatchResponse.Item(item.externalItemId(), "UNMATCHED", null, null,
                        null, null, null, null, 0, null);
            }
            List<Inventory> batches = stock.getOrDefault(medicine.getId(), List.of());
            int available = batches.stream().mapToInt(b -> Math.max(0, b.getQuantity() - b.getReservedQuantity())).sum();
            BigDecimal price = batches.stream()
                    .filter(b -> b.getQuantity() - b.getReservedQuantity() > 0)
                    .map(Inventory::getMrp).filter(Objects::nonNull).min(BigDecimal::compareTo).orElse(null);
            return new EmrMedicineMatchResponse.Item(item.externalItemId(), match.strategy(), medicine.getId(),
                    medicine.getName(), medicine.getGenericName(), medicine.getStrength(), medicine.getForm(),
                    medicine.getUnit(), available, price);
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

    private static Match match(EmrMedicineMatchRequest.Item item, Map<String, Medicine> direct,
                               List<Medicine> candidates) {
        if (item.medicineId() != null && direct.containsKey(item.medicineId())) {
            return new Match("EXACT_ID", direct.get(item.medicineId()));
        }
        List<Medicine> exactName = candidates.stream()
                .filter(m -> normalize(m.getName()).equals(normalize(item.name())))
                .filter(m -> compatible(m, item)).toList();
        if (exactName.size() == 1) return new Match("EXACT_NAME", exactName.getFirst());

        if (item.genericName() != null && !item.genericName().isBlank()) {
            List<Medicine> exactGeneric = candidates.stream()
                    .filter(m -> normalize(m.getGenericName()).equals(normalize(item.genericName())))
                    .filter(m -> compatible(m, item)).toList();
            if (exactGeneric.size() == 1) return new Match("GENERIC_STRENGTH_FORM", exactGeneric.getFirst());
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
