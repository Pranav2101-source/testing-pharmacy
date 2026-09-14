package com.checkup.pharmacy.modules.customer.dto;

import com.checkup.pharmacy.modules.customer.Customer;

import java.math.BigDecimal;
import java.util.List;

/**
 * Receivables list for the Dues page — matches the frontend's ReceivablesResp shape.
 *
 * <p>{@code totalOutstanding} is what customers owe; {@code totalAdvanceHeld} is what
 * the pharmacy is holding for them. They are reported separately and never netted: one
 * is an asset to collect, the other a liability to honour, and a single combined figure
 * would hide whichever is smaller.
 */
public record OutstandingResponse(List<Item> customers, BigDecimal totalOutstanding,
                                  BigDecimal totalAdvanceHeld, int count) {

    /**
     * {@code advanceBalance} rides along because this is the screen where a customer's
     * money is handled: a customer can owe on an old bill while holding a deposit, and a
     * cashier about to chase them for the first should be able to see the second.
     */
    public record Item(String id, String name, String phone, String customerType, BigDecimal creditUsed,
                       BigDecimal creditLimit, BigDecimal advanceBalance) {
        static Item from(Customer c) {
            return new Item(c.getId(), c.getName(), c.getPhone(), c.getCustomerType().name(),
                    c.getCreditUsed(), c.getCreditLimit(), c.getAdvanceBalance());
        }
    }

    public static OutstandingResponse from(List<Customer> customers) {
        List<Item> items = customers.stream().map(Item::from).toList();
        BigDecimal total = customers.stream().map(Customer::getCreditUsed).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal advances = customers.stream().map(Customer::getAdvanceBalance)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new OutstandingResponse(items, total, advances, items.size());
    }
}
