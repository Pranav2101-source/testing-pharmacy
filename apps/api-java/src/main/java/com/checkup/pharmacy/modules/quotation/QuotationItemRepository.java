package com.checkup.pharmacy.modules.quotation;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface QuotationItemRepository extends JpaRepository<QuotationItem, String> {

    List<QuotationItem> findByQuotationId(String quotationId);

    List<QuotationItem> findByQuotationIdIn(List<String> quotationIds);

    void deleteByQuotationId(String quotationId);
}
