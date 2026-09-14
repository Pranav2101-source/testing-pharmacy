package com.checkup.pharmacy.modules.cashclosure;

import com.checkup.pharmacy.common.enums.ClosureStatus;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.modules.billing.PaymentMixReader;
import com.checkup.pharmacy.modules.cashclosure.dto.CashClosurePageResponse;
import com.checkup.pharmacy.modules.cashclosure.dto.CashClosureResponse;
import com.checkup.pharmacy.modules.cashclosure.dto.CloseCashClosureRequest;
import com.checkup.pharmacy.modules.cashclosure.dto.CreateCashClosureRequest;
import com.checkup.pharmacy.modules.cashclosure.dto.UpdateCashClosureRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Daily cash-drawer reconciliation, scoped to the caller's pharmacy. One row per
 * pharmacy per {@code closureDate}, enforced by a unique constraint.
 *
 * <p>Sales totals are RECOMPUTED on every open, edit, and close, rather than being
 * captured once when the closure row is created.
 *
 * <p>This class previously did the opposite, on the reasoning that a closure should
 * stay a stable historical record. That is a fair goal, but it was applied a step too
 * early: the figures were frozen when someone OPENED the form, not when they closed
 * the till. A closure started before the last customer of the day reconciled against
 * a sales total that stopped counting at that moment, and every later sale surfaced
 * as unexplained surplus cash — on the single number an owner uses to judge whether
 * money has gone missing. The record becomes stable at {@code close()}, which is the
 * point at which the day is actually over.
 */
@Service
public class CashClosureService {

    private static final ZoneOffset IST = ZoneOffset.ofHoursMinutes(5, 30);

    private final CashClosureRepository repository;
    private final PaymentMixReader paymentMix;
    private final UserRepository userRepository;

    public CashClosureService(CashClosureRepository repository, PaymentMixReader paymentMix,
                              UserRepository userRepository) {
        this.repository = repository;
        this.paymentMix = paymentMix;
        this.userRepository = userRepository;
    }

    @Transactional
    public CashClosureResponse initForDate(CreateCashClosureRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        String userId = TenantContext.userId();
        LocalDate closureDate = req.closureDate() != null ? req.closureDate() : LocalDate.now(IST);

        if (repository.findByPharmacyIdAndClosureDate(pharmacyId, closureDate).isPresent()) {
            throw new ConflictException("A cash closure for " + closureDate + " already exists");
        }

        SalesBreakdown sales = salesFor(pharmacyId, closureDate);

        BigDecimal expectedCash = req.openingCashOrZero().add(sales.cash());
        BigDecimal variance = req.actualCashOrZero().subtract(expectedCash);

        CashClosure closure = CashClosure.create(pharmacyId, userId, closureDate, req.openingCashOrZero(), sales.cash(),
                sales.upi(), sales.card(), sales.credit(), sales.wallet(), sales.advance(), expectedCash,
                req.actualCashOrZero(), variance, req.notes());
        repository.save(closure);

        return toResponse(closure, userRepository.findById(userId).orElse(null));
    }

    @Transactional(readOnly = true)
    public CashClosureResponse getById(String id) {
        CashClosure closure = load(id);
        return toResponse(closure, userRepository.findById(closure.getUserId()).orElse(null));
    }

    @Transactional(readOnly = true)
    public CashClosurePageResponse list(String status, LocalDate from, LocalDate to, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Page<CashClosure> result = repository.search(TenantContext.pharmacyId(), blankToNull(status),
                DateRange.from(from), DateRange.to(to), PageRequest.of(safePage - 1, safeLimit));

        Map<String, String> userNames = new HashMap<>();
        for (User u : userRepository.findAllById(result.getContent().stream().map(CashClosure::getUserId).distinct().toList())) {
            userNames.put(u.getId(), u.getName());
        }
        List<CashClosureResponse> items = result.getContent().stream()
                .map(c -> toResponse(c, userNames.get(c.getUserId())))
                .toList();

        return new CashClosurePageResponse(items, result.getTotalElements(), safePage, safeLimit, result.getTotalPages());
    }

    @Transactional
    public CashClosureResponse update(String id, UpdateCashClosureRequest req) {
        CashClosure closure = load(id);
        if (closure.getStatus() == ClosureStatus.CLOSED) {
            throw new ConflictException("Cannot edit a closed cash closure");
        }
        BigDecimal openingCash = req.openingCash() != null ? req.openingCash() : closure.getOpeningCash();
        BigDecimal actualCash = req.actualCash() != null ? req.actualCash() : closure.getActualCash();

        // Same refresh as close(): editing a draft mid-day must not reconcile against
        // a sales figure frozen when the draft was opened.
        SalesBreakdown sales = salesFor(closure.getPharmacyId(), closure.getClosureDate());
        closure.restateSales(sales.cash(), sales.upi(), sales.card(), sales.credit(), sales.wallet(), sales.advance());

        BigDecimal expectedCash = openingCash.add(sales.cash());
        BigDecimal variance = actualCash.subtract(expectedCash);

        closure.applyDraftEdit(openingCash, actualCash, expectedCash, variance, req.notes());
        return toResponse(closure, userRepository.findById(closure.getUserId()).orElse(null));
    }

