package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.enums.CustomerLedgerEntryType;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.util.GstCalculator;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * The only writer of {@link CustomerLedgerEntry}, and the only place that moves
 * {@code Customer.creditUsed} / {@code Customer.advanceBalance}.
 *
 * <p>WHY THIS IS A CHOKE POINT
 * <p>Those two scalars are caches of {@code SUM(duesDelta)} and
 * {@code SUM(advanceDelta)}. Before this class they were mutated from four
 * scattered call sites in {@code BillingService} with no history behind them, and
 * the mutations disagreed with reality in two provable ways: a partial payment
 * never decremented {@code creditUsed} at all, and return/cancel reversals
 * subtracted the document's full value while ignoring what the customer had
 * already paid. Once such a value drifts there is nothing to recompute it from.
 *
 * <p>So every write goes through {@link #post}, which in one transaction: takes
 * the customer's row lock, applies both deltas to the cached scalars, snapshots
 * the resulting balances onto the entry, and saves it. Ledger and cache cannot
 * disagree because nothing can write one without the other.
 *
 * <p>SIGN DISCIPLINE
 * <p>Callers never compute a delta. They call the typed {@code postX} method for
 * the business event that happened, and the sign convention for that event lives
 * here, once. {@code amount} on the entry is always a positive magnitude — the
 * money that moved, as printed on a voucher — because a signed amount made an
 * ADVANCE (which moves the advance balance, not dues) look to any report summing
 * that column like a reduction in what the customer owed.
 *
 * <p>LOCKING
 * <p>Every method that writes loads the customer through
 * {@link CustomerRepository#lockByIdAndPharmacyId}. Re-locking inside a
 * transaction that already holds the row is a no-op, so a caller that locked it
 * first (as {@code createInvoice} does for a credit sale) composes correctly and
 * operates on the same managed instance.
 */
@Service
public class CustomerLedgerService {

    /** A hundredth of a rupee — the tolerance for "these two money values are equal". */
    private static final BigDecimal PAISA = new BigDecimal("0.01");

    private final CustomerLedgerEntryRepository ledgerRepository;
    private final CustomerRepository customerRepository;

    public CustomerLedgerService(CustomerLedgerEntryRepository ledgerRepository,
                                 CustomerRepository customerRepository) {
        this.ledgerRepository = ledgerRepository;
        this.customerRepository = customerRepository;
    }

    // ── Business events ───────────────────────────────────────────────────────
    // One method per thing that can happen to a customer's money. The delta signs
    // are here and nowhere else.

    /**
     * The unpaid portion of a bill becomes a debt. Dues up.
     *
     * <p>Takes the UNPAID amount, not the bill total: a Rs.1000 bill settled with
     * Rs.600 cash at the counter puts Rs.400 on the khata, and passing the total
     * here would double-count the Rs.600 the customer already handed over.
     */
    @Transactional
    public CustomerLedgerEntry postSale(String pharmacyId, String customerId, String invoiceId,
                                        BigDecimal unpaidAmount, String userId) {
        return post(new Post(pharmacyId, customerId, CustomerLedgerEntryType.SALE, null, unpaidAmount,
                invoiceId, null, null, null, null, null, userId));
    }

    /** Money collected against dues. Dues down. */
    @Transactional
    public CustomerLedgerEntry postPayment(String pharmacyId, String customerId, String invoiceId,
                                           BigDecimal amount, PaymentMode mode, String entryNumber,
                                           String reference, String notes, Instant paidAt, String userId) {
        return post(new Post(pharmacyId, customerId, CustomerLedgerEntryType.PAYMENT, entryNumber, amount,
                invoiceId, null, mode, reference, notes, paidAt, userId));
    }

    /**
     * A deposit with no bill against it yet. Advance up, dues untouched.
     *
     * <p>Deliberately does NOT net against existing dues. A customer who owes
     * Rs.500 and hands over Rs.2000 for future purchases has done one thing, and
     * silently consuming Rs.500 of it would make the deposit receipt disagree with
     * the amount taken. Settling dues from an advance is a separate, visible act —
     * {@link #applyAdvance}.
     */
    @Transactional
    public CustomerLedgerEntry postAdvance(String pharmacyId, String customerId, BigDecimal amount,
                                            PaymentMode mode, String entryNumber, String reference,
                                            String notes, Instant receivedAt, String userId) {
        return post(new Post(pharmacyId, customerId, CustomerLedgerEntryType.ADVANCE, entryNumber, amount,
                null, null, mode, reference, notes, receivedAt, userId));
    }

    /**
     * Advance consumed by a bill: advance down AND dues down, in one entry.
     *
     * <p>Both balances move because the money is being handed from one pocket to
     * the other — the customer's credit with us pays down what they owe us. Two
     * separate entries would leave a window (and a statement line) in which the
     * money existed in neither place.
     */
    @Transactional
    public CustomerLedgerEntry applyAdvance(String pharmacyId, String customerId, String invoiceId,
                                             BigDecimal amount, String userId) {
        return post(new Post(pharmacyId, customerId, CustomerLedgerEntryType.ADVANCE_APPLIED, null, amount,
                invoiceId, null, null, null, null, null, userId));
    }

    /** Goods returned against a bill that is not fully paid. Dues down. */
    @Transactional
    public CustomerLedgerEntry postReturnCredit(String pharmacyId, String customerId, String invoiceId,
                                                 String salesReturnId, BigDecimal amount, String userId) {
        return post(new Post(pharmacyId, customerId, CustomerLedgerEntryType.RETURN_CREDIT, null, amount,
                invoiceId, salesReturnId, null, null, null, null, userId));
    }

    /** Advance handed back in cash. Advance down. */
    @Transactional
    public CustomerLedgerEntry postRefund(String pharmacyId, String customerId, BigDecimal amount,
                                           PaymentMode mode, String entryNumber, String notes, String userId) {
        return post(new Post(pharmacyId, customerId, CustomerLedgerEntryType.REFUND, entryNumber, amount,
                null, null, mode, null, notes, null, userId));
    }

    /** Bad debt written off. Dues down with no money received — owner-authorised. */
    @Transactional
    public CustomerLedgerEntry postWriteOff(String pharmacyId, String customerId, BigDecimal amount,
                                             String entryNumber, String notes, String userId) {
        if (notes == null || notes.isBlank()) {
            // A write-off destroys a receivable and no money arrives to explain it.
            // The reason is the only audit trail it will ever have.
            throw new BadRequestException("A write-off needs a reason");
        }
        return post(new Post(pharmacyId, customerId, CustomerLedgerEntryType.WRITE_OFF, entryNumber, amount,
                null, null, null, null, notes, null, userId));
    }

    /**
     * Backfill baseline — records history for the dues/advance a customer's
     * CACHED balance already shows from before this ledger existed. One per
     * customer, and always the earliest entry.
     *
     * <p>DOES NOT TAKE AN AMOUNT. It reads {@code Customer.creditUsed} /
     * {@code advanceBalance} at call time and snapshots exactly that — it must
     * NEVER add to them. An earlier version of this method took the opening
     * amount as a parameter and ran it through the normal {@code write()} path,
     * which calls {@code customer.adjustCreditUsed(delta)}. Against a real
     * customer whose cache already held Rs.50 from the old, pre-ledger code path,
     * backfilling with duesAmount=50 would have pushed the cache to Rs.100 —
     * silently doubling every real customer's balance the moment the backfill
     * ran. Caught before it reached production by checking this exact customer's
     * real data, not by a test (every IT test happened to seed customers at
     * creditUsed=0, where add-on-top and set-to are indistinguishable).
     *
     * <p>Refuses a second OPENING for the same customer: run twice, it would
     * still be wrong — the second call would snapshot whatever the balance had
     * moved to since, as if that whole amount pre-dated the ledger.
     */
    @Transactional
    public CustomerLedgerEntry postOpening(String pharmacyId, String customerId, String userId) {
        if (ledgerRepository.existsByPharmacyIdAndCustomerIdAndType(
                pharmacyId, customerId, CustomerLedgerEntryType.OPENING)) {
            throw new UnprocessableEntityException(
                    "An opening balance already exists for this customer — the backfill has already run.");
        }
        // Locking load even though this method never calls adjustCreditUsed /
        // adjustAdvanceBalance: it still reads-then-writes a derived row, and the
        // lock is what stops that read from racing a concurrent sale on the same
        // customer between the read and the save below.
        Customer customer = customerRepository.lockByIdAndPharmacyId(customerId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Customer not found"));

        BigDecimal dues = GstCalculator.round2(customer.getCreditUsed());
        BigDecimal advance = GstCalculator.round2(customer.getAdvanceBalance());
        if (dues.signum() < 0 || advance.signum() < 0) {
            throw new BadRequestException("Cannot backfill a negative balance for " + customer.getName()
                    + " — fix the underlying data first");
        }
        if (dues.signum() == 0 && advance.signum() == 0) {
            throw new BadRequestException("Nothing to backfill for " + customer.getName()
                    + " — both balances are already zero");
        }

        // amount is the magnitude this entry is "worth" for display; with both a
        // dues and an advance side possible, the dues side is the meaningful one.
        BigDecimal magnitude = dues.signum() != 0 ? dues : advance;

        // Built directly, NOT through write()/post() — those add a delta to the
        // customer's current balance, and here the current balance IS the value
        // being recorded. duesBalanceAfter/advanceBalanceAfter therefore equal
        // the delta itself: the running total after this, the only, prior entry.
        CustomerLedgerEntry entry = CustomerLedgerEntry.create(pharmacyId, customerId,
                CustomerLedgerEntryType.OPENING, null, magnitude, dues, advance, dues, advance,
                null, null, null, null, "Opening balance carried into the ledger", null, userId);
        return ledgerRepository.save(entry);
    }

    // ── The single write path ─────────────────────────────────────────────────

    /** Everything a posting needs; assembled by the typed methods above. */
    private record Post(String pharmacyId, String customerId, CustomerLedgerEntryType type, String entryNumber,
                        BigDecimal amount, String invoiceId, String salesReturnId, PaymentMode paymentMode,
                        String reference, String notes, Instant entryAt, String createdBy) {}

    /**
     * Derives both deltas from the event type, so the amount on an entry and its
     * effect on the balances cannot disagree.
     *
     * <p>An earlier cut had each typed method pass its own pre-signed delta
     * alongside the raw amount. That let the two drift apart — {@code postSale}
     * normalised the delta with {@code abs()} but handed the amount through
     * untouched, so a negative input produced a positive debt with a negative
     * amount printed next to it. Deriving both from one validated magnitude here
     * removes the possibility.
     */
    private CustomerLedgerEntry post(Post p) {
        BigDecimal amount = GstCalculator.round2(require(p.amount(), "amount"));
        if (amount.signum() <= 0) {
            // Zero would be a statement line that changes nothing. Negative means the
            // caller computed something wrong — a balance subtracted the wrong way
            // round — and quietly taking abs() would book a debt that may not exist.
            // Money fails loudly here.
            throw new BadRequestException("A ledger entry must move a positive amount");
        }

        BigDecimal dues = switch (p.type()) {
            case SALE -> amount;
            case PAYMENT, ADVANCE_APPLIED, RETURN_CREDIT, WRITE_OFF -> amount.negate();
            case ADVANCE, REFUND -> BigDecimal.ZERO;
            case OPENING -> throw new IllegalStateException("OPENING is written through postOpening");
        };
        BigDecimal advance = switch (p.type()) {
            case ADVANCE -> amount;
            case ADVANCE_APPLIED, REFUND -> amount.negate();
            case SALE, PAYMENT, RETURN_CREDIT, WRITE_OFF -> BigDecimal.ZERO;
            case OPENING -> throw new IllegalStateException("OPENING is written through postOpening");
        };

        return write(p.pharmacyId(), p.customerId(), p.type(), p.entryNumber(), amount, dues, advance,
                p.invoiceId(), p.salesReturnId(), p.paymentMode(), p.reference(), p.notes(),
                p.entryAt(), p.createdBy());
    }

    /**
     * Locks the customer, applies both deltas to the cached scalars, snapshots the
     * resulting balances onto the entry and saves it — the only code that touches
     * either balance.
     */
    private CustomerLedgerEntry write(String pharmacyId, String customerId, CustomerLedgerEntryType type,
                                      String entryNumber, BigDecimal amount, BigDecimal duesDeltaRaw,
                                      BigDecimal advanceDeltaRaw, String invoiceId, String salesReturnId,
                                      PaymentMode paymentMode, String reference, String notes,
                                      Instant entryAt, String createdBy) {
        BigDecimal duesDelta = GstCalculator.round2(duesDeltaRaw == null ? BigDecimal.ZERO : duesDeltaRaw);
        BigDecimal advanceDelta = GstCalculator.round2(advanceDeltaRaw == null ? BigDecimal.ZERO : advanceDeltaRaw);
        if (duesDelta.signum() == 0 && advanceDelta.signum() == 0) {
            throw new BadRequestException("A ledger entry must move at least one balance");
        }

        // Locking load: this is a read-modify-write of two balances with no @Version
        // on Customer. Two tills settling the same khata would otherwise both read the
        // old balance and the second write would silently discard the first.
        Customer customer = customerRepository.lockByIdAndPharmacyId(customerId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Customer not found"));

        BigDecimal duesAfter = GstCalculator.round2(customer.getCreditUsed().add(duesDelta));
        BigDecimal advanceAfter = GstCalculator.round2(customer.getAdvanceBalance().add(advanceDelta));

        // A negative advance would mean we handed back money we never held. Caught
        // here rather than in each caller so applyAdvance and postRefund cannot
        // disagree about the rule.
        if (advanceAfter.signum() < 0) {
            throw new UnprocessableEntityException(
                    "Only Rs." + customer.getAdvanceBalance() + " advance is held for " + customer.getName()
                    + " — cannot apply Rs." + amount + ".");
        }

        // A negative dues balance means we owe THEM, which is an advance, not a
        // negative debt. Forcing the caller to record it as one keeps a single
        // meaning for each balance; otherwise "dues" quietly becomes signed and every
        // receivables report has to learn about it.
        if (duesAfter.signum() < 0) {
            throw new UnprocessableEntityException(
                    "Rs." + amount + " is more than the Rs." + customer.getCreditUsed() + " outstanding for "
                    + customer.getName() + ". Settle the dues and record the excess as an advance.");
        }

        customer.adjustCreditUsed(duesDelta);
        customer.adjustAdvanceBalance(advanceDelta);

        CustomerLedgerEntry entry = CustomerLedgerEntry.create(pharmacyId, customerId, type,
                blankToNull(entryNumber), amount, duesDelta, advanceDelta, duesAfter, advanceAfter,
                blankToNull(invoiceId), blankToNull(salesReturnId), paymentMode,
                blankToNull(reference), blankToNull(notes), entryAt, createdBy);
        return ledgerRepository.save(entry);
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /** What a customer owes, and what we hold for them. */
    public record Balances(BigDecimal dues, BigDecimal advance, BigDecimal creditLimit, BigDecimal creditAvailable) {}

    @Transactional(readOnly = true)
    public Balances balances(String pharmacyId, String customerId) {
        Customer c = customerRepository.findByIdAndPharmacyIdAndDeletedAtIsNull(customerId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Customer not found"));
        // Clamped at zero: a customer already over their limit would otherwise report
        // negative headroom, which reads as a bug rather than as "no credit left".
        BigDecimal available = c.getCreditLimit().subtract(c.getCreditUsed()).max(BigDecimal.ZERO);
        return new Balances(c.getCreditUsed(), c.getAdvanceBalance(), c.getCreditLimit(), available);
    }

    /** One customer's drift: cached scalars vs the ledger they are meant to cache. */
    public record Drift(String customerId, String customerName, BigDecimal cachedDues, BigDecimal ledgerDues,
                        BigDecimal cachedAdvance, BigDecimal ledgerAdvance) {

        public BigDecimal duesDrift() { return cachedDues.subtract(ledgerDues); }

        public BigDecimal advanceDrift() { return cachedAdvance.subtract(ledgerAdvance); }
    }

    /**
     * Every customer in the tenant whose cached balances disagree with their ledger.
     * Expected to be empty; it exists so that expectation is verifiable, and so a
     * drift surfaces in a report rather than in a customer dispute.
     */
    @Transactional(readOnly = true)
    public List<Drift> findDrift(String pharmacyId) {
        List<Drift> out = new ArrayList<>();
        for (Object[] row : ledgerRepository.findDrift(pharmacyId)) {
            out.add(new Drift((String) row[0], (String) row[1], (BigDecimal) row[2], (BigDecimal) row[3],
                    (BigDecimal) row[4], (BigDecimal) row[5]));
        }
        return out;
    }

    /**
     * True when the cached scalars match the ledger for this customer, within a
     * paisa. The tolerance is deliberate: both sides are Decimal(12,2) and every
     * write is rounded through {@code round2}, so an exact mismatch means a real
     * accounting error, but comparing BigDecimals for equality across a SUM that
     * Postgres may return at a different scale would otherwise report false drift.
     */
    @Transactional(readOnly = true)
    public boolean isReconciled(String pharmacyId, String customerId) {
        Customer c = customerRepository.findByIdAndPharmacyIdAndDeletedAtIsNull(customerId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Customer not found"));
        List<Object[]> sums = ledgerRepository.sumDeltas(pharmacyId, customerId);
        BigDecimal dues = sums.isEmpty() ? BigDecimal.ZERO : (BigDecimal) sums.get(0)[0];
        BigDecimal advance = sums.isEmpty() ? BigDecimal.ZERO : (BigDecimal) sums.get(0)[1];
        return c.getCreditUsed().subtract(dues).abs().compareTo(PAISA) < 0
                && c.getAdvanceBalance().subtract(advance).abs().compareTo(PAISA) < 0;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static BigDecimal require(BigDecimal v, String field) {
        if (v == null) {
            throw new BadRequestException(field + " is required");
        }
        return v;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }
}
