package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.enums.AttachmentFileType;
import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.enums.TicketStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.ForbiddenException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.storage.SupabaseStorageClient;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.common.util.MagicBytes;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.notification.NotificationService;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.support.dto.AgentResponse;
import com.checkup.pharmacy.modules.support.dto.AssignTicketRequest;
import com.checkup.pharmacy.modules.support.dto.AttachmentResponse;
import com.checkup.pharmacy.modules.support.dto.CategoryResponse;
import com.checkup.pharmacy.modules.support.dto.CreateAgentRequest;
import com.checkup.pharmacy.modules.support.dto.CreateTicketRequest;
import com.checkup.pharmacy.modules.support.dto.MessageResponse;
import com.checkup.pharmacy.modules.support.dto.PharmacyOptionResponse;
import com.checkup.pharmacy.modules.support.dto.StatsResponse;
import com.checkup.pharmacy.modules.support.dto.TicketDetailResponse;
import com.checkup.pharmacy.modules.support.dto.TicketListResponse;
import com.checkup.pharmacy.modules.support.dto.TicketResponse;
import com.checkup.pharmacy.modules.support.dto.UpdateStatusRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Support-ticket business logic: creation with round-robin/manual/unassigned
 * routing, role-aware access (pharmacy users see only their own tickets;
 * SUPPORT_AGENT/PLATFORM_ADMIN see everything), the message thread with
 * auto status transitions, and attachment upload/download proxied through
 * Supabase Storage. Every mutation also fires an in-app notification to the
 * other party and an SSE event so both the pharmacy-side and agent-side UIs
 * update live without polling.
 */
@Service
public class SupportService {

    /** Fixed id of the platform-level pharmacy support staff belong to — seeded by the support_module migration. */
    private static final String PLATFORM_PHARMACY_ID = "platform_checkup_support";
    private static final Set<Role> SUPPORT_ROLES = Set.of(Role.SUPPORT_AGENT, Role.PLATFORM_ADMIN);
    private static final long MAX_ATTACHMENT_SIZE = 25L * 1024 * 1024;
    private static final Set<String> ALLOWED_MIME = Set.of(
            "image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm", "application/pdf");
    private static final String ATTACHMENT_URL_PREFIX = "/api/support/attachments/";

