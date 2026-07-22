package com.checkup.pharmacy.security;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.user.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

/**
 * Signs and verifies HS256 JWTs using the configured shared secret.
 *
 * The key is built with SecretKeySpec directly rather than Keys.hmacShaKeyFor()
 * so we do NOT impose jjwt's 256-bit minimum-length check, allowing any secret
 * length supplied via JWT_SECRET.
 */
@Service
public class JwtService {

    private static final String TYPE_ACCESS = "access";
    private static final String TYPE_REFRESH = "refresh";
    private static final String TYPE_STREAM = "sse";

    private final SecretKey key;
    private final Duration accessTtl;
    private final Duration refreshTtl;
    private final Duration streamTicketTtl;

    public JwtService(@Value("${app.jwt.secret}") String secret,
                      @Value("${app.jwt.access-ttl}") Duration accessTtl,
                      @Value("${app.jwt.refresh-ttl}") Duration refreshTtl,
                      @Value("${app.jwt.stream-ticket-ttl:PT60S}") Duration streamTicketTtl) {
        this.key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        this.accessTtl = accessTtl;
        this.refreshTtl = refreshTtl;
        this.streamTicketTtl = streamTicketTtl;
    }

    /** Issues a fresh access + refresh token pair for the user's current state. */
    public TokenPair issueTokens(User user) {
        String access = sign(user, TYPE_ACCESS, accessTtl);
        String refresh = sign(user, TYPE_REFRESH, refreshTtl);
        return new TokenPair(access, refresh);
    }

    /**
     * Issues a short-lived ticket whose only power is opening the support event
     * stream.
     *
     * <p>{@code EventSource} cannot send an {@code Authorization} header, so
     * whatever authorises that stream has to travel in the URL — where it ends up
     * in proxy access logs, browser history, and referrer headers. Previously that
     * was the user's full access token: a credential valid for ~15 minutes against
     * <b>every</b> endpoint, sitting in logs the application does not control.
     *
     * <p>This ticket narrows both dimensions. It is typed {@code "sse"}, so
     * {@code JwtAuthenticationFilter} (which requires {@code "access"}) will not
     * accept it on any normal route, and it expires in about a minute — long
     * enough to open a connection, far too short to be useful once harvested.
     *
     * <p>Deliberately stateless rather than a stored single-use nonce: a nonce
     * would need shared storage, so it would break the moment a second instance
     * issued a ticket that a different instance had to redeem, and it would add a
     * hard Redis dependency to a feature that otherwise has none.
     */
    public String issueStreamTicket(User user) {
        return sign(user, TYPE_STREAM, streamTicketTtl);
    }

    private String sign(User user, String type, Duration ttl) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(user.getId())
                .claim("pharmacyId", user.getPharmacyId())
                .claim("role", user.getRole().name())
                .claim("email", user.getEmail())
                .claim("tokenVersion", user.getTokenVersion())
                .claim("type", type)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(key)
                .compact();
    }

    /**
     * Parses and verifies a token, returning the typed payload.
     * Throws io.jsonwebtoken.JwtException on any invalid/expired/tampered token.
     */
    public JwtPayload verify(String token) {
        Claims c = Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();

        String roleName = c.get("role", String.class);
        Role role = roleName == null ? null : Role.valueOf(roleName);

        Integer tv = c.get("tokenVersion", Integer.class);

        return new JwtPayload(
                c.getSubject(),
                c.get("pharmacyId", String.class),
                role,
                c.get("email", String.class),
                tv == null ? 0 : tv,
                c.get("type", String.class)
        );
    }
}
