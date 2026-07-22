package com.checkup.pharmacy.modules.support;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TicketCategoryRepository extends JpaRepository<TicketCategory, String> {

    List<TicketCategory> findByIsActiveTrueOrderBySortOrderAsc();
}
