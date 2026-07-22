package com.checkup.pharmacy.modules.billing;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SalesReturnItemRepository extends JpaRepository<SalesReturnItem, String> {

    List<SalesReturnItem> findByReturnId(String returnId);

    /** Every return line ever raised against this invoice, across all its returns — used for the over-return guard. */
    @Query("SELECT sri FROM SalesReturnItem sri WHERE sri.returnId IN (SELECT sr.id FROM SalesReturn sr WHERE sr.invoiceId = :invoiceId)")
    List<SalesReturnItem> findByInvoiceId(@Param("invoiceId") String invoiceId);
}
