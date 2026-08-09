package com.checkup.pharmacy.modules.prescription;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PrescriptionItemRepository extends JpaRepository<PrescriptionItem, String> {

    List<PrescriptionItem> findByPrescriptionId(String prescriptionId);

    /**
     * Items for a page of prescriptions in one query.
     *
     * <p>The list endpoint called {@link #findByPrescriptionId} once per row, so a
     * 100-row page issued 100 of them. Callers group the result by prescriptionId.
     *
     * <p>pharmacyId is a parameter rather than being taken on trust from the ids: the
     * ids come from a tenant-scoped page today, but a batch finder that scopes only by
     * its input is one refactor away from reading another pharmacy's rows. See
     * TenantIsolationGuardTest, which fails the build without this.
     */
    List<PrescriptionItem> findByPharmacyIdAndPrescriptionIdIn(String pharmacyId,
                                                               java.util.Collection<String> prescriptionIds);

    void deleteByPrescriptionId(String prescriptionId);
}
