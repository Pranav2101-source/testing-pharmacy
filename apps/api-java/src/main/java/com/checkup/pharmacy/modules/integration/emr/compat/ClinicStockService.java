package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.modules.integration.emr.EmrIntegrationService;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicStockResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrMedicineMatchResponse;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
 * <p>Translation only — the matching itself is
 * {@link EmrIntegrationService#matchMedicines}, the same engine the native surface uses.
 */
@Service
public class ClinicStockService {

    /** Comfortably above any real prescription; low enough that abuse costs nothing. */
    static final int MAX_NAMES = 50;

    private final EmrIntegrationService integrationService;
    private final PharmacyRepository pharmacyRepository;

    public ClinicStockService(EmrIntegrationService integrationService,
                              PharmacyRepository pharmacyRepository) {
        this.integrationService = integrationService;
        this.pharmacyRepository = pharmacyRepository;
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

        String pharmacyName = pharmacyRepository.findById(TenantContext.pharmacyId())
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

        List<ClinicStockResponse.Item> items = new ArrayList<>();
        for (EmrMedicineMatchResponse.Item item : matched.items()) {
            boolean isMatched = item.medicineId() != null;
            items.add(new ClinicStockResponse.Item(
                    item.externalItemId(),
                    isMatched,
                    item.medicineId(),
                    item.name(),
                    item.genericName(),
                    item.strength(),
                    item.form(),
                    item.unit(),
                    item.availableQuantity(),
                    item.approximatePrice()));
        }
        return new ClinicStockResponse(pharmacyName, items, omitted);
    }
}
