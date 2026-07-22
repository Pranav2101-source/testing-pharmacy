package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.security.JwtPayload;
import com.checkup.pharmacy.modules.user.AuthStatus;
import com.checkup.pharmacy.tenant.SystemContext;
import com.checkup.pharmacy.tenant.TenantContext;
import com.checkup.pharmacy.security.JwtService;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.modules.support.dto.AddMessageRequest;
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
import com.checkup.pharmacy.modules.support.dto.ToggleAgentRequest;
import com.checkup.pharmacy.modules.support.dto.UpdateStatusRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;

/** Support ticketing under /api/v1/support — role-aware (pharmacy users see their own tickets; agents/admins see all). */
@RestController
@RequestMapping("/api/v1/support")
public class SupportController {

    private final SupportService supportService;
    private final SupportSseRegistry sseRegistry;
    private final JwtService jwtService;
    private final UserRepository userRepository;

    public SupportController(SupportService supportService, SupportSseRegistry sseRegistry, JwtService jwtService,
                             UserRepository userRepository) {
        this.supportService = supportService;
        this.sseRegistry = sseRegistry;
        this.jwtService = jwtService;
        this.userRepository = userRepository;
    }

    @GetMapping("/categories")
    public ApiResponse<List<CategoryResponse>> categories() {
        return ApiResponse.ok(supportService.listCategories());
    }

    @GetMapping("/pharmacies")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<List<PharmacyOptionResponse>> pharmacies() {
        return ApiResponse.ok(supportService.listPharmacies());
    }

    @GetMapping("/stats")
    @PreAuthorize("hasAnyRole('SUPPORT_AGENT', 'PLATFORM_ADMIN')")
    public ApiResponse<StatsResponse> stats() {
        return ApiResponse.ok(supportService.stats());
    }

