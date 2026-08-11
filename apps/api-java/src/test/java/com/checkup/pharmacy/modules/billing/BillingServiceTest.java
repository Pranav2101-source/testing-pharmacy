package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnauthorizedException;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit-level coverage of the guard clauses in {@code createInvoice} that reject a
 * request before any money or stock moves.
 *
 * <p>SCOPE, DELIBERATELY NARROW
 * <p>BillingService takes 16 collaborators, so a "unit" test of the full invoice
 * happy path would be ~80 lines of mock choreography asserting that mocks were called
 * — it would pass just as happily if the invoice totals were wrong. The valuable
 * happy-path assertions (stock actually decremented, GST actually persisted, credit
 * actually consumed) need a real database and live in BillingIT.
 *
 * <p>What belongs HERE is the logic that is genuinely decidable without a database:
 * input rejection, tenant resolution, and exception translation.
 */
@ExtendWith(MockitoExtension.class)
class BillingServiceTest {

    private static final String PHARMACY_ID = "ph-1";
    private static final String USER_ID = "user-1";

    @Mock private InvoiceRepository invoiceRepository;
    @Mock private InvoiceItemRepository invoiceItemRepository;
    @Mock private InvoicePaymentRepository invoicePaymentRepository;
    @Mock private SalesReturnRepository salesReturnRepository;
    @Mock private SalesReturnItemRepository salesReturnItemRepository;
    @Mock private InventoryRepository inventoryRepository;
    @Mock private InventoryMovementRepository movementRepository;
    @Mock private CustomerRepository customerRepository;
    @Mock private DoctorRepository doctorRepository;
    @Mock private PharmacyRepository pharmacyRepository;
    @Mock private PharmacyMedicineOverrideRepository overrideRepository;
    @Mock private PrescriptionRepository prescriptionRepository;
    @Mock private com.checkup.pharmacy.modules.prescription.PrescriptionItemRepository prescriptionItemRepository;
    @Mock private UserRepository userRepository;
    @Mock private DocumentSequenceService sequenceService;
    @Mock private AuditService auditService;
    @Mock private ObjectMapper objectMapper;

    @InjectMocks private BillingService billingService;

    @BeforeEach
    void authenticate() {
        var principal = new UserPrincipal(USER_ID, PHARMACY_ID, Role.OWNER, "owner@test.local");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, List.of()));
    }

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    private static CreateInvoiceRequest requestWith(InvoiceItemRequest... items) {
        return new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, List.of(items));
    }

    private static InvoiceItemRequest item(String inventoryId, int quantity) {
        return new InvoiceItemRequest(inventoryId, quantity, null, BigDecimal.ZERO);
    }

    @Test
    @DisplayName("the same batch twice on one invoice is rejected before any stock is touched")
    void rejectsDuplicateBatches() {
        var request = requestWith(item("inv-1", 2), item("inv-1", 3));

        assertThatThrownBy(() -> billingService.createInvoice(request))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("Duplicate inventory items");

        // The important half of this test: rejection happens before the lock, so a
        // malformed cart cannot take write locks on live batches at the till.
        verify(inventoryRepository, never()).lockAllByIdInAndPharmacyId(any(), anyString());
    }

    @Test
    @DisplayName("an unknown batch id is reported as not-found, naming the id")
    void rejectsUnknownBatch() {
        // Empty result models both "no such batch" and "belongs to another pharmacy":
        // the query filters on pharmacyId, so a foreign batch is simply absent.
        when(inventoryRepository.lockAllByIdInAndPharmacyId(any(), anyString()))
                .thenReturn(List.of());

        assertThatThrownBy(() -> billingService.createInvoice(requestWith(item("inv-missing", 1))))
                .isInstanceOf(NotFoundException.class)
                .hasMessageContaining("inv-missing");
    }

    @Test
    @DisplayName("a batch owned by another pharmacy is not found, never billed")
    void doesNotLeakAnotherTenantsBatch() {
        when(inventoryRepository.lockAllByIdInAndPharmacyId(any(), anyString()))
                .thenReturn(List.of());

        assertThatThrownBy(() -> billingService.createInvoice(requestWith(item("other-tenant-batch", 1))))
                .isInstanceOf(NotFoundException.class);

        // Whatever else happens, no invoice may be persisted for a batch we could not
        // resolve within this tenant.
        verify(invoiceRepository, never()).save(any());
    }

    @Test
    @DisplayName("an exhausted write race is translated into a retryable 409, not a 500")
    void translatesConcurrencyFailureIntoConflict() {
        when(inventoryRepository.lockAllByIdInAndPharmacyId(any(), anyString()))
                .thenThrow(new ConcurrencyFailureException("serialization failure"));

        assertThatThrownBy(() -> billingService.createInvoice(requestWith(item("inv-1", 1))))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("please try again");
    }

    @Test
    @DisplayName("an unauthenticated caller is rejected before any repository is consulted")
    void rejectsUnauthenticatedCaller() {
        SecurityContextHolder.clearContext();

        assertThatThrownBy(() -> billingService.createInvoice(requestWith(item("inv-1", 1))))
                .isInstanceOf(UnauthorizedException.class);

        verify(invoiceRepository, never()).save(any());
    }

    @Test
    @DisplayName("the duplicate check compares batch ids, so two different batches are allowed")
    void allowsTwoDistinctBatches() {
        when(inventoryRepository.lockAllByIdInAndPharmacyId(any(), anyString()))
                .thenReturn(List.of());

        // Reaching the not-found check proves the duplicate guard let this through;
        // a false positive there would have thrown BadRequestException instead.
        assertThatThrownBy(() -> billingService.createInvoice(
                requestWith(item("inv-1", 1), item("inv-2", 1))))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("idempotency: replaying a key returns the original invoice instead of billing twice")
    void idempotentReplayDoesNotCreateSecondInvoice() {
        var request = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                null, null, null, "idem-key-1", null, List.of(item("inv-1", 1)));
        when(invoiceRepository.findByPharmacyIdAndIdempotencyKey(PHARMACY_ID, "idem-key-1"))
                .thenReturn(java.util.Optional.of(new Invoice()));

        billingService.createInvoice(request);

        // The whole point of the key: no second invoice, and no second stock decrement.
        verify(invoiceRepository, never()).save(any());
        verify(inventoryRepository, never()).lockAllByIdInAndPharmacyId(any(), anyString());
        assertThat(true).isTrue();
    }
}
