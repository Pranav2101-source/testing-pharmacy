package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.customerledger.dto.AdvanceReceiptResponse;
import com.checkup.pharmacy.modules.customerledger.dto.CustomerBalancesResponse;
import com.checkup.pharmacy.modules.customerledger.dto.CustomerLedgerEntryResponse;
import com.checkup.pharmacy.modules.customerledger.dto.CustomerStatementResponse;
import com.checkup.pharmacy.modules.customerledger.dto.RecordAdvanceRequest;
import com.checkup.pharmacy.modules.customerledger.dto.RefundAdvanceRequest;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The counter-facing half of the customer ledger: deposits, refunds and statements.
 *
 * <p>{@link CustomerLedgerService} owns the money — sign discipline, the customer row
 * lock, and the cached-balance writes. This class owns everything around it that the
 * ledger has no business knowing: which tenant is asking, what the voucher is
 * numbered, and what shape the screen wants back. Keeping them apart is what lets the
 * ledger stay callable from inside {@code createInvoice}'s transaction without
 * dragging a document sequence or a DTO along.
 */
@Service
public class CustomerAccountService {

    /**
     * Ways money can actually arrive at, or leave, the counter.
     *
     * <p>CREDIT is excluded because a deposit paid "on credit" is not a deposit — it
     * is a promise, and the khata already records those. ADVANCE is excluded because
     * it would mean funding a deposit from the same deposit.
     */
    private static final Set<PaymentMode> SETTLEMENT_MODES =
            EnumSet.of(PaymentMode.CASH, PaymentMode.UPI, PaymentMode.CARD, PaymentMode.WALLET);

    private final CustomerLedgerService ledgerService;
    private final CustomerLedgerEntryRepository ledgerRepository;
    private final CustomerRepository customerRepository;
    private final DocumentSequenceService sequenceService;

    public CustomerAccountService(CustomerLedgerService ledgerService,
                                  CustomerLedgerEntryRepository ledgerRepository,
                                  CustomerRepository customerRepository,
                                  DocumentSequenceService sequenceService) {
        this.ledgerService = ledgerService;
        this.ledgerRepository = ledgerRepository;
        this.customerRepository = customerRepository;
        this.sequenceService = sequenceService;
    }

    /**
     * Take a deposit. The voucher number is allocated inside this transaction, so a
     * failed deposit returns its number rather than burning it.
     */
    @Transactional
    public AdvanceReceiptResponse recordAdvance(String customerId, RecordAdvanceRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        Customer customer = load(pharmacyId, customerId);
        PaymentMode mode = settlementMode(req.paymentMode());

        String number = DocumentNumberFormat.customerAdvance(
                sequenceService.next(pharmacyId, DocumentSequenceService.CUSTOMER_ADVANCE,
                        DocumentSequenceService.PERIOD_ALL));

        CustomerLedgerEntry entry = ledgerService.postAdvance(pharmacyId, customerId, req.amount(), mode,
                number, req.reference(), req.notes(), null, TenantContext.userId());

        return new AdvanceReceiptResponse(CustomerLedgerEntryResponse.from(entry), balancesOf(customer));
    }

    /** Hand an advance back. The ledger refuses to return more than is held. */
    @Transactional
    public AdvanceReceiptResponse refundAdvance(String customerId, RefundAdvanceRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        Customer customer = load(pharmacyId, customerId);
        PaymentMode mode = settlementMode(req.paymentMode());

        String number = DocumentNumberFormat.customerRefund(
                sequenceService.next(pharmacyId, DocumentSequenceService.CUSTOMER_REFUND,
                        DocumentSequenceService.PERIOD_ALL));

        CustomerLedgerEntry entry = ledgerService.postRefund(pharmacyId, customerId, req.amount(), mode,
                number, req.notes(), TenantContext.userId());

        return new AdvanceReceiptResponse(CustomerLedgerEntryResponse.from(entry), balancesOf(customer));
    }

    @Transactional(readOnly = true)
    public CustomerStatementResponse statement(String customerId, int page, int limit) {
        String pharmacyId = TenantContext.pharmacyId();
        Customer customer = load(pharmacyId, customerId);

        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        // Ordering lives in the query (by seq, never entryAt) — see findStatement.
        Page<CustomerLedgerEntry> result = ledgerRepository.findStatement(pharmacyId, customerId,
                PageRequest.of(safePage - 1, safeLimit));

        List<CustomerLedgerEntryResponse> items = result.getContent().stream()
                .map(CustomerLedgerEntryResponse::from)
                .toList();
        return new CustomerStatementResponse(items, result.getTotalElements(), safePage, safeLimit,
                result.getTotalPages(), balancesOf(customer));
    }

    @Transactional(readOnly = true)
    public CustomerBalancesResponse balances(String customerId) {
        return balancesOf(load(TenantContext.pharmacyId(), customerId));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Customer load(String pharmacyId, String customerId) {
        return customerRepository.findByIdAndPharmacyIdAndDeletedAtIsNull(customerId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Customer not found"));
    }

    /**
     * Read from the managed Customer rather than re-querying: after a posting in this
     * same transaction the entity already carries the new balances, and a second read
     * would either return the same instance or, worse, look like it might not.
     */
    private CustomerBalancesResponse balancesOf(Customer c) {
        BigDecimal available = c.getCreditLimit().subtract(c.getCreditUsed()).max(BigDecimal.ZERO);
        return new CustomerBalancesResponse(c.getId(), c.getName(), c.getCreditUsed(), c.getAdvanceBalance(),
                c.getCreditLimit(), available);
    }

    private static PaymentMode settlementMode(String raw) {
        PaymentMode mode;
        try {
            mode = PaymentMode.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("\"" + raw + "\" is not a way money can change hands. "
                    + "Use Cash, UPI, Card or Wallet.");
        }
        if (!SETTLEMENT_MODES.contains(mode)) {
            throw new BadRequestException("A deposit cannot be taken as " + mode.name().toLowerCase(Locale.ROOT)
                    + " — no money would change hands. Use Cash, UPI, Card or Wallet.");
        }
        return mode;
    }
}
