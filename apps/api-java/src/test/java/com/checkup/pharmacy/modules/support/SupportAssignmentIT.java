package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.enums.TicketStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ForbiddenException;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.support.dto.AssignTicketRequest;
import com.checkup.pharmacy.modules.support.dto.CreateTicketRequest;
import com.checkup.pharmacy.modules.support.dto.CreateTicketRequest.AssignmentType;
import com.checkup.pharmacy.modules.support.dto.TicketResponse;
import com.checkup.pharmacy.modules.support.dto.UpdateStatusRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Round-robin assignment, on-demand (re)assignment, and agent deactivation hand-off.
 *
 * <p>Not {@code @Transactional} — same reason as {@link SupportIT}: {@code NotificationService}
 * and the assignment audit run in their own transactions, and the service methods under test
 * commit before the assertions read them back. Every test builds uniquely-named fixtures and the
 * database is rebuilt once per run.
 */
class SupportAssignmentIT extends AbstractPostgresIT {

    @Autowired private SupportService supportService;
    @Autowired private SupportTicketRepository ticketRepository;
    @Autowired private SupportAgentRepository agentRepository;
    @Autowired private TicketCategoryRepository categoryRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private JdbcTemplate jdbcTemplate;

    private String pharmacyId;
    private String categoryId;
    private String ownerId;
    private String adminId;