    @PostMapping("/tickets")
    public ResponseEntity<ApiResponse<TicketResponse>> createTicket(@Valid @RequestBody CreateTicketRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(supportService.createTicket(req)));
    }

    @GetMapping("/tickets")
    public ApiResponse<TicketListResponse> listTickets(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String raisedById,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(supportService.listTickets(status, search, raisedById, page, limit));
    }

    @GetMapping("/tickets/{id}")
    public ApiResponse<TicketDetailResponse> getTicket(@PathVariable String id) {
        return ApiResponse.ok(supportService.getTicket(id));
    }

    @PatchMapping("/tickets/{id}/status")
    @PreAuthorize("hasAnyRole('SUPPORT_AGENT', 'PLATFORM_ADMIN')")
    public ApiResponse<TicketResponse> updateStatus(@PathVariable String id, @Valid @RequestBody UpdateStatusRequest req) {
        return ApiResponse.ok(supportService.updateStatus(id, req));
    }

    @PostMapping("/tickets/{id}/messages")
    public ResponseEntity<ApiResponse<MessageResponse>> addMessage(@PathVariable String id,
                                                                    @Valid @RequestBody AddMessageRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(supportService.addMessage(id, req)));
    }

    @PostMapping("/tickets/{id}/attachments")
    public ResponseEntity<ApiResponse<AttachmentResponse>> addAttachment(
            @PathVariable String id,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "messageId", required = false) String messageId) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(supportService.addAttachment(id, file, messageId)));
    }

    @PatchMapping("/tickets/{id}/assign")
    @PreAuthorize("hasAnyRole('SUPPORT_AGENT', 'PLATFORM_ADMIN')")
    public ApiResponse<TicketResponse> assignTicket(@PathVariable String id, @Valid @RequestBody AssignTicketRequest req) {
        return ApiResponse.ok(supportService.assignTicket(id, req));
    }

    @GetMapping("/agents")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<List<AgentResponse>> agents() {
        return ApiResponse.ok(supportService.listAgents());
    }

    @PostMapping("/agents")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ResponseEntity<ApiResponse<AgentResponse>> createAgent(@Valid @RequestBody CreateAgentRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(supportService.createAgent(req)));
    }

    @PatchMapping("/agents/{id}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<AgentResponse> toggleAgent(@PathVariable String id, @Valid @RequestBody ToggleAgentRequest req) {
        return ApiResponse.ok(supportService.toggleAgent(id, req.isActive()));
    }

    /**
     * Issues a short-lived ticket for opening the event stream below.
     *
     * <p>Authenticated normally, via the {@code Authorization} header — so the
     * credential that actually matters never touches a URL. The client exchanges
     * it for a ticket, and only the ticket appears in the stream's query string.
     */
    @PostMapping("/stream-ticket")
    public ApiResponse<Map<String, String>> streamTicket() {
        User user = userRepository.findById(TenantContext.userId())
                .orElseThrow(() -> new com.checkup.pharmacy.common.exception.UnauthorizedException("Unauthorized"));
        return ApiResponse.ok(Map.of("ticket", jwtService.issueStreamTicket(user)));
    }

    /**
     * Server-Sent Events for real-time ticket updates.
     *
     * <p>Authorised by a query-string <b>ticket</b>, not the access token, because
     * {@code EventSource} cannot send custom headers. That distinction is the point:
     * anything in a URL should be assumed to reach proxy access logs and browser
     * history, and this previously carried the user's full access token — a
     * credential good for every endpoint for ~15 minutes. The ticket is typed
     * {@code "sse"} and lives about a minute, so a leaked one opens a read-only
     * stream and nothing else.
     *
     * <p>The route stays whitelisted in SecurityConfig and authenticates itself
     * here, replicating the revocation checks
     * {@link com.checkup.pharmacy.security.JwtAuthenticationFilter} performs
     * everywhere else.
     */
    @GetMapping("/stream")
    public SseEmitter stream(@RequestParam(required = false) String ticket) {
        if (ticket == null || ticket.isBlank()) {
            throw new com.checkup.pharmacy.common.exception.UnauthorizedException("Unauthorized");
        }
        JwtPayload payload;
        try {
            payload = jwtService.verify(ticket);
        } catch (Exception e) {
            throw new com.checkup.pharmacy.common.exception.UnauthorizedException("Unauthorized");
        }
        // Must be a stream ticket specifically. Accepting an access token here would
        // reintroduce exactly the exposure this endpoint was changed to remove.
        if (!payload.isStreamTicket()) {
            throw new com.checkup.pharmacy.common.exception.UnauthorizedException("Unauthorized");
        }
        // Runs as system, for the same reason JwtAuthenticationFilter does: this is
        // a permitAll route, so no SecurityContext (and therefore no tenant) exists
        // yet. Without the elevation, Row-Level Security fails this lookup closed,
        // it returns nothing, and every attempt to open the stream 401s — which is
        // exactly what happened when RLS was first switched on here.
        //
        // Projection rather than the full entity, matching the auth filter: this only
        // needs isActive and tokenVersion, and there is no reason to read a password
        // hash to decide whether someone may receive ticket notifications.
        AuthStatus status = SystemContext.callAsSystem(
                () -> userRepository.findAuthStatusById(payload.sub()).orElse(null));
        if (status == null || !status.active() || status.tokenVersion() != payload.tokenVersion()) {
            throw new com.checkup.pharmacy.common.exception.UnauthorizedException("Unauthorized");
        }

        SseEmitter emitter = new SseEmitter(0L); // no timeout — long-lived stream
        String connId = sseRegistry.register(payload.sub(), payload.role(), emitter);
        try {
            emitter.send(SseEmitter.event().name("connected").data(Map.of("connId", connId)));
        } catch (Exception e) {
            sseRegistry.remove(connId);
        }
        emitter.onCompletion(() -> sseRegistry.remove(connId));
        emitter.onTimeout(() -> sseRegistry.remove(connId));
        return emitter;
    }
}