    private final SupportTicketRepository ticketRepository;
    private final TicketCategoryRepository categoryRepository;
    private final TicketMessageRepository messageRepository;
    private final TicketAttachmentRepository attachmentRepository;
    private final SupportAgentRepository agentRepository;
    private final PharmacyRepository pharmacyRepository;
    private final UserRepository userRepository;
    private final TicketSequenceService ticketSequenceService;
    private final NotificationService notificationService;
    private final AuditService auditService;
    private final SupportEventBus eventBus;
    private final SupabaseStorageClient storageClient;
    private final PasswordEncoder passwordEncoder;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public SupportService(SupportTicketRepository ticketRepository, TicketCategoryRepository categoryRepository,
                          TicketMessageRepository messageRepository, TicketAttachmentRepository attachmentRepository,
                          SupportAgentRepository agentRepository, PharmacyRepository pharmacyRepository,
                          UserRepository userRepository, TicketSequenceService ticketSequenceService,
                          NotificationService notificationService, AuditService auditService,
                          SupportEventBus eventBus, SupabaseStorageClient storageClient,
                          PasswordEncoder passwordEncoder,
                          com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.ticketRepository = ticketRepository;
        this.categoryRepository = categoryRepository;
        this.messageRepository = messageRepository;
        this.attachmentRepository = attachmentRepository;
        this.agentRepository = agentRepository;
        this.pharmacyRepository = pharmacyRepository;
        this.userRepository = userRepository;
        this.ticketSequenceService = ticketSequenceService;
        this.notificationService = notificationService;
        this.auditService = auditService;
        this.eventBus = eventBus;
        this.storageClient = storageClient;
        this.passwordEncoder = passwordEncoder;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    // ── Categories / pharmacies / stats ─────────────────────────────────────

    @Transactional(readOnly = true)
    public List<CategoryResponse> listCategories() {
        return categoryRepository.findByIsActiveTrueOrderBySortOrderAsc().stream().map(CategoryResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public List<PharmacyOptionResponse> listPharmacies() {
        return pharmacyRepository.findAllByOrderByNameAsc().stream()
                .map(p -> new PharmacyOptionResponse(p.getId(), p.getName())).toList();
    }

    @Transactional(readOnly = true)
    public StatsResponse stats() {
        long total = ticketRepository.count();
        long open = ticketRepository.countByStatusIn(Set.of(TicketStatus.OPEN, TicketStatus.ASSIGNED));
        long inProgress = ticketRepository.countByStatus(TicketStatus.IN_PROGRESS);
        long resolved = ticketRepository.countByStatus(TicketStatus.RESOLVED);
        return new StatsResponse(total, open, inProgress, resolved);
    }

    // ── Tickets ──────────────────────────────────────────────────────────────

    @Transactional
    public TicketResponse createTicket(CreateTicketRequest req) {
        duplicateSubmitGuard.guard("support.ticket.create", req);
        var principal = TenantContext.currentUser();
        String pharmacyId;
        if (SUPPORT_ROLES.contains(principal.role())) {
            if (req.pharmacyId() == null || req.pharmacyId().isBlank()) {
                throw new BadRequestException("pharmacyId is required for support staff creating tickets");
            }
            pharmacyId = req.pharmacyId();
        } else {
            pharmacyId = principal.pharmacyId();
        }

        String assignedAgentId = null;
        TicketStatus status = TicketStatus.OPEN;
        var assignmentType = req.assignmentType();
        if (assignmentType == CreateTicketRequest.AssignmentType.MANUAL && req.agentId() != null) {
            assignedAgentId = req.agentId();
            status = TicketStatus.ASSIGNED;
            markAgentAssigned(assignedAgentId);
        } else if (assignmentType != CreateTicketRequest.AssignmentType.UNASSIGNED) {
            List<SupportAgent> candidates = agentRepository.findActiveOrderByLastAssigned(Limit.of(1));
            if (!candidates.isEmpty()) {
                assignedAgentId = candidates.get(0).getId();
                status = TicketStatus.ASSIGNED;
                markAgentAssigned(assignedAgentId);
            }
        }

        String ticketNumber = ticketSequenceService.next();
        SupportTicket ticket = SupportTicket.create(ticketNumber, pharmacyId, principal.userId(), req.categoryId(),
                blankToNull(req.customTitle()), assignedAgentId, status, req.priority(), req.sla(), req.language(),
                req.dueDate(), req.description(), req.mobile(), blankToNull(req.altMobile()));
        ticketRepository.save(ticket);

        notificationService.inAppNotify(PLATFORM_PHARMACY_ID, "New Ticket " + ticketNumber,
                "New support ticket raised: " + truncate(req.description(), 100));
        eventBus.publishToAgents("ticket:new", Map.of("ticketId", ticket.getId(), "ticketNumber", ticketNumber,
                "status", ticket.getStatus().name()));

        auditService.log(AuditEntry.of(AuditModule.SUPPORT, "TICKET_CREATED", "SUPPORT_TICKET")
                .pharmacyId(pharmacyId).userId(principal.userId()).entityId(ticket.getId())
                .resourceName(ticketNumber));

        // Flush + clear so the findByIdWithRelations below actually runs its FETCH JOINs
        // instead of returning the just-persisted instance from Hibernate's L1 cache (whose
        // lazy category/raisedBy/pharmacy/agent proxies were never initialized → all null).
        entityManager.flush();
        entityManager.clear();
        return loadWithRelations(ticket.getId());
    }

    @Transactional(readOnly = true)
    public TicketListResponse listTickets(String status, String search, String raisedById, int page, int limit) {
        var principal = TenantContext.currentUser();
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 50);
        String pharmacyFilter = SUPPORT_ROLES.contains(principal.role()) ? null : principal.pharmacyId();

        var result = ticketRepository.search(pharmacyFilter, null, blankToNull(raisedById), blankToNull(status),
                blankToNull(search), PageRequest.of(safePage - 1, safeLimit, Sort.by("createdAt").descending()));
        List<TicketResponse> items = result.getContent().stream().map(TicketResponse::from).toList();
        return new TicketListResponse(items, result.getTotalElements(), safePage, safeLimit, result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public TicketDetailResponse getTicket(String id) {
        SupportTicket ticket = ticketRepository.findByIdWithRelations(id)
                .orElseThrow(() -> new NotFoundException("Ticket not found"));
        assertCanAccess(ticket);

        List<AttachmentResponse> attachments = attachmentRepository.findByTicketId(id).stream()
                .map(AttachmentResponse::from).toList();
        List<MessageResponse> messages = messageRepository.findByTicketIdOrderByCreatedAtAsc(id).stream()
                .map(m -> MessageResponse.from(m, attachmentRepository.findByMessageId(m.getId()).stream()
                        .map(AttachmentResponse::from).toList()))
                .toList();
        return TicketDetailResponse.from(TicketResponse.from(ticket), attachments, messages);
    }

    @Transactional
    public TicketResponse updateStatus(String id, UpdateStatusRequest req) {
        var principal = TenantContext.currentUser();
        if (!SUPPORT_ROLES.contains(principal.role())) {
            throw new ForbiddenException("Only support agents can update ticket status");
        }
        SupportTicket ticket = ticketRepository.findByIdWithRelations(id)
                .orElseThrow(() -> new NotFoundException("Ticket not found"));
        TicketStatus oldStatus = ticket.getStatus();
        ticket.updateStatus(req.status());

        notificationService.inAppNotify(ticket.getPharmacyId(), "Ticket " + ticket.getTicketNumber() + " Updated",
                "Your ticket status changed to: " + req.status().name().replace('_', ' '));
        eventBus.publishToAll("ticket:updated", Map.of("ticketId", id, "status", req.status().name()));

        auditService.log(AuditEntry.of(AuditModule.SUPPORT, "TICKET_STATUS_UPDATED", "SUPPORT_TICKET")
                .pharmacyId(ticket.getPharmacyId()).userId(principal.userId()).entityId(id)
                .oldData(Map.of("status", oldStatus.name())).newData(Map.of("status", req.status().name())));

        return TicketResponse.from(ticket);
    }

    @Transactional
    public MessageResponse addMessage(String id, com.checkup.pharmacy.modules.support.dto.AddMessageRequest req) {
        var principal = TenantContext.currentUser();
        SupportTicket ticket = ticketRepository.findByIdWithRelations(id)
                .orElseThrow(() -> new NotFoundException("Ticket not found"));
        assertCanAccess(ticket);

        TicketMessage message = TicketMessage.create(ticket.getPharmacyId(), id, principal.userId(), req.message());
        messageRepository.save(message);

        boolean isSupportStaff = SUPPORT_ROLES.contains(principal.role());
        if (isSupportStaff) {
            notificationService.inAppNotify(ticket.getPharmacyId(), "Reply on Ticket " + ticket.getTicketNumber(),
                    "Support team replied to your ticket.");
            if (ticket.getStatus() == TicketStatus.OPEN || ticket.getStatus() == TicketStatus.ASSIGNED
                    || ticket.getStatus() == TicketStatus.PENDING_USER) {
                ticket.updateStatus(TicketStatus.IN_PROGRESS);
            }
        } else {
            notificationService.inAppNotify(PLATFORM_PHARMACY_ID, "User replied on " + ticket.getTicketNumber(),
                    "User replied: " + truncate(req.message(), 100));
            if (ticket.getStatus() == TicketStatus.PENDING_USER) {
                ticket.updateStatus(TicketStatus.IN_PROGRESS);
            }
        }

        eventBus.publishToAll("message:new", Map.of("ticketId", id, "messageId", message.getId()));

        User sender = userRepository.findById(principal.userId()).orElse(null);
        return new MessageResponse(message.getId(), message.getMessage(), message.getCreatedAt(),
                sender != null ? new MessageResponse.SenderRef(sender.getId(), sender.getName(), sender.getRole().name()) : null,
                List.of());
    }

    @Transactional
    public AttachmentResponse addAttachment(String ticketId, MultipartFile file, String messageId) {
        var principal = TenantContext.currentUser();
        SupportTicket ticket = ticketRepository.findByIdWithRelations(ticketId)
                .orElseThrow(() -> new NotFoundException("Ticket not found"));
        assertCanAccess(ticket);

        if (file == null || file.isEmpty()) {
            throw new BadRequestException("No file uploaded");
        }
        if (file.getSize() > MAX_ATTACHMENT_SIZE) {
            throw new BadRequestException("File exceeds the 25 MB limit");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new BadRequestException("Could not read the uploaded file");
        }
        String detected = MagicBytes.detect(bytes);
        if (detected == null || !ALLOWED_MIME.contains(detected)) {
            throw new BadRequestException(
                    "File content does not match its declared format. Only images, videos, and PDFs are accepted.");
        }

        String ext = extensionFor(detected);
        String storedName = Cuid.generate() + "." + ext;
        String storagePath = ticket.getPharmacyId() + "/support/" + storedName;
        storageClient.upload(storagePath, bytes, detected);

        AttachmentFileType fileType = detected.startsWith("image/") ? AttachmentFileType.IMAGE
                : detected.startsWith("video/") ? AttachmentFileType.VIDEO : AttachmentFileType.DOCUMENT;
        String originalName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "attachment." + ext;

        TicketAttachment attachment = TicketAttachment.create(ticket.getPharmacyId(), ticketId,
                blankToNull(messageId), originalName, ATTACHMENT_URL_PREFIX + storedName, (int) file.getSize(),
                detected, fileType);
        attachmentRepository.save(attachment);
        return AttachmentResponse.from(attachment);
    }

    /**
     * Resolves a stored attachment by filename and streams its bytes, after verifying the
     * requester may access it (support staff see everything; pharmacy users only their own
     * pharmacy's tickets) — serving by filename alone would let any authenticated user from
     * any pharmacy fetch another tenant's screenshots/recordings.
     */
    @Transactional(readOnly = true)
    public AttachmentDownload getAttachmentBytes(String storedFilename) {
        TicketAttachment attachment = attachmentRepository.findByFileUrl(ATTACHMENT_URL_PREFIX + storedFilename)
                .orElseThrow(() -> new NotFoundException("Attachment not found"));
        var principal = TenantContext.currentUser();
        if (!SUPPORT_ROLES.contains(principal.role()) && !attachment.getTicket().getPharmacyId().equals(principal.pharmacyId())) {
            throw new ForbiddenException("Access denied");
        }
        String storagePath = attachment.getTicket().getPharmacyId() + "/support/" + storedFilename;
        byte[] bytes = storageClient.download(storagePath);
        return new AttachmentDownload(bytes, attachment.getMimeType(), attachment.getFileName());
    }

    public record AttachmentDownload(byte[] bytes, String mimeType, String fileName) {
    }

    // ── Agents ───────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<AgentResponse> listAgents() {
        List<SupportAgent> agents = agentRepository.findAllWithUser();
        if (agents.isEmpty()) {
            return List.of();
        }
        List<String> ids = agents.stream().map(SupportAgent::getId).toList();
        Map<String, Long> counts = agentRepository.countTicketsByAgentIdIn(ids).stream()
                .collect(java.util.stream.Collectors.toMap(SupportAgentRepository.AgentTicketCountRow::getAgentId,
                        SupportAgentRepository.AgentTicketCountRow::getCnt));
        return agents.stream().map(a -> AgentResponse.from(a, counts.getOrDefault(a.getId(), 0L))).toList();
    }

    @Transactional
    public AgentResponse createAgent(CreateAgentRequest req) {
        if (userRepository.existsByEmail(req.email())) {
            throw new ConflictException("A user with this email already exists");
        }
        User user = User.create(PLATFORM_PHARMACY_ID, req.name(), req.email(), null,
                passwordEncoder.encode(req.password()), Role.SUPPORT_AGENT);
        userRepository.save(user);
        SupportAgent agent = SupportAgent.create(user.getId());
        agentRepository.save(agent);
        return AgentResponse.from(agent, 0);
    }

    @Transactional
    public TicketResponse assignTicket(String id, AssignTicketRequest req) {
        var principal = TenantContext.currentUser();
        if (!SUPPORT_ROLES.contains(principal.role())) {
            throw new ForbiddenException("Not allowed");
        }
        SupportTicket ticket = ticketRepository.findByIdWithRelations(id)
                .orElseThrow(() -> new NotFoundException("Ticket not found"));

        String oldAgentId = ticket.getAssignedAgentId();
        if (req.agentId() != null) {
            SupportAgent agent = agentRepository.findById(req.agentId())
                    .orElseThrow(() -> new BadRequestException("Agent not found or inactive"));
            if (!agent.isActive()) {
                throw new BadRequestException("Agent not found or inactive");
            }
            markAgentAssigned(req.agentId());
        }
        ticket.assign(req.agentId());

        notificationService.inAppNotify(ticket.getPharmacyId(),
                "Ticket " + ticket.getTicketNumber() + (req.agentId() != null ? " Assigned" : " Unassigned"),
                req.agentId() != null ? "Your ticket has been assigned to our support team."
                        : "Your ticket is awaiting assignment.");

        auditService.log(AuditEntry.of(AuditModule.SUPPORT,
                        req.agentId() != null ? "TICKET_ASSIGNED" : "TICKET_UNASSIGNED", "SUPPORT_TICKET")
                .pharmacyId(ticket.getPharmacyId()).userId(principal.userId()).entityId(id)
                .oldData(Map.of("assignedAgentId", oldAgentId == null ? "" : oldAgentId))
                .newData(Map.of("assignedAgentId", req.agentId() == null ? "" : req.agentId())));

        return TicketResponse.from(ticket);
    }

    @Transactional
    public AgentResponse toggleAgent(String id, boolean isActive) {
        SupportAgent agent = agentRepository.findById(id).orElseThrow(() -> new NotFoundException("Agent not found"));
        agent.setActive(isActive);
        long ticketCount = agentRepository.countTicketsByAgentIdIn(List.of(id)).stream()
                .findFirst().map(SupportAgentRepository.AgentTicketCountRow::getCnt).orElse(0L);
        return AgentResponse.from(agent, ticketCount);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void markAgentAssigned(String agentId) {
        agentRepository.findById(agentId).ifPresent(a -> {
            a.markAssigned();
            agentRepository.save(a);
        });
    }

    private void assertCanAccess(SupportTicket ticket) {
        var principal = TenantContext.currentUser();
        if (!SUPPORT_ROLES.contains(principal.role()) && !ticket.getPharmacyId().equals(principal.pharmacyId())) {
            throw new ForbiddenException("Access denied");
        }
    }

    private TicketResponse loadWithRelations(String id) {
        return TicketResponse.from(ticketRepository.findByIdWithRelations(id)
                .orElseThrow(() -> new NotFoundException("Ticket not found")));
    }

    private static String extensionFor(String mime) {
        return switch (mime) {
            case "image/jpeg" -> "jpg";
            case "image/png" -> "png";
            case "image/gif" -> "gif";
            case "image/webp" -> "webp";
            case "video/mp4" -> "mp4";
            case "video/webm" -> "webm";
            case "application/pdf" -> "pdf";
            default -> "bin";
        };
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
