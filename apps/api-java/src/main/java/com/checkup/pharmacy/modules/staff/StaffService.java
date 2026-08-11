package com.checkup.pharmacy.modules.staff;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.validation.ValidationPatterns;
import com.checkup.pharmacy.modules.staff.dto.CreateStaffRequest;
import com.checkup.pharmacy.modules.staff.dto.StaffMemberResponse;
import com.checkup.pharmacy.modules.staff.dto.UpdateStaffRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Staff (team member) management, scoped to the caller's pharmacy. Every read
 * and write is bounded by {@link TenantContext#pharmacyId()} — the controller
 * additionally restricts every endpoint to OWNER via {@code @PreAuthorize}.
 *
 * The one invariant enforced everywhere here: a pharmacy can never be left with
 * zero active owners, or its account becomes unmanageable.
 */
@Service
public class StaffService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public StaffService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional(readOnly = true)
    public List<StaffMemberResponse> list() {
        return userRepository.findByPharmacyIdOrderByCreatedAtAsc(TenantContext.pharmacyId())
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional
    public StaffMemberResponse create(CreateStaffRequest req) {
        if (req.role() == Role.OWNER) {
            throw new BadRequestException("New staff cannot be created as Owner — promote them after creation");
        }
        if (userRepository.existsByEmail(req.email())) {
            throw new ConflictException("An account with this email already exists");
        }

        // Phone normalised to the bare 10 digits, the shape registration writes, so
        // "+91 98765 43210" and "09876543210" cannot land in the column as three
        // different strings for one number. (Email is normalised by User.create.)
        User user = User.create(
                TenantContext.pharmacyId(),
                req.name().trim(),
                req.email(),
                ValidationPatterns.normalizeMobile(req.phone()),
                passwordEncoder.encode(req.password()),
                req.role());
        userRepository.save(user);
        return toResponse(user);
    }

    @Transactional
    public StaffMemberResponse update(String id, UpdateStaffRequest req) {
        User user = load(id);

        if (req.name() != null && !req.name().isBlank()) {
            user.rename(req.name().trim());
        }
        if (req.phone() != null) {
            user.setPhone(ValidationPatterns.normalizeMobile(req.phone()));
        }
        if (req.role() != null && req.role() != user.getRole()) {
            if (isLastActiveOwner(user) && req.role() != Role.OWNER) {
                throw new BadRequestException("At least one active owner is required");
            }
            user.changeRole(req.role());
        }
        if (req.isActive() != null && req.isActive() != user.isActive()) {
            if (!req.isActive() && isLastActiveOwner(user)) {
                throw new BadRequestException("At least one active owner is required");
            }
            if (req.isActive()) {
                user.activate();
            } else {
                user.deactivate();
            }
        }

        return toResponse(user);
    }

    @Transactional
    public void deactivate(String id) {
        User user = load(id);
        if (isLastActiveOwner(user)) {
            throw new BadRequestException("At least one active owner is required");
        }
        user.deactivate();
    }

    private User load(String id) {
        return userRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Staff member not found"));
    }

    /** True if this user is currently the pharmacy's only active owner. */
    private boolean isLastActiveOwner(User user) {
        if (user.getRole() != Role.OWNER || !user.isActive()) {
            return false;
        }
        long activeOwners = userRepository.countByPharmacyIdAndRoleAndIsActive(
                user.getPharmacyId(), Role.OWNER, true);
        return activeOwners <= 1;
    }

    private StaffMemberResponse toResponse(User u) {
        return new StaffMemberResponse(
                u.getId(),
                u.getName(),
                u.getEmail(),
                u.getPhone(),
                u.getRole().name(),
                u.isActive(),
                u.getLastLoginAt(),
                u.getCreatedAt());
    }
}
