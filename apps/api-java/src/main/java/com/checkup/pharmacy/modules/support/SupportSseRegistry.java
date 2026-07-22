package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.enums.Role;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * In-memory registry of live SSE connections for real-time ticket updates.
 * Single-process only (matches the old Node backend's exact semantics) — fine
 * for the current single-instance deployment; a multi-instance deployment
 * would need a shared pub/sub (e.g. Redis) fan-out instead, deliberately not
 * built here since nothing requires it yet.
 */
@Component
public class SupportSseRegistry implements org.springframework.context.SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(SupportSseRegistry.class);
    private static final Set<Role> AGENT_ROLES = Set.of(Role.SUPPORT_AGENT, Role.PLATFORM_ADMIN);

    private record Conn(String userId, Role role, SseEmitter emitter) {
    }

    private final Map<String, Conn> connections = new ConcurrentHashMap<>();
    private ScheduledExecutorService heartbeatExecutor;

    @PostConstruct
    void startHeartbeat() {
        heartbeatExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "support-sse-heartbeat");
            t.setDaemon(true);
            return t;
        });
        // 25s — keeps the connection alive through load balancers/browsers that would
        // otherwise close an idle SSE stream, matching the old Node backend's interval.
        heartbeatExecutor.scheduleAtFixedRate(this::sendHeartbeats, 25, 25, TimeUnit.SECONDS);
    }

    @PreDestroy
    void stopHeartbeat() {
        heartbeatExecutor.shutdownNow();
    }

    private void sendHeartbeats() {
        for (var entry : connections.entrySet()) {
            try {
                entry.getValue().emitter().send(SseEmitter.event().comment("heartbeat"));
            } catch (Exception e) {
                connections.remove(entry.getKey());
            }
        }
    }

    // ── Shutdown ─────────────────────────────────────────────────────────────
    // SSE connections are, by design, requests that never finish. Spring's graceful
    // shutdown counts them as "active requests" and waits the full grace period for
    // them to complete — which they never will. Measured: a deploy with one support
    // page open took 23s to shut down and still ended with "Graceful shutdown
    // aborted with one or more requests still active", versus 1.5s with none.
    //
    // That is worse than slow. Container platforms SIGKILL after their own stop
    // timeout (Docker's default is 10s, well under our 20s grace), so a stream held
    // open converts an orderly drain into a hard kill — taking any genuinely
    // in-flight sale down with it. The streams are the problem, so they are closed
    // first and the grace period is left for real work.
    //
    // Safe to drop them: EventSource reconnects on its own, so a client sees a brief
    // gap in live updates across a deploy and nothing more.

    private volatile boolean running;

    /**
     * Highest possible phase, so this stops BEFORE the web server begins draining.
     * Lifecycle beans are stopped in descending phase order; Spring Boot's own
     * graceful-shutdown lifecycle sits at {@code DEFAULT_PHASE - 1024}, so anything
     * that must release connections ahead of it has to be above that.
     */
    @Override
    public int getPhase() {
        return Integer.MAX_VALUE;
    }

    @Override
    public void start() {
        running = true;
    }

    @Override
    public void stop() {
        running = false;
        int open = connections.size();
        if (open > 0) {
            log.info("Completing {} open SSE connection(s) before shutdown so they do not "
                     + "hold the graceful drain open", open);
        }
        for (var entry : connections.entrySet()) {
            try {
                entry.getValue().emitter().complete();
            } catch (Exception e) {
                // Already dead or mid-write — nothing useful to do, and shutdown must
                // not be blocked by one uncooperative connection.
                log.debug("Could not cleanly complete SSE connection {}: {}", entry.getKey(), e.getMessage());
            }
        }
        connections.clear();
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    public String register(String userId, Role role, SseEmitter emitter) {
        String id = com.checkup.pharmacy.common.util.Cuid.generate();
        connections.put(id, new Conn(userId, role, emitter));
        emitter.onCompletion(() -> connections.remove(id));
        emitter.onTimeout(() -> connections.remove(id));
        emitter.onError(e -> connections.remove(id));
        return id;
    }

    public void remove(String connId) {
        connections.remove(connId);
    }

    /** Notify only connected support agents / platform admins. */
    public void notifyAgents(String event, Object data) {
        broadcast(event, data, conn -> AGENT_ROLES.contains(conn.role()));
    }

    /** Notify everyone (agents + pharmacy users) — the frontend filters by ticketId. */
    public void notifyAll(String event, Object data) {
        broadcast(event, data, conn -> true);
    }

    private void broadcast(String event, Object data, java.util.function.Predicate<Conn> filter) {
        for (var entry : connections.entrySet()) {
            Conn conn = entry.getValue();
            if (!filter.test(conn)) {
                continue;
            }
            try {
                conn.emitter().send(SseEmitter.event().name(event).data(data));
            } catch (Exception e) {
                connections.remove(entry.getKey());
                log.debug("SSE send failed, dropping connection {}: {}", entry.getKey(), e.getMessage());
            }
        }
    }
}
