package com.checkup.pharmacy.modules.purchase;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface GRNItemRepository extends JpaRepository<GRNItem, String> {

    List<GRNItem> findByGrnId(String grnId);

    List<GRNItem> findByGrnIdIn(List<String> grnIds);

    void deleteByGrnId(String grnId);
}
