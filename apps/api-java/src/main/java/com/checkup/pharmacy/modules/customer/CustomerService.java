package com.checkup.pharmacy.modules.customer;

import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.util.StableSort;
import com.checkup.pharmacy.common.validation.ValidationPatterns;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.customer.dto.CustomerPageResponse;
import com.checkup.pharmacy.modules.customer.dto.CustomerRequest;
import com.checkup.pharmacy.modules.customer.dto.CustomerResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Customer management, scoped to the caller's pharmacy. Every read and write is
 * bounded by {@link TenantContext#pharmacyId()}.
 */
@Service
public class CustomerService {

    private final CustomerRepository customerRepository;
    private final InvoiceRepository invoiceRepository;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public CustomerService(CustomerRepository customerRepository, InvoiceRepository invoiceRepository,
                           com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.customerRepository = customerRepository;
        this.invoiceRepository = invoiceRepository;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    @Transactional(readOnly = true)
    public com.checkup.pharmacy.modules.customer.dto.OutstandingResponse listOutstanding() {
        return com.checkup.pharmacy.modules.customer.dto.OutstandingResponse.from(
                customerRepository.findOutstanding(TenantContext.pharmacyId()));
    }

    @Transactional(readOnly = true)
    public CustomerPageResponse list(String search, String customerTypeRaw, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        PageRequest pageRequest = PageRequest.of(safePage - 1, safeLimit, StableSort.of(Sort.by("name").ascending()));

        CustomerType customerType = parseCustomerType(customerTypeRaw, false);
        String customerTypeParam = customerType == null ? null : customerType.name();
        Page<Customer> result = customerRepository.search(
                TenantContext.pharmacyId(), blankToNull(search), customerTypeParam, pageRequest);

        Map<String, Long> invoiceCounts = invoiceCounts(result.getContent().stream().map(Customer::getId).toList());
        var items = result.getContent().stream().map(c -> toResponse(c, invoiceCounts.getOrDefault(c.getId(), 0L))).toList();
        return new CustomerPageResponse(items, result.getTotalElements(), safePage, safeLimit, result.getTotalPages());
    }

    @Transactional
    public CustomerResponse create(CustomerRequest req) {
        duplicateSubmitGuard.guard("customer.create", req);
        String pharmacyId = TenantContext.pharmacyId();
        String cardNumber = blankToNull(req.cardNumber());
        if (cardNumber != null && customerRepository.existsByPharmacyIdAndCardNumberAndDeletedAtIsNull(pharmacyId, cardNumber)) {
            throw new ConflictException("A customer with this card number already exists");
        }

        Customer customer = Customer.create(pharmacyId, ValidationPatterns.normalizeName(req.name()));
        applyRequest(customer, req, cardNumber);
        customerRepository.save(customer);
        return toResponse(customer, 0L);
    }

    @Transactional
    public CustomerResponse update(String id, CustomerRequest req) {
        Customer customer = load(id);
        String pharmacyId = TenantContext.pharmacyId();
        String cardNumber = blankToNull(req.cardNumber());
        if (cardNumber != null
                && customerRepository.existsByPharmacyIdAndCardNumberAndDeletedAtIsNullAndIdNot(pharmacyId, cardNumber, id)) {
            throw new ConflictException("A customer with this card number already exists");
        }

        applyRequest(customer, req, cardNumber);
        return toResponse(customer, invoiceCounts(List.of(customer.getId())).getOrDefault(customer.getId(), 0L));
    }

    @Transactional(readOnly = true)
    public CustomerResponse getById(String id) {
        Customer customer = load(id);
        return toResponse(customer, invoiceCounts(List.of(customer.getId())).getOrDefault(customer.getId(), 0L));
    }

    private Map<String, Long> invoiceCounts(List<String> customerIds) {
        if (customerIds.isEmpty()) {
            return Map.of();
        }
        Map<String, Long> counts = new HashMap<>();
        for (InvoiceRepository.CustomerInvoiceCountRow row : invoiceRepository.countByCustomerIdIn(TenantContext.pharmacyId(), customerIds)) {
            counts.put(row.getCustomerId(), row.getTotal());
        }
        return counts;
    }

    @Transactional
    public void softDelete(String id) {
        Customer customer = load(id);
        // findOutstanding() (the receivables report) filters deletedAt IS NULL, same
        // as every other read here — so deleting a customer who still owes money
        // does not forgive the debt (creditUsed is untouched), it just stops the
        // report from showing it. The money is still owed; the pharmacy would simply
        // stop being reminded to collect it. Same principle as cancelInvoice
        // refusing to cancel an invoice with payments already collected.
        if (customer.getCreditUsed().compareTo(new BigDecimal("0.01")) > 0) {
            throw new ConflictException("Cannot delete " + customer.getName() + " — they owe Rs."
                    + customer.getCreditUsed() + ". Collect or clear the balance first.");
        }
        // The mirror of the check above, and the more serious direction of the two: an
        // unpaid debt that stops being chased costs the pharmacy money it might have
        // collected, but a deposit that disappears is money the pharmacy is holding for
        // somebody else. Every read filters deletedAt, so the balance would still be on
        // the books and simply invisible — until the customer came back for it.
        if (customer.getAdvanceBalance().compareTo(new BigDecimal("0.01")) > 0) {
            throw new ConflictException("Cannot delete " + customer.getName() + " — Rs."
                    + customer.getAdvanceBalance() + " is still held on deposit for them. "
                    + "Refund it or let them spend it first.");
        }
        customer.softDelete();
    }

    private void applyRequest(Customer customer, CustomerRequest req, String cardNumber) {
        // Normalise before storing: @IndianMobile tolerates "+91 98765 43210" so a
        // pasted number is not a user error, but the same person must not end up
        // stored two ways — customer lookup and duplicate detection both match on the
        // raw column. Names collapse repeated spaces for the same reason.
        customer.applyFields(
                ValidationPatterns.normalizeName(req.name()),
                blankToNull(ValidationPatterns.normalizeMobile(req.phone())),
                blankToNull(req.email()),
                blankToNull(req.address()),
                blankToNull(req.state()),
                parseDateOfBirth(req.dateOfBirth()),
                blankToNull(req.gender()),
                blankToNull(req.abhaNumber()),
                cardNumber,
                parseCustomerType(req.customerType(), true),
                req.defaultDiscount() == null ? BigDecimal.ZERO : req.defaultDiscount(),
                req.creditLimit() == null ? BigDecimal.ZERO : req.creditLimit(),
                blankToNull(req.notes()));
    }

    private Customer load(String id) {
        return customerRepository.findByIdAndPharmacyIdAndDeletedAtIsNull(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Customer not found"));
    }

    private CustomerType parseCustomerType(String raw, boolean defaultWalkIn) {
        if (raw == null || raw.isBlank()) {
            return defaultWalkIn ? CustomerType.WALK_IN : null;
        }
        try {
            return CustomerType.valueOf(raw);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Invalid customer type: " + raw);
        }
    }

    private Instant parseDateOfBirth(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(raw).atStartOfDay(java.time.ZoneOffset.UTC).toInstant();
        } catch (DateTimeParseException e) {
            throw new BadRequestException("dateOfBirth must be in YYYY-MM-DD format");
        }
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private CustomerResponse toResponse(Customer c, long invoiceCount) {
        return CustomerResponse.withInvoiceCount(
                c.getId(), c.getName(), c.getPhone(), c.getEmail(), c.getCustomerType().name(),
                c.getDefaultDiscount(), c.getCreditLimit(), c.getCreditUsed(), c.getAdvanceBalance(),
                c.getAbhaNumber(), c.getCardNumber(), c.getGender(), c.getDateOfBirth(), c.getAddress(),
                c.getState(), c.getNotes(), invoiceCount);
    }
}
