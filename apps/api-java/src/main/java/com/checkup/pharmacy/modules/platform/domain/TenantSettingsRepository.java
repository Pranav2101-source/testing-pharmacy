package com.checkup.pharmacy.modules.platform.domain;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface TenantSettingsRepository extends JpaRepository<TenantSettings, String> {

    Optional<TenantSettings> findByPharmacyId(String pharmacyId);

    /** Batched settings for a set of tenants — avoids an N+1 in the subscription list. */
    List<TenantSettings> findByPharmacyIdIn(Collection<String> pharmacyIds);
}
