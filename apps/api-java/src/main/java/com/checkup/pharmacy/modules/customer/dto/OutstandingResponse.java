package com.checkup.pharmacy.modules.customer.dto;

import com.checkup.pharmacy.modules.customer.Customer;

import java.math.BigDecimal;
import java.util.List;

/** Receivables list for the Dues page — matches the frontend's ReceivablesResp shape. */
public record OutstandingResponse(List<Item> customers, BigDecimal totalOutstanding, int count) {

    public record Item(String id, String name, String phone, String customerType, BigDecimal creditUsed,
                       BigDecimal creditLimit) {
        static Item from(Customer c) {
            return new Item(c.getId(), c.getName(), c.getPhone(), c.getCustomerType().name(),
                    c.getCreditUsed(), c.getCreditLimit());
        }
    }

    public static OutstandingResponse from(List<Customer> customers) {
        List<Item> items = customers.stream().map(Item::from).toList();
        BigDecimal total = customers.stream().map(Customer::getCreditUsed).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new OutstandingResponse(items, total, items.size());
    }
}