    @Transactional
    public CashClosureResponse close(String id, CloseCashClosureRequest req) {
        CashClosure closure = load(id);
        if (closure.getStatus() == ClosureStatus.CLOSED) {
            throw new ConflictException("Already closed");
        }

        // Re-read the day's takings rather than trusting what was captured when the
        // closure was opened. Reconciling against the opening snapshot meant every
        // sale made between opening the form and closing the till was invisible, and
        // surfaced as unexplained surplus cash — on the one number an owner uses to
        // judge whether money has gone missing.
        SalesBreakdown sales = salesFor(closure.getPharmacyId(), closure.getClosureDate());
        closure.restateSales(sales.cash(), sales.upi(), sales.card(), sales.credit(), sales.wallet(), sales.advance());

        BigDecimal expectedCash = closure.getOpeningCash().add(sales.cash());
        BigDecimal variance = req.actualCash().subtract(expectedCash);

        closure.close(req.actualCash(), expectedCash, variance, req.notes());
        return toResponse(closure, userRepository.findById(closure.getUserId()).orElse(null));
    }

    /** The day's takings split by how they were paid for. */
    private record SalesBreakdown(BigDecimal cash, BigDecimal upi, BigDecimal card,
                                  BigDecimal credit, BigDecimal wallet, BigDecimal advance) {
    }

    /**
     * Reads one pharmacy's takings for a calendar day, in IST.
     *
     * <p>Extracted so opening and closing a till compute the same figures the same
     * way. Previously only the opening path computed them and closing reused whatever
     * had been stored, which is what let the two disagree.
     *
     * <p>TWO DIFFERENT QUESTIONS, ANSWERED DIFFERENTLY
     * <p>`cash` is CASH RECEIVED today, because it is reconciled against a physical
     * drawer. It is the sum of two things: invoices settled in cash at the till, and
     * cash collected today against invoices raised earlier — a customer paying down a
     * credit account. The latter used to be invisible here (its parent invoice counts
     * under `credit`, on whatever date it was raised), so every settlement appeared as
     * unexplained surplus cash.
     *
     * <p>The other three settled modes are read the same way, and this is a change: they
     * used to be SALES BY MODE — the whole of a bill's total, filed under the single mode
     * it named. That stopped being expressible once a bill could be settled two ways at
     * once, and the failure was not a rounding difference: a Rs.1000 bill split Rs.600 UPI
     * and Rs.400 cash would have booked the FULL Rs.1000 under whichever mode happened to
     * be the larger leg, so one figure was inflated by a payment it never received while
     * the other silently lost one. All four now report money received.
     *
     * <p>`credit` is the one that cannot: nothing is received on a credit sale. It reports
     * what the day's bills put on customers' accounts, which is the figure it was always
     * standing in for.
     *
     * <p>DEPOSITS COUNT HERE, ON THE DAY THEY ARE TAKEN
     * <p>A customer handing over Rs.2000 as an advance puts Rs.2000 of real cash in this
     * drawer against no bill at all. Read from invoices alone that money is invisible, and
     * shows up at closing as unexplained surplus — the identical failure that credit
     * settlements used to cause. So the four received modes also carry the day's advance
     * movements, net of refunds handed back out of the same drawer.
     *
     * <p>`advance` is the mirror of that and must NOT be added to the drawer: it is what
     * the day's bills drew FROM deposits. That cash arrived on some earlier day and was
     * counted then. Reported separately so the owner can see why a day's billing exceeds
     * its takings without reaching for a calculator.
     */
    private SalesBreakdown salesFor(String pharmacyId, LocalDate closureDate) {
        Instant from = closureDate.atStartOfDay(IST).toInstant();
        Instant to = from.plus(1, ChronoUnit.DAYS).minusMillis(1);

        Map<PaymentMode, PaymentMixReader.ModeTotal> mix = paymentMix.mix(pharmacyId, from, to);
        Map<PaymentMode, PaymentMixReader.ModeTotal> deposits = paymentMix.advanceMovements(pharmacyId, from, to);
        return new SalesBreakdown(
                received(mix, deposits, PaymentMode.CASH),
                received(mix, deposits, PaymentMode.UPI),
                received(mix, deposits, PaymentMode.CARD),
                paymentMix.amountOf(mix, PaymentMode.CREDIT),
                received(mix, deposits, PaymentMode.WALLET),
                paymentMix.amountOf(mix, PaymentMode.ADVANCE));
    }

    /** Money that arrived by one mode today: settled bills plus deposits, less refunds. */
    private BigDecimal received(Map<PaymentMode, PaymentMixReader.ModeTotal> mix,
                                Map<PaymentMode, PaymentMixReader.ModeTotal> deposits,
                                PaymentMode mode) {
        return paymentMix.amountOf(mix, mode).add(paymentMix.amountOf(deposits, mode));
    }

    @Transactional
    public CashClosureResponse dispute(String id) {
        CashClosure closure = load(id);
        if (closure.getStatus() != ClosureStatus.CLOSED) {
            throw new ConflictException("Can only dispute a closed closure");
        }
        closure.dispute();
        return toResponse(closure, userRepository.findById(closure.getUserId()).orElse(null));
    }

    private CashClosure load(String id) {
        return repository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Cash closure not found"));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private CashClosureResponse toResponse(CashClosure c, User user) {
        return toResponse(c, user == null ? null : user.getName());
    }

    private CashClosureResponse toResponse(CashClosure c, String userName) {
        CashClosureResponse.UserRef userRef = userName == null ? null : new CashClosureResponse.UserRef(c.getUserId(), userName);
        return new CashClosureResponse(c.getId(), userRef, c.getClosureDate(), c.getOpeningCash(), c.getCashSales(),
                c.getUpiSales(), c.getCardSales(), c.getCreditSales(), c.getWalletSales(), c.getAdvanceSales(),
                c.getExpectedCash(), c.getActualCash(), c.getVariance(), c.getNotes(), c.getStatus().name(),
                c.getClosedAt(), c.getCreatedAt());
    }
}
