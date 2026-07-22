package com.checkup.pharmacy.config;

import com.checkup.pharmacy.modules.support.SupportEventBus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.listener.adapter.MessageListenerAdapter;

import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Declares the Redis subscription that lets this instance receive support events
 * published by any instance, including itself.
 *
 * <p>See {@link SupportEventBus} for why this exists: SSE connections live in
 * process memory, so without a shared channel a second replica means some users
 * silently stop receiving live ticket updates.
 *
 * <p>Starting the subscription is deliberately <b>not</b> done here — see
 * {@link SupportEventSubscriptionStarter}.
 */
@Configuration
public class SupportEventsConfig {

    private static final Logger log = LoggerFactory.getLogger(SupportEventsConfig.class);

    /** How often to retry while Redis is unreachable. Also the post-subscribe recovery interval. */
    static final Duration RETRY_INTERVAL = Duration.ofSeconds(30);

    @Bean
    public RedisMessageListenerContainer supportEventListenerContainer(
            RedisConnectionFactory connectionFactory, SupportEventBus eventBus) {

        MessageListenerAdapter listener = new MessageListenerAdapter(
                (org.springframework.data.redis.connection.MessageListener) (message, pattern) ->
                        eventBus.handleIncoming(new String(message.getBody(), StandardCharsets.UTF_8)));

        // isAutoStartup() is overridden rather than calling a setter, which this type
        // does not expose. This is the load-bearing part: left on auto-start, the
        // container connects during context refresh and an unreachable Redis throws
        // RedisConnectionException, killing application startup outright. That was
        // observed by pointing an instance at a dead Redis port — it failed to boot
        // instead of degrading.
        //
        // Every other Redis dependency here tolerates an outage (rate limiting fails
        // open, ShedLock skips, the cache falls through to the database, and
        // SupportEventBus falls back to local fan-out). A pharmacy must be able to
        // keep billing through a Redis blip — and production has no Redis provisioned
        // yet, so an auto-starting container would refuse to boot at all.
        RedisMessageListenerContainer container = new RedisMessageListenerContainer() {
            @Override
            public boolean isAutoStartup() {
                return false;
            }
        };
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(listener, new ChannelTopic(SupportEventBus.CHANNEL));

        // Applies once subscribed — covers a Redis that disappears later.
        container.setRecoveryInterval(RETRY_INTERVAL.toMillis());
        container.setErrorHandler(t ->
                log.warn("Support event listener error (live updates degrade to local-only "
                         + "until Redis recovers): {}", t.toString()));

        return container;
    }
}
