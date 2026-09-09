package com.checkup.pharmacy.config;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.jsontype.BasicPolymorphicTypeValidator;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.interceptor.KeyGenerator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;

import java.time.Duration;

/**
 * Redis-backed caching for expensive read-only aggregates.
 *
 * <p>The immediate target is the platform analytics dashboard, which recomputes
 * thirteen sections on every request. Against a five-connection pool that is a
 * genuine availability risk, not just a slow page: two admins leaving the
 * dashboard open can hold enough connections to starve billing, so a report
 * screen degrades the till. Caching it converts a burst of heavy queries into one
 * query per TTL.
 *
 * <p><b>JSON, not JDK serialization.</b> Payloads are stored as JSON so they stay
 * readable in {@code redis-cli} and survive class-shape changes that would break
 * a Java-serialized blob. That requires type information to be embedded, hence
 * the activated default typing below — restricted by a
 * {@link BasicPolymorphicTypeValidator} to this application's own packages, since
 * unrestricted polymorphic deserialization is a well-known remote-code-execution
 * vector if an attacker can ever write to the cache.
 */
@Configuration
@EnableCaching
public class CacheConfig implements CachingConfigurer {

    /**
     * Tenant-prefixed keys for every {@code @Cacheable} that does not declare an
     * explicit {@code key}.
     *
     * <p>This is the safety net for the most dangerous mistake available in a
     * multi-tenant cache: caching one pharmacy's data under a key that any other
     * pharmacy also computes. Such an entry is served straight from Redis without
     * touching the database, so Row-Level Security — the control that otherwise
     * backstops every tenant-scoping bug in this codebase — never runs.
     *
     * <p>Overriding the framework default (which keys on method arguments only)
     * means a no-argument, tenant-scoped method cannot accidentally share one global
     * cache entry across the platform. See {@link TenantAwareKeyGenerator}.
     */
    @Override
    @Bean
    public KeyGenerator keyGenerator() {
        return new TenantAwareKeyGenerator();
    }

    /** Cache name for the platform analytics dashboard. */
    public static final String ANALYTICS_DASHBOARD = "analyticsDashboard";

    /** In-process (Caffeine) cache for the pharmacy home/sales dashboard stats — see the bean below. */
    public static final String DASHBOARD_STATS = "dashboardStats";

    private final int analyticsTtlSeconds;
    private final int dashboardStatsTtlSeconds;

    public CacheConfig(@Value("${app.cache.analytics-ttl-seconds:300}") int analyticsTtlSeconds,
                       @Value("${app.cache.dashboard-stats-ttl-seconds:30}") int dashboardStatsTtlSeconds) {
        this.analyticsTtlSeconds = analyticsTtlSeconds;
        this.dashboardStatsTtlSeconds = dashboardStatsTtlSeconds;
    }

    /**
     * In-process cache manager for small, very-hot, tenant-scoped read aggregates —
     * {@code getDashboardStats} first (nine serial aggregate queries, hit on every home
     * and sales screen load). Caffeine rather than Redis: no network hop, no extra load
     * on the single shared Redis instance, and the payload is a record held by reference
     * so there is no serialization round-trip.
     *
     * <p>Not {@code @Primary} — the Redis manager stays the default so {@code @Cacheable}
     * methods that need cross-instance sharing keep getting it. Callers opt in with
     * {@code @Cacheable(cacheManager = "caffeineCacheManager")}.
     *
     * <p>Per-instance eviction only. At a 30s TTL a stale entry after a sale is bounded
     * and acceptable for a glanceable overview; nothing here is a figure anyone files.
     */
    @Bean
    public org.springframework.cache.CacheManager caffeineCacheManager() {
        var manager = new org.springframework.cache.caffeine.CaffeineCacheManager();
        manager.setCacheNames(java.util.List.of(DASHBOARD_STATS));
        manager.setCaffeine(com.github.benmanes.caffeine.cache.Caffeine.newBuilder()
                .maximumSize(10_000)
                .expireAfterWrite(Duration.ofSeconds(dashboardStatsTtlSeconds))
                .recordStats());
        return manager;
    }

    @Bean
    @org.springframework.context.annotation.Primary
    public RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        RedisCacheConfiguration base = RedisCacheConfiguration.defaultCacheConfig()
                .serializeKeysWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new StringRedisSerializer()))
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new GenericJackson2JsonRedisSerializer(cacheObjectMapper())))
                // Never cache a null: a transient failure that yields no data would
                // otherwise be pinned for the whole TTL.
                .disableCachingNullValues();

        // The analytics dashboard gets a TYPE-BOUND serializer rather than the generic
        // one above. Its payload is a record, and records are implicitly final: with
        // DefaultTyping.NON_FINAL Jackson writes no "@class" for the root object, while
        // GenericJackson2JsonRedisSerializer reads back into Object and requires one — so
        // every read failed with "missing type id property '@class'" and the endpoint 500'd.
        //
        // That was invisible for as long as the cache key carried millisecond precision,
        // because no entry was ever read back; it surfaced the moment the key was made
        // stable enough to actually hit. Binding the value type removes the need for type
        // ids entirely (and with them the polymorphic-deserialization surface).
        RedisCacheConfiguration analytics = base
                .entryTtl(Duration.ofSeconds(analyticsTtlSeconds))
                .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(
                        new Jackson2JsonRedisSerializer<>(typedCacheObjectMapper(),
                                AnalyticsDashboardResponse.class)));

        return RedisCacheManager.builder(connectionFactory)
                .cacheDefaults(base)
                .withCacheConfiguration(ANALYTICS_DASHBOARD, analytics)
                // Redis being down must not take the dashboard down with it. Spring's
                // default is to propagate cache errors; this degrades to hitting the
                // database instead, which is exactly the pre-cache behaviour.
                .transactionAware()
                .build();
    }

    /**
     * Mapper for caches whose value type is known statically. No default typing: the
     * target class is supplied to the serializer, so nothing needs an embedded "@class"
     * and final types (records) round-trip correctly.
     *
     * <p>Any NEW cache added here should follow this pattern — bind the value type — or
     * be sure its payload is a non-final class, or it will hit the same read failure.
     */
    private ObjectMapper typedCacheObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);
        return mapper;
    }

    private ObjectMapper cacheObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        // Instant/LocalDate etc. would otherwise serialize as numeric timestamps
        // and fail to round-trip back into the DTO records.
        mapper.registerModule(new JavaTimeModule());
        mapper.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);
        mapper.activateDefaultTyping(
                BasicPolymorphicTypeValidator.builder()
                        .allowIfBaseType(Object.class)
                        .allowIfSubType("com.checkup.pharmacy.")
                        .allowIfSubType("java.util.")
                        .allowIfSubType("java.time.")
                        .allowIfSubType("java.math.")
                        .build(),
                ObjectMapper.DefaultTyping.NON_FINAL,
                JsonTypeInfo.As.PROPERTY);
        return mapper;
    }
}
