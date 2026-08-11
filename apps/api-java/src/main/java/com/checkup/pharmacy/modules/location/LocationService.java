package com.checkup.pharmacy.modules.location;

import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.util.StableSort;
import com.checkup.pharmacy.modules.location.dto.CreateRackRequest;
import com.checkup.pharmacy.modules.location.dto.CreateShelfRequest;
import com.checkup.pharmacy.modules.location.dto.ListEnvelope;
import com.checkup.pharmacy.modules.location.dto.RackResponse;
import com.checkup.pharmacy.modules.location.dto.ShelfResponse;
import com.checkup.pharmacy.modules.location.dto.UpdateRackRequest;
import com.checkup.pharmacy.modules.location.dto.UpdateShelfRequest;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Rack/shelf location management, scoped to the caller's pharmacy. Codes are
 * unique per pharmacy for both racks and shelves (enforced here; the DB also
 * carries a unique constraint as the final backstop).
 */
@Service
public class LocationService {

    private final RackRepository rackRepository;
    private final ShelfRepository shelfRepository;

    public LocationService(RackRepository rackRepository, ShelfRepository shelfRepository) {
        this.rackRepository = rackRepository;
        this.shelfRepository = shelfRepository;
    }

    // ── Racks ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ListEnvelope<RackResponse> listRacks(boolean includeInactive, int page, int limit) {
        String pharmacyId = TenantContext.pharmacyId();
        PageRequest pageRequest = pageRequest(page, limit, "code");
        Page<Rack> result = rackRepository.list(pharmacyId, includeInactive, pageRequest);

        List<Rack> racks = result.getContent();
        List<String> rackIds = racks.stream().map(Rack::getId).toList();
        Map<String, List<String>> shelfIdsByRack = shelfRepository.findByRackIdInAndPharmacyId(rackIds, pharmacyId)
                .stream()
                .collect(Collectors.groupingBy(Shelf::getRackId,
                        Collectors.mapping(Shelf::getId, Collectors.toList())));

        List<RackResponse> items = racks.stream()
                .map(r -> toRackResponse(r, shelfIdsByRack.getOrDefault(r.getId(), List.of())))
                .toList();
        return new ListEnvelope<>(items, result.getTotalElements(), page, result.getTotalPages());
    }

    @Transactional
    public RackResponse createRack(CreateRackRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        String code = normalizeCode(req.code());
        if (rackRepository.existsByPharmacyIdAndCode(pharmacyId, code)) {
            throw new ConflictException("A rack with this code already exists");
        }
        Rack rack = Rack.create(pharmacyId, code, req.name().trim());
        rack.applyFields(code, req.name().trim(), blankToNull(req.aisle()));
        rackRepository.save(rack);
        return toRackResponse(rack, List.of());
    }

    @Transactional
    public RackResponse updateRack(String id, UpdateRackRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        Rack rack = rackRepository.findByIdAndPharmacyId(id, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Rack not found"));

        // blankToNull, not a bare "code != null" check: an explicitly-empty string
        // ("") must NOT silently blank out a required field — treat it the same as
        // "field omitted" (leave unchanged), matching StaffService's convention.
        String code = blankToNull(req.code());
        if (code != null) {
            code = normalizeCode(code);
            if (rackRepository.existsByPharmacyIdAndCodeAndIdNot(pharmacyId, code, id)) {
                throw new ConflictException("A rack with this code already exists");
            }
        }

        rack.applyFields(code, blankToNull(req.name()),
                req.aisle() != null ? blankToNull(req.aisle()) : rack.getAisle());
        if (req.isActive() != null) {
            rack.setActive(req.isActive());
        }

        List<String> shelfIds = shelfRepository.findByRackIdAndPharmacyId(rack.getId(), pharmacyId)
                .stream().map(Shelf::getId).toList();
        return toRackResponse(rack, shelfIds);
    }

    // ── Shelves ──────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ListEnvelope<ShelfResponse> listShelves(boolean includeInactive, int page, int limit) {
        PageRequest pageRequest = pageRequest(page, limit, "code");
        Page<Shelf> result = shelfRepository.list(TenantContext.pharmacyId(), includeInactive, pageRequest);

        // Batch-fetch every referenced rack in one query instead of one findById()
        // per shelf — a page of 50 shelves previously meant 51 queries, now 2.
        List<Shelf> shelves = result.getContent();
        List<String> rackIds = shelves.stream().map(Shelf::getRackId).distinct().toList();
        Map<String, Rack> racksById = rackRepository.findAllById(rackIds).stream()
                .collect(Collectors.toMap(Rack::getId, r -> r));

        List<ShelfResponse> items = shelves.stream()
                .map(s -> toShelfResponse(s, racksById.get(s.getRackId())))
                .toList();
        return new ListEnvelope<>(items, result.getTotalElements(), page, result.getTotalPages());
    }

    @Transactional
    public ShelfResponse createShelf(CreateShelfRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        Rack rack = rackRepository.findByIdAndPharmacyId(req.rackId(), pharmacyId)
                .orElseThrow(() -> new NotFoundException("Rack not found"));

        String code = normalizeCode(req.code());
        if (shelfRepository.existsByPharmacyIdAndCode(pharmacyId, code)) {
            throw new ConflictException("A shelf with this code already exists");
        }

        Shelf shelf = Shelf.create(pharmacyId, rack.getId(), code, req.level());
        shelf.applyFields(code, req.level(), blankToNull(req.description()));
        shelfRepository.save(shelf);
        return toShelfResponse(shelf, rack);
    }

    @Transactional
    public ShelfResponse updateShelf(String id, UpdateShelfRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        Shelf shelf = shelfRepository.findByIdAndPharmacyId(id, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Shelf not found"));

        // blankToNull: an explicitly-empty string ("") must not silently blank out
        // this required field — treat it as "field omitted" (leave unchanged).
        String code = blankToNull(req.code());
        if (code != null) {
            code = normalizeCode(code);
            if (shelfRepository.existsByPharmacyIdAndCodeAndIdNot(pharmacyId, code, id)) {
                throw new ConflictException("A shelf with this code already exists");
            }
        }

        shelf.applyFields(code, req.level(),
                req.description() != null ? blankToNull(req.description()) : shelf.getDescription());
        if (req.isActive() != null) {
            shelf.setActive(req.isActive());
        }
        // Single-entity endpoint, not a list — one lookup here is not an N+1 concern.
        Rack rack = rackRepository.findById(shelf.getRackId()).orElse(null);
        return toShelfResponse(shelf, rack);
    }

    // ── Mapping / helpers ────────────────────────────────────────────────────

    private PageRequest pageRequest(int page, int limit, String sortField) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 500);
        return PageRequest.of(safePage - 1, safeLimit, StableSort.of(Sort.by(sortField).ascending()));
    }

    private String normalizeCode(String raw) {
        return raw.trim().toUpperCase(Locale.ROOT);
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private RackResponse toRackResponse(Rack r, List<String> shelfIds) {
        return new RackResponse(r.getId(), r.getCode(), r.getName(), r.getAisle(), r.isActive(),
                shelfIds.stream().map(RackResponse.ShelfIdRef::new).toList());
    }

    private ShelfResponse toShelfResponse(Shelf s, Rack rack) {
        ShelfResponse.RackRef rackRef = rack == null
                ? null
                : new ShelfResponse.RackRef(rack.getId(), rack.getCode(), rack.getName());
        return new ShelfResponse(s.getId(), s.getCode(), s.getLevel(), s.getDescription(), s.isActive(),
                rackRef, new ShelfResponse.InventoryCount(0));
    }
}
