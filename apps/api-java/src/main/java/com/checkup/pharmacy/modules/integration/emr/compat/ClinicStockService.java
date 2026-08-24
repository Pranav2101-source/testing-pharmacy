package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.modules.integration.emr.EmrIntegrationService;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicStockResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchResponse;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.MedicineService;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Answers "do you have these?" while a doctor is still writing the prescription.
 *
 * <h2>Why this is a lookup and not a promise</h2>
 * Nothing is reserved. The answer is true when given and may be false by the time the
 * patient arrives, which is the correct trade: holding stock against a prescription that
 * may never be presented would make the pharmacy's own counter unsellable. The value is in
 * steering the prescription at the moment it is written, not in guaranteeing an outcome.
 *
 * <h2>Why a cap exists</h2>
 * This is an unprivileged-feeling convenience on a request path, and an uncapped name list
 * would let one caller ask about ten thousand medicines and turn a prescribing screen into a
 * denial of service against the pharmacy's own tills. Extra names are dropped and counted
 * rather than silently ignored, so a truncated answer can never read as a complete one.
 *
 * <h2>Matching is shared; classification is not</h2>
 * The matching itself is {@link EmrIntegrationService#matchMedicines}, the same engine the
 * native surface uses, and stays there. What this class adds on top is everything that only
 * a prescriber's screen needs — status, schedule, expiry, substitutes — which the match
 * engine has no reason to carry for its other callers.
 *
 * <p>That enrichment is not decoration. Until it existed the clinic received a quantity and
 * nothing else, and its badge (which switches on {@code stockStatus}) announced <i>"In stock
 * — 0 left"</i> for a medicine this pharmacy had run out of. See {@link ClinicStockResponse}.
 */
@Service
public class ClinicStockService {

    /** Comfortably above any real prescription; low enough that abuse costs nothing. */
    static final int MAX_NAMES = 50;

    /**
     * Most substitutes worth putting in front of someone mid-sentence. The clinic renders
     * three; a couple spare cover the ones it may filter out at its end.
     */
    static final int MAX_SUBSTITUTES = 5;

    private final EmrIntegrationService integrationService;
    private final PharmacyRepository pharmacyRepository;
    private final MedicineRepository medicineRepository;
    private final InventoryRepository inventoryRepository;

    public ClinicStockService(EmrIntegrationService integrationService,
                              PharmacyRepository pharmacyRepository,
                              MedicineRepository medicineRepository,
                              InventoryRepository inventoryRepository) {
        this.integrationService = integrationService;
        this.pharmacyRepository = pharmacyRepository;
        this.medicineRepository = medicineRepository;
        this.inventoryRepository = inventoryRepository;
    }

    @Transactional(readOnly = true)
    public ClinicStockResponse lookup(List<String> names) {
        List<String> requested = names == null ? List.of() : names;

        // De-duplicated, but keyed by the name AS SENT so every requested entry can be
        // answered in the caller's own words. Two spellings of one medicine are two
        // questions to whoever asked, even when they resolve to the same row here.
        Map<String, String> byRequestedName = new LinkedHashMap<>();
        int omitted = 0;
        for (String name : requested) {
            if (name == null || name.isBlank()) {
                omitted++;
                continue;
            }
            if (byRequestedName.size() >= MAX_NAMES && !byRequestedName.containsKey(name)) {
                omitted++;
                continue;
            }
            byRequestedName.putIfAbsent(name, name.trim());
        }

        String pharmacyId = TenantContext.pharmacyId();
        String pharmacyName = pharmacyRepository.findById(pharmacyId)
                .map(p -> p.getName()).orElse(null);

        if (byRequestedName.isEmpty()) {
            return new ClinicStockResponse(pharmacyName, List.of(), omitted);
        }

        // externalItemId is the vehicle for the requested name: the match engine echoes it
        // back untouched, which is exactly the correlation this needs.
        List<EmrMedicineMatchRequest.Item> matchItems = new ArrayList<>();
        for (Map.Entry<String, String> entry : byRequestedName.entrySet()) {
            matchItems.add(new EmrMedicineMatchRequest.Item(
                    entry.getKey(), null, entry.getValue(), null, null, null));
        }

        EmrMedicineMatchResponse matched =
                integrationService.matchMedicines(new EmrMedicineMatchRequest(matchItems));

        Instant now = Instant.now();
        List<String> medicineIds = matched.items().stream()
                .map(EmrMedicineMatchResponse.Item::medicineId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();

        // Two batched reads for the whole request, not one pair per line: the catalogue rows
        // (for schedule and manufacturer, which the match engine does not carry) and the live
        // batches (for expiry and for the status classification).
        Map<String, Medicine> catalogue = medicineIds.isEmpty() ? Map.of()
                : medicineRepository.findAllById(medicineIds).stream()
                        .collect(Collectors.toMap(Medicine::getId, Function.identity()));
        Map<String, List<Inventory>> batches = batchesFor(pharmacyId, medicineIds, now);

        List<Stocked> stocked = new ArrayList<>();
        for (EmrMedicineMatchResponse.Item item : matched.items()) {
            // Branched on null rather than looked up with one: an unmatched line has no
            // medicine id, and Map.of() — which both maps are whenever nothing matched at all
            // — throws on a null key rather than returning nothing.
            String id = item.medicineId();
            stocked.add(new Stocked(item,
                    id == null ? null : catalogue.get(id),
                    id == null ? List.of() : batches.getOrDefault(id, List.of())));
        }

        Map<String, List<ClinicStockResponse.Substitute>> substitutes =
                substitutesFor(pharmacyId, stocked, now);

        List<ClinicStockResponse.Item> items = new ArrayList<>();
        for (Stocked s : stocked) {
            items.add(new ClinicStockResponse.Item(
                    s.match.externalItemId(),
                    s.matched(),
                    s.match.medicineId(),
                    s.match.name(),
                    s.match.genericName(),
                    s.match.strength(),
                    s.match.form(),
                    s.match.unit(),
                    s.medicine == null ? null : s.medicine.getManufacturer(),
                    s.medicine == null ? null : s.medicine.getSchedule(),
                    s.match.availableQuantity(),
                    s.match.approximatePrice(),
                    s.status(),
                    s.earliestSellableExpiry(),
                    substitutes.getOrDefault(s.match.externalItemId(), List.of())));
        }
        return new ClinicStockResponse(pharmacyName, items, omitted);
    }

    /** Searches medicines belonging to this pharmacy and returns their live stock in one shape. */
    @Transactional(readOnly = true)
    public ClinicStockResponse search(String query, int limit) {
        int safeLimit = Math.min(Math.max(limit, 1), MAX_NAMES);
        String term = query == null || query.trim().isEmpty() ? null : query.trim();
        List<String> names = inventoryRepository.searchMedicineNames(
                TenantContext.pharmacyId(), term, PageRequest.of(0, safeLimit));
        return lookup(names);
    }

    /**
     * Same-generic alternatives, but only for the lines that need them.
     *
     * <p>Restricted to drugs that are themselves short, for two reasons. On the screen, an
     * alternative offered beside a medicine the pharmacy has plenty of is noise in the middle
     * of someone typing. Underneath, {@link MedicineRepository#findAlternatives} is one query
     * per source medicine — bounded here by how many lines are actually short (in practice
     * zero or one, since the clinic asks about a single name per request), rather than by how
     * many lines the prescription has.
     *
     * <p>The candidates' own stock is then resolved in a single batched read for the whole
     * request, so the fan-out stops at that first query.
     */
    private Map<String, List<ClinicStockResponse.Substitute>> substitutesFor(
            String pharmacyId, List<Stocked> stocked, Instant now) {

        Map<String, List<Medicine>> candidatesByItem = new LinkedHashMap<>();
        Set<String> candidateIds = new LinkedHashSet<>();
        for (Stocked s : stocked) {
            if (!s.matched() || "in_stock".equals(s.status())) {
                continue;
            }
            String generic = s.match.genericName();
            if (generic == null || generic.isBlank()) {
                // Nothing to substitute against: without a generic name, "same composition"
                // has no meaning here and any list would be a guess dressed as a suggestion.
                continue;
            }
            List<Medicine> alternatives = medicineRepository.findAlternatives(
                    generic, s.match.strength(), s.match.form(), s.match.medicineId());
            if (alternatives.isEmpty()) {
                continue;
            }
            candidatesByItem.put(s.match.externalItemId(), alternatives);
            alternatives.forEach(m -> candidateIds.add(m.getId()));
        }
        if (candidateIds.isEmpty()) {
            return Map.of();
        }

        Map<String, List<Inventory>> batches = batchesFor(pharmacyId, List.copyOf(candidateIds), now);

        Map<String, List<ClinicStockResponse.Substitute>> result = new LinkedHashMap<>();
        candidatesByItem.forEach((externalItemId, alternatives) -> {
            List<ClinicStockResponse.Substitute> offered = alternatives.stream()
                    .map(m -> {
                        List<Inventory> stock = batches.getOrDefault(m.getId(), List.of());
                        return new ClinicStockResponse.Substitute(m.getId(), m.getName(),
                                m.getManufacturer(), m.getStrength(), m.getForm(), m.getSchedule(),
                                sellableQuantity(stock), lowestSellableMrp(stock));
                    })
                    // Only what can be handed over today — see the record's javadoc.
                    .filter(sub -> sub.availableQuantity() > 0)
                    .sorted(Comparator.comparingInt(ClinicStockResponse.Substitute::availableQuantity).reversed())
                    .limit(MAX_SUBSTITUTES)
                    .toList();
            if (!offered.isEmpty()) {
                result.put(externalItemId, offered);
            }
        });
        return result;
    }

    private Map<String, List<Inventory>> batchesFor(String pharmacyId, List<String> medicineIds, Instant now) {
        if (medicineIds.isEmpty()) {
            return Map.of();
        }
        return inventoryRepository.findActiveNonExpiredByMedicineIdIn(pharmacyId, medicineIds, now).stream()
                .collect(Collectors.groupingBy(Inventory::getMedicineId));
    }

    private static int sellableQuantity(List<Inventory> batches) {
        return batches.stream().mapToInt(ClinicStockService::sellable).sum();
    }

    private static BigDecimal lowestSellableMrp(List<Inventory> batches) {
        return batches.stream()
                .filter(b -> sellable(b) > 0)
                .map(Inventory::getMrp)
                .filter(Objects::nonNull)
                .min(BigDecimal::compareTo)
                .orElse(null);
    }

    /** On hand minus reserved, floored: a batch oversold on paper must not eat another batch's stock. */
    private static int sellable(Inventory batch) {
        return Math.max(0, batch.getQuantity() - batch.getReservedQuantity());
    }

    /** One requested line, plus everything the pharmacy knows about what it resolved to. */
    private record Stocked(EmrMedicineMatchResponse.Item match, Medicine medicine, List<Inventory> batches) {

        boolean matched() {
            return match.medicineId() != null;
        }

        /**
         * <b>{@code unknown} is the unmatched case and nothing else.</b> A name the catalogue
         * does not list is a different fact from a medicine that has run out, prompts a
         * different action from the prescriber, and must never be reported as a stock level.
         *
         * <p>The threshold is {@link MedicineService#LOW_STOCK_QTY} — the pharmacy's own
         * definition, so a clinic's badge and this pharmacy's alternatives drawer never
         * disagree about the same shelf.
         */
        String status() {
            if (!matched()) {
                return "unknown";
            }
            int available = match.availableQuantity();
            if (available <= 0) {
                return "out_of_stock";
            }
            return available <= MedicineService.LOW_STOCK_QTY ? "low_stock" : "in_stock";
        }

        /**
         * Soonest expiry among batches that can actually be sold. Batches with nothing
         * sellable left are excluded: reporting the expiry of stock already spoken for would
         * warn a doctor off a course the pharmacy can fill from elsewhere.
         */
        Instant earliestSellableExpiry() {
            return batches.stream()
                    .filter(b -> sellable(b) > 0)
                    .map(Inventory::getExpiryDate)
                    .filter(Objects::nonNull)
                    .min(Instant::compareTo)
                    .orElse(null);
        }
    }
}