    @BeforeEach
    void seed() {
        // Support agents are a single platform-wide pool with no tenant scoping, and this class is
        // not @Transactional (NotificationService commits in its own transaction). Round-robin here
        // genuinely considers every active agent in the database, so leftovers from a prior test
        // would steer the picker. Start each test from an empty support pool.
        jdbcTemplate.update("DELETE FROM ticket_attachments");
        jdbcTemplate.update("DELETE FROM ticket_messages");
        jdbcTemplate.update("DELETE FROM support_tickets");
        jdbcTemplate.update("DELETE FROM support_agents");

        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Assign Pharmacy", "ph-" + unique()));
        pharmacyId = pharmacy.getId();
        User owner = userRepository.save(User.create(pharmacyId, "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        ownerId = owner.getId();
        User admin = userRepository.save(User.create(pharmacyId, "Platform Admin",
                "admin-" + unique() + "@test.local", null, "hash", Role.PLATFORM_ADMIN));
        adminId = admin.getId();
        categoryId = categoryRepository.findAll().stream().findFirst()
                .orElseThrow(() -> new IllegalStateException("no ticket categories seeded")).getId();

        authenticateAs(adminId, pharmacyId, Role.PLATFORM_ADMIN);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    // ── fixtures ────────────────────────────────────────────────────────────────

    /** A support agent (user + support_agents row). Returns the agent id. */
    private String newAgent(String label, boolean active) {
        User u = userRepository.save(User.create(pharmacyId, "Agent " + label,
                "agent-" + label + "-" + unique() + "@test.local", null, "hash", Role.SUPPORT_AGENT));
        SupportAgent a = SupportAgent.create(u.getId());
        if (!active) {
            a.setActive(false);
        }
        return agentRepository.save(a).getId();
    }

    /** Agent id → the user id behind it (for authenticating as that agent). */
    private String userOf(String agentId) {
        return agentRepository.findById(agentId).orElseThrow().getUserId();
    }

    private void setLastAssigned(String agentId, Instant when) {
        jdbcTemplate.update("UPDATE support_agents SET \"lastAssignedAt\" = ? WHERE id = ?",
                Timestamp.from(when), agentId);
    }

    private TicketResponse createTicket(AssignmentType type, String agentId) {
        // unique description keeps DuplicateSubmitGuard from rejecting back-to-back creates
        CreateTicketRequest req = new CreateTicketRequest(categoryId, null, null, null, null, null,
                pharmacyId, type, agentId, "Assignment test ticket " + unique(), "", "");
        return supportService.createTicket(req);
    }

    private String assignedAgentOf(String ticketId) {
        return ticketRepository.findById(ticketId).orElseThrow().getAssignedAgentId();
    }

    private TicketStatus statusOf(String ticketId) {
        return ticketRepository.findById(ticketId).orElseThrow().getStatus();
    }

    private Map<String, Long> loadByAgent(List<String> agentIds) {
        Map<String, Long> load = agentRepository.countTicketsByAgentIdIn(agentIds).stream()
                .collect(Collectors.toMap(SupportAgentRepository.AgentTicketCountRow::getAgentId,
                        SupportAgentRepository.AgentTicketCountRow::getCnt));
        agentIds.forEach(id -> load.putIfAbsent(id, 0L));
        return load;
    }

    // ── round-robin at create time ─────────────────────────────────────────────

    @Test
    @DisplayName("round-robin picks the agent holding the fewest open tickets, not the least-recently-used")
    void roundRobinIsLoadAware() {
        String busy = newAgent("busy", true);
        String free = newAgent("free", true);
        createTicket(AssignmentType.MANUAL, busy);
        createTicket(AssignmentType.MANUAL, busy);
        // Make the busy agent look *more* attractive to a pure-recency picker.
        setLastAssigned(busy, Instant.now().minus(2, ChronoUnit.HOURS));
        setLastAssigned(free, Instant.now());

        TicketResponse t = createTicket(AssignmentType.ROUND_ROBIN, null);

        assertThat(t.assignedAgentId()).isEqualTo(free);
    }

    @Test
    @DisplayName("equal load → round-robin breaks the tie toward the agent assigned least recently")
    void roundRobinTieBreaksByRecency() {
        String older = newAgent("older", true);
        String newer = newAgent("newer", true);
        setLastAssigned(older, Instant.now().minus(1, ChronoUnit.HOURS));
        setLastAssigned(newer, Instant.now().minus(10, ChronoUnit.MINUTES));

        assertThat(createTicket(AssignmentType.ROUND_ROBIN, null).assignedAgentId()).isEqualTo(older);
    }

    @Test
    @DisplayName("round-robin never assigns to an inactive agent")
    void roundRobinSkipsInactiveAgents() {
        String active = newAgent("active", true);
        String inactive = newAgent("inactive", false);
        setLastAssigned(active, Instant.now());
        setLastAssigned(inactive, Instant.now().minus(1, ChronoUnit.HOURS));

        assertThat(createTicket(AssignmentType.ROUND_ROBIN, null).assignedAgentId()).isEqualTo(active);
    }

    @Test
    @DisplayName("no active agents → the ticket is still created, just OPEN and unassigned")
    void roundRobinWithNoAgentsLeavesTicketOpen() {
        newAgent("inactive", false);

        TicketResponse t = createTicket(AssignmentType.ROUND_ROBIN, null);

        assertThat(t.assignedAgentId()).isNull();
        assertThat(t.status()).isEqualTo(TicketStatus.OPEN);
    }

    @Test
    @DisplayName("a run of round-robin assignments spreads evenly across agents")
    void roundRobinDistributesEvenly() {
        List<String> agents = List.of(newAgent("a", true), newAgent("b", true), newAgent("c", true));

        IntStream.range(0, 9).forEach(i -> createTicket(AssignmentType.ROUND_ROBIN, null));

        Map<String, Long> load = loadByAgent(agents);
        long max = load.values().stream().mapToLong(Long::longValue).max().orElseThrow();
        long min = load.values().stream().mapToLong(Long::longValue).min().orElseThrow();
        assertThat(load.values().stream().mapToLong(Long::longValue).sum()).isEqualTo(9);
        assertThat(max - min).as("queues stay balanced").isLessThanOrEqualTo(1);
    }

    // ── on-demand assignment ───────────────────────────────────────────────────

    @Test
    @DisplayName("strategy=ROUND_ROBIN assigns an existing unassigned ticket")
    void assignExistingTicketByRoundRobin() {
        String agent = newAgent("solo", true);
        TicketResponse t = createTicket(AssignmentType.UNASSIGNED, null);
        assertThat(t.assignedAgentId()).isNull();

        supportService.assignTicket(t.id(), new AssignTicketRequest(null, AssignTicketRequest.Strategy.ROUND_ROBIN));

        assertThat(assignedAgentOf(t.id())).isEqualTo(agent);
        assertThat(statusOf(t.id())).isEqualTo(TicketStatus.ASSIGNED);
    }

    @Test
    @DisplayName("strategy=ROUND_ROBIN with no active agents is a clear 400, not a silent no-op")
    void assignByRoundRobinFailsLoudlyWithNoAgents() {
        TicketResponse t = createTicket(AssignmentType.UNASSIGNED, null);

        assertThatThrownBy(() -> supportService.assignTicket(t.id(),
                new AssignTicketRequest(null, AssignTicketRequest.Strategy.ROUND_ROBIN)))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("strategy=SELF assigns the ticket to the calling support agent")
    void agentCanClaimATicket() {
        String agent = newAgent("claimer", true);
        TicketResponse t = createTicket(AssignmentType.UNASSIGNED, null);

        authenticateAs(userOf(agent), pharmacyId, Role.SUPPORT_AGENT);
        supportService.assignTicket(t.id(), new AssignTicketRequest(null, AssignTicketRequest.Strategy.SELF));

        assertThat(assignedAgentOf(t.id())).isEqualTo(agent);
    }

    @Test
    @DisplayName("strategy=SELF from a user with no support-agent record is rejected")
    void selfAssignRequiresAnAgentRecord() {
        TicketResponse t = createTicket(AssignmentType.UNASSIGNED, null);
        // still authenticated as the bare PLATFORM_ADMIN from setup — no support_agents row

        assertThatThrownBy(() -> supportService.assignTicket(t.id(),
                new AssignTicketRequest(null, AssignTicketRequest.Strategy.SELF)))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("a pharmacy user cannot assign tickets at all")
    void pharmacyUserCannotAssign() {
        newAgent("a", true);
        authenticateAs(ownerId, pharmacyId, Role.OWNER);

        assertThatThrownBy(() -> supportService.assignTicket("any-id",
                new AssignTicketRequest(null, AssignTicketRequest.Strategy.ROUND_ROBIN)))
                .isInstanceOf(ForbiddenException.class);
    }

    // ── deactivation hand-off ──────────────────────────────────────────────────

    @Test
    @DisplayName("deactivating an agent round-robins their still-open tickets to the rest")
    void deactivationReassignsOpenTickets() {
        String leaving = newAgent("leaving", true);
        String staying = newAgent("staying", true);
        TicketResponse t1 = createTicket(AssignmentType.MANUAL, leaving);
        TicketResponse t2 = createTicket(AssignmentType.MANUAL, leaving);

        supportService.toggleAgent(leaving, false);

        assertThat(assignedAgentOf(t1.id())).isEqualTo(staying);
        assertThat(assignedAgentOf(t2.id())).isEqualTo(staying);
        assertThat(agentRepository.findById(leaving).orElseThrow().isActive()).isFalse();
    }

    @Test
    @DisplayName("deactivation leaves an agent's resolved tickets exactly where they are")
    void deactivationIgnoresResolvedTickets() {
        String leaving = newAgent("leaving", true);
        String staying = newAgent("staying", true);
        TicketResponse resolved = createTicket(AssignmentType.MANUAL, leaving);
        TicketResponse open = createTicket(AssignmentType.MANUAL, leaving);
        supportService.updateStatus(resolved.id(), new UpdateStatusRequest(TicketStatus.RESOLVED));

        supportService.toggleAgent(leaving, false);

        assertThat(assignedAgentOf(resolved.id())).isEqualTo(leaving);
        assertThat(assignedAgentOf(open.id())).isEqualTo(staying);
    }

    @Test
    @DisplayName("deactivating the last active agent unassigns their open tickets")
    void deactivatingLastAgentUnassigns() {
        String solo = newAgent("solo", true);
        TicketResponse t = createTicket(AssignmentType.MANUAL, solo);

        supportService.toggleAgent(solo, false);

        assertThat(assignedAgentOf(t.id())).isNull();
        assertThat(statusOf(t.id())).isEqualTo(TicketStatus.OPEN);
    }

    @Test
    @DisplayName("reactivating an agent does not pull their old tickets back")
    void reactivationDoesNotStealTickets() {
        String bouncy = newAgent("bouncy", true);
        String other = newAgent("other", true);
        TicketResponse t = createTicket(AssignmentType.MANUAL, bouncy);
        supportService.toggleAgent(bouncy, false);
        assertThat(assignedAgentOf(t.id())).isEqualTo(other);

        supportService.toggleAgent(bouncy, true);

        assertThat(assignedAgentOf(t.id())).isEqualTo(other);
    }
}
