package com.checkup.pharmacy.modules.platform.tenant;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.enums.SubscriptionStatus;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.platform.domain.Subscription;
import com.checkup.pharmacy.modules.platform.domain.SubscriptionRepository;
import com.checkup.pharmacy.modules.platform.domain.TenantSettings;
import com.checkup.pharmacy.modules.platform.domain.TenantSettingsRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Provisions a complete tenant in one transaction: {@link Pharmacy} +
 * {@link Subscription} + {@link TenantSettings} and, optionally, an OWNER
 * {@link User}. Ported from the deleted Node {@code PharmacyOnboardingService}.
 *
 * Shared on purpose — the platform tenant-create/import flows use it now, and the
 * E6 seed/bootstrap path can reuse it later, so the "how a tenant comes into
 * existence" logic (tenant code allocation, default plan/settings, uniqueness
 * guards) lives in exactly one place.
 *
 * The caller supplies an already-hashed owner password; this service never sees
 * the plaintext. Audit rows use {@link AuditService#log} (REQUIRED) so they join
 * this transaction and can see the just-created (still-uncommitted) pharmacy row —
 * a REQUIRES_NEW audit tx would fail the FK check (the Tier 4 registration bug).
 */
@Service
public class PharmacyOnboardingService {

    private static final Pattern TENANT_CODE = Pattern.compile("TEN-(\\d+)");
    private static final Pattern NON_SLUG = Pattern.compile("[^a-z0-9-]");
    private static final Pattern SPACES = Pattern.compile("\\s+");
    private static final int TRIAL_DAYS = 30;

    private final PharmacyRepository pharmacyRepository;
    private final UserRepository userRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final TenantSettingsRepository tenantSettingsRepository;
    private final AuditService auditService;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public PharmacyOnboardingService(PharmacyRepository pharmacyRepository, UserRepository userRepository,
                                     SubscriptionRepository subscriptionRepository,
                                     TenantSettingsRepository tenantSettingsRepository, AuditService auditService,
                                     com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.pharmacyRepository = pharmacyRepository;
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.tenantSettingsRepository = tenantSettingsRepository;
        this.auditService = auditService;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    /** Everything the onboarding created, returned by direct reference (no lazy re-read). */
    public record OnboardResult(Pharmacy pharmacy, Subscription subscription, TenantSettings settings, User owner) {
    }

    /**
     * Onboard a tenant from the PLATFORM ADMIN path, where a duplicate pharmacy name is
     * rejected — an admin typing a name that already exists is almost certainly creating
     * the same tenant twice.
     */
    @Transactional
    public OnboardResult onboard(OnboardCommand cmd, String actorUserId, String actorEmail) {
        return onboard(cmd, actorUserId, actorEmail, true);
    }

    /**
     * As above, with the name-uniqueness rule made explicit.
     *
     * <p>WHY PUBLIC SIGNUP PASSES {@code false}
     *
     * <p>Pharmacy names are not unique in the real world. Two Apollo branches, or two
     * MedPlus franchises in different cities, are separate tenants that legitimately share
     * a name. The signup path never enforced uniqueness — it called
     * {@code Pharmacy.create(name, uniqueSlug(name))}, making the SLUG unique and leaving
     * the NAME free — and routing signup through this service silently inherited a rule
     * written for a different flow. The result was a 409 on any pharmacy whose name was
     * already taken by an unrelated business, which is most of the common ones.
     *
     * <p>The only thing that must be unique is the slug, which is the column carrying the
     * database constraint; {@code buildSlug} already makes it so.
     *
     * @param enforceUniqueName true for admin-initiated onboarding, false for public signup
     */
    @Transactional
    public OnboardResult onboard(OnboardCommand cmd, String actorUserId, String actorEmail,
                                 boolean enforceUniqueName) {
        // Onboarding is the one create-flow in this codebase that provisions a
        // pharmacy + subscription + owner login all at once, and — unlike every
        // other create endpoint (customer, supplier, PO, quotation, ticket, ...) —
        // it had no duplicate-submit guard at all. A double-click on "Create Tenant"
        // or a client retry after a slow response would silently create two
        // pharmacies with the same name: the only thing guarding against a
        // duplicate name is the plain check below, which has no DB constraint
        // backing it (see the comment on that check) and no lock, so two identical
        // submissions both pass it.
        duplicateSubmitGuard.guard("platform.tenant.onboard", cmd);

        // Pharmacy name has no DB uniqueness constraint — enforce it here (matches Node)
        // for the admin path only. See the javadoc for why signup must not.
        if (enforceUniqueName && pharmacyRepository.existsByNameIgnoreCase(cmd.name())) {
            throw new ConflictException("A pharmacy with this name already exists");
        }
        if (cmd.createOwner()) {
            // User.email is globally unique in the DB, but check up front for a friendly 409.
            if (userRepository.existsByEmail(cmd.ownerEmail())) {
                throw new ConflictException("This email is already registered.");
            }
        }

        String planName = cmd.planName() == null ? PlanPricing.DEFAULT_PLAN : cmd.planName();
        String billingCycle = cmd.billingCycle() == null ? PlanPricing.DEFAULT_BILLING_CYCLE : cmd.billingCycle();
        double amount = PlanPricing.amountFor(planName, billingCycle);
        Instant validUntil = Instant.now().plus(TRIAL_DAYS, ChronoUnit.DAYS);
        String tenantCode = nextTenantCode();

        Pharmacy pharmacy = Pharmacy.create(cmd.name(), buildSlug(cmd.name()));
        pharmacy.setTenantCode(tenantCode);
        pharmacy.setGstin(cmd.gstin());
        pharmacy.setDrugLicense(cmd.drugLicense());
        pharmacy.setPhone(cmd.phone());
        pharmacy.setEmail(cmd.email());
        pharmacy.setAddress(cmd.address());
        pharmacy.setCity(cmd.city());
        pharmacy.setState(cmd.state());
        pharmacy.setPincode(cmd.pincode());
        pharmacyRepository.save(pharmacy);

        Subscription subscription = Subscription.create(pharmacy.getId(), planName, SubscriptionStatus.ACTIVE,
                billingCycle, amount, validUntil);
        subscriptionRepository.save(subscription);

        TenantSettings settings = TenantSettings.create(pharmacy.getId(),
                cmd.doctorLimit(), cmd.staffLimit(), cmd.patientLimit(), cmd.storageLimit(),
                cmd.enableBilling(), cmd.enableInventory(), cmd.enableEmr(), cmd.enableCrm(),
                cmd.enableWhatsapp(), cmd.enableSms(), cmd.enableApiAccess(), cmd.enableOnlineBooking());
        tenantSettingsRepository.save(settings);

        User owner = null;
        if (cmd.createOwner()) {
            owner = User.create(pharmacy.getId(), cmd.ownerName(), cmd.ownerEmail(), cmd.ownerPhone(),
                    cmd.ownerPasswordHash(), Role.OWNER);
            userRepository.save(owner);
        }

        auditService.log(AuditEntry.of(AuditModule.TENANTS, "TENANT_CREATED", "PHARMACY")
                .pharmacyId(pharmacy.getId()).userId(actorUserId).userEmail(actorEmail)
                .entityId(pharmacy.getId()).resourceName(pharmacy.getName())
                .newData(Map.of("tenantCode", tenantCode, "name", pharmacy.getName(), "plan", planName)));
        auditService.log(AuditEntry.of(AuditModule.SUBSCRIPTIONS, "SUBSCRIPTION_CREATED", "SUBSCRIPTION")
                .pharmacyId(pharmacy.getId()).userId(actorUserId).userEmail(actorEmail)
                .entityId(subscription.getId()).newData(Map.of("plan", planName)));

        return new OnboardResult(pharmacy, subscription, settings, owner);
    }

    private String nextTenantCode() {
        long next = pharmacyRepository.findFirstByTenantCodeIsNotNullOrderByTenantCodeDesc()
                .map(Pharmacy::getTenantCode)
                .map(code -> {
                    Matcher m = TENANT_CODE.matcher(code);
                    return m.find() ? Long.parseLong(m.group(1)) + 1 : 1L;
                })
                .orElse(1L);
        return String.format("TEN-%06d", next);
    }

    private static String buildSlug(String name) {
        String base = SPACES.matcher(name.toLowerCase()).replaceAll("-");
        base = NON_SLUG.matcher(base).replaceAll("");
        if (base.length() > 50) {
            base = base.substring(0, 50);
        }
        return base + "-" + Instant.now().toEpochMilli();
    }
}
