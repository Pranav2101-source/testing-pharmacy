package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.enums.TicketStatus;
import com.checkup.pharmacy.common.exception.ForbiddenException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.support.dto.AddMessageRequest;
import com.checkup.pharmacy.modules.support.dto.CreateTicketRequest;
import com.checkup.pharmacy.modules.support.dto.UpdateStatusRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Support ticketing — the one module in this codebase whose users legitimately
 * span two audiences at once: pharmacy staff raising a problem, and platform
 * support agents who must see across every tenant to help with it.
 *
 * <p>Reviewing this module by reading it first (rather than only via failing
 * tests) found no active defects — the tenant/role boundary is applied
 * consistently everywhere a ticket, message or attachment is touched. These
 * tests exist to keep that true.
 *
 * <p>NOT {@code @Transactional}, unlike most ITs here — deliberately, matching
 * AuthIT. {@code NotificationService.inAppNotify} runs in
 * {@code Propagation.REQUIRES_NEW} (a notification is best-effort and must not
 * roll back with, or block, the action that triggered it), so it runs on its own
 * connection and cannot see a pharmacy this test created but never committed.
 * updateStatus and a pharmacy-side addMessage both call it, which is what these
 * tests exercise. Safe to let commit: every test creates its own uniquely-named
 * fixtures, and the whole database is dropped and rebuilt once per run.
 */
class SupportIT extends AbstractPostgresIT {

    @Autowired private SupportService supportService;
    @Autowired private SupportTicketRepository ticketRepository;
    @Autowired private TicketCategoryRepository categoryRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;

    private String pharmacyId;
    private String categoryId;
    private String agentId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User owner = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();

        // Migrations pre-seed 7 categories; any one is fine for these tests.
        categoryId = categoryRepository.findAll().stream().findFirst()
                .orElseThrow(() -> new IllegalStateException("no ticket categories seeded")).getId();

        // A platform-side agent user, tenant-independent (agents aren't scoped to a pharmacy).
        User agentUser = userRepository.save(User.create(pharmacy.getId(), "Support Agent",
                "agent-" + unique() + "@test.local", "9000000001", "hash", Role.SUPPORT_AGENT));
        agentId = agentUser.getId();

        authenticateAs(owner.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }


    private CreateTicketRequest ticketRequest(String pharmacyIdOverride) {
        return new CreateTicketRequest(categoryId, "Cannot print invoice", null, null, null, null,
                pharmacyIdOverride, CreateTicketRequest.AssignmentType.UNASSIGNED, null,
                "The invoice PDF fails to generate for every sale today.", "", "");
    }

    @Test
    @DisplayName("a pharmacy user's ticket is stamped with their own pharmacy, regardless of any pharmacyId they send")
    void ticketIsStampedWithCallersOwnPharmacy() {
        var ticket = supportService.createTicket(ticketRequest("some-other-id-the-caller-typed-in"));

        assertThat(ticketRepository.findById(ticket.id()).orElseThrow().getPharmacyId())
                .as("a pharmacy user cannot raise a ticket against a pharmacy that isn't theirs")
                .isEqualTo(pharmacyId);
    }

    @Test
    @DisplayName("an agent must specify which pharmacy a ticket is for")
    void agentMustSpecifyPharmacy() {
        authenticateAs(agentId, pharmacyId, Role.SUPPORT_AGENT);

        assertThatThrownBy(() -> supportService.createTicket(ticketRequest(null)))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class);
    }

    @Test
    @DisplayName("a pharmacy user cannot see another pharmacy's ticket")
    void cannotReadAnotherPharmacysTicket() {
        var ticket = supportService.createTicket(ticketRequest(null));

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherOwner = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        authenticateAs(otherOwner.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> supportService.getTicket(ticket.id()))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("an agent can see any pharmacy's ticket")
    void agentCanReadAnyTicket() {
        var ticket = supportService.createTicket(ticketRequest(null));

        authenticateAs(agentId, pharmacyId, Role.SUPPORT_AGENT);

        assertThat(supportService.getTicket(ticket.id()).id()).isEqualTo(ticket.id());
    }

    @Test
    @DisplayName("a pharmacy user cannot message another pharmacy's ticket")
    void cannotMessageAnotherPharmacysTicket() {
        var ticket = supportService.createTicket(ticketRequest(null));

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherOwner = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        authenticateAs(otherOwner.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> supportService.addMessage(ticket.id(), new AddMessageRequest("trying to peek")))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("only a support agent may change a ticket's status")
    void onlySupportAgentCanUpdateStatus() {
        var ticket = supportService.createTicket(ticketRequest(null));

        // Still authenticated as the pharmacy owner who raised it.
        assertThatThrownBy(() -> supportService.updateStatus(ticket.id(), new UpdateStatusRequest(TicketStatus.RESOLVED)))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("a support agent can change a ticket's status")
    void agentCanUpdateStatus() {
        var ticket = supportService.createTicket(ticketRequest(null));

        authenticateAs(agentId, pharmacyId, Role.SUPPORT_AGENT);
        supportService.updateStatus(ticket.id(), new UpdateStatusRequest(TicketStatus.RESOLVED));

        assertThat(ticketRepository.findById(ticket.id()).orElseThrow().getStatus())
                .isEqualTo(TicketStatus.RESOLVED);
    }

    @Test
    @DisplayName("a reply from the pharmacy re-opens a ticket that was awaiting their response")
    void userReplyReopensPendingTicket() {
        var ticket = supportService.createTicket(ticketRequest(null));
        authenticateAs(agentId, pharmacyId, Role.SUPPORT_AGENT);
        supportService.updateStatus(ticket.id(), new UpdateStatusRequest(TicketStatus.PENDING_USER));

        authenticateAs(ticket.raisedBy().id(), pharmacyId, Role.OWNER);
        supportService.addMessage(ticket.id(), new AddMessageRequest("Here is the extra detail you asked for"));

        assertThat(ticketRepository.findById(ticket.id()).orElseThrow().getStatus())
                .as("the user has responded — this is back on the agent's plate")
                .isEqualTo(TicketStatus.IN_PROGRESS);
    }

    @Test
    @DisplayName("another pharmacy's list of tickets does not leak into a plain list call")
    void listIsScopedToOwnPharmacy() {
        supportService.createTicket(ticketRequest(null));

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherOwner = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        authenticateAs(otherOwner.getId(), other.getId(), Role.OWNER);
        supportService.createTicket(ticketRequest(null));

        var list = supportService.listTickets(null, null, null, 1, 50);
        assertThat(list.items())
                .as("a pharmacy user must only see their own tickets")
                .allSatisfy(t -> assertThat(t.pharmacyId()).isEqualTo(other.getId()));
    }
}
