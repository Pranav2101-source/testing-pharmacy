package com.checkup.pharmacy.modules.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Fans support events out to every instance, not just the one that produced them.
 *
 * <p>{@link SupportSseRegistry} holds live {@code SseEmitter}s in a plain in-memory
 * map, which is correct but process-local. With more than one replica behind a load
 * balancer, a pharmacist's browser holds an SSE connection to instance A while the
 * agent who replies to their ticket is served by instance B — B fans the event out
 * to its own connections, A never hears about it, and the pharmacist's screen simply
 * never updates. The failure is silent: no error, just stale data, and only for
 * whichever users happen to be pinned to the wrong instance.
 *
 * <p>Every event is published to a Redis channel that <b>all</b> instances subscribe
 * to, including the publisher. There is deliberately only one delivery path — the
 * publisher does not also fan out locally — so an event cannot be delivered twice to
 * a connection on the originating instance.
 *
 * <p><b>Degrades rather than fails.</b> If Redis is unavailable the publish throws,
 * and the event is fanned out to local connections instead. That is exactly the old
 * single-instance behaviour, so a Redis outage costs cross-instance delivery and
 * nothing else — live updates keep working for everyone connected to the instance
 * handling the write. This matters because Redis is not yet provisioned in
 * production: until it is, this class behaves precisely as the code did before.
 */
@Component
public class SupportEventBus {

    private static final Logger log = LoggerFactory.getLogger(SupportEventBus.class);

    /** Redis pub/sub channel. Must match the one the listener container subscribes to. */
    public static final String CHANNEL = "support:events";

    /** Who a given event is for. */
    public enum Scope {
        /** Support agents and platform admins only. */
        AGENTS,
        /** Every connected client; the frontend filters by ticketId. */
        ALL
    }

    /** Wire format for a fanned-out event. */
    public record Envelope(String scope, String event, Object data) {
    }

    private final SupportSseRegistry registry;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public SupportEventBus(SupportSseRegistry registry,
                           StringRedisTemplate redisTemplate,
                           ObjectMapper objectMapper) {
        this.registry = registry;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /** Publish to support agents / platform admins across all instances. */
    public void publishToAgents(String event, Object data) {
        publish(Scope.AGENTS, event, data);
    }

    /** Publish to every connected client across all instances. */
    public void publishToAll(String event, Object data) {
        publish(Scope.ALL, event, data);
    }

    private void publish(Scope scope, String event, Object data) {
        try {
            String payload = objectMapper.writeValueAsString(new Envelope(scope.name(), event, data));
            redisTemplate.convertAndSend(CHANNEL, payload);
        } catch (Exception e) {
            // Redis down, or the payload could not be serialised. Either way the
            // event must still reach the clients this instance is serving — losing a
            // live update entirely is worse than losing cross-instance delivery.
            log.warn("Could not publish support event '{}' to Redis ({}); "
                     + "falling back to local-only fan-out", event, e.toString());
            dispatchLocally(scope, event, data);
        }
    }

    /**
     * Delivers an event to this instance's own SSE connections.
     *
     * <p>Called by the Redis listener on every instance, and directly by
     * {@link #publish} only when publishing failed.
     */
    public void dispatchLocally(Scope scope, String event, Object data) {
        if (scope == Scope.AGENTS) {
            registry.notifyAgents(event, data);
        } else {
            registry.notifyAll(event, data);
        }
    }

    /** Decodes a message received on the channel and delivers it locally. */
    public void handleIncoming(String payload) {
        try {
            Envelope envelope = objectMapper.readValue(payload, Envelope.class);
            dispatchLocally(Scope.valueOf(envelope.scope()), envelope.event(), envelope.data());
        } catch (Exception e) {
            // A malformed or unknown-scope message must not kill the listener thread,
            // which would silently end live updates for this whole instance.
            log.warn("Discarding unreadable support event from Redis: {}", e.toString());
        }
    }
}
