package com.checkup.pharmacy.modules.auth;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.common.exception.TooManyRequestsException;
import com.checkup.pharmacy.common.ratelimit.RateLimitService;
import com.checkup.pharmacy.common.util.ClientIp;
import com.checkup.pharmacy.modules.auth.dto.AccessTokenResponse;
import com.checkup.pharmacy.modules.auth.dto.ChangePasswordRequest;
import com.checkup.pharmacy.modules.auth.dto.ForgotPasswordRequest;
import com.checkup.pharmacy.modules.auth.dto.LoginRequest;
import com.checkup.pharmacy.modules.auth.dto.LoginResponse;
import com.checkup.pharmacy.modules.auth.dto.MeResponse;
import com.checkup.pharmacy.modules.auth.dto.MessageResponse;
import com.checkup.pharmacy.modules.auth.dto.RegisterRequest;
import com.checkup.pharmacy.modules.auth.dto.RegisterResponse;
import com.checkup.pharmacy.modules.auth.dto.ResetPasswordRequest;
import com.checkup.pharmacy.modules.auth.dto.UpdateProfileRequest;
import com.checkup.pharmacy.security.TokenPair;
import com.checkup.pharmacy.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

/**
 * Auth endpoints under /api/v1/auth. Thin: it validates input, delegates to
 * {@link AuthService}, manages the httpOnly refresh cookie, and shapes the
 * response envelope. The access token is returned in the body (kept in JS memory
 * by the client); the refresh token travels only in the cookie.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    /** Per-(IP+email) login attempts within the window — the specific "someone is guessing this password" signal. */
    private static final int LOGIN_PER_IDENTITY_LIMIT = 5;
    /** Broader per-IP login limit — catches someone cycling through many different emails from one IP. */
    private static final int LOGIN_PER_IP_LIMIT = 20;
    private static final Duration LOGIN_WINDOW = Duration.ofMinutes(15);

    private static final int REGISTER_PER_IP_LIMIT = 5;
    private static final Duration REGISTER_WINDOW = Duration.ofHours(1);

    private static final int FORGOT_PASSWORD_LIMIT = 3;
    private static final Duration FORGOT_PASSWORD_WINDOW = Duration.ofHours(1);

    private final AuthService authService;
    private final RefreshTokenCookie refreshCookie;
    private final RateLimitService rateLimitService;

    public AuthController(AuthService authService, RefreshTokenCookie refreshCookie, RateLimitService rateLimitService) {
        this.authService = authService;
        this.refreshCookie = refreshCookie;
        this.rateLimitService = rateLimitService;
    }

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<RegisterResponse>> register(
            @Valid @RequestBody RegisterRequest req, HttpServletResponse response, HttpServletRequest request) {
        String ip = ClientIp.from(request);
        if (!rateLimitService.tryConsume("register:ip:" + ip, REGISTER_PER_IP_LIMIT, REGISTER_WINDOW)) {
            throw new TooManyRequestsException("Too many accounts created recently — please try again later");
        }
        AuthService.AuthResult result = authService.register(req);
        refreshCookie.set(response, result.tokens().refreshToken());
        RegisterResponse body = new RegisterResponse(result.tokens().accessToken(), result.user());
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(body));
    }

    @PostMapping("/login")
    public ApiResponse<LoginResponse> login(
            @Valid @RequestBody LoginRequest req, HttpServletResponse response, HttpServletRequest request) {
        String ip = ClientIp.from(request);
        String identityKey = "login:identity:" + ip + ":" + req.email().toLowerCase();
        if (!rateLimitService.tryConsume(identityKey, LOGIN_PER_IDENTITY_LIMIT, LOGIN_WINDOW)
                || !rateLimitService.tryConsume("login:ip:" + ip, LOGIN_PER_IP_LIMIT, LOGIN_WINDOW)) {
            throw new TooManyRequestsException("Too many login attempts — please try again later");
        }
        AuthService.AuthResult result = authService.login(req);
        refreshCookie.set(response, result.tokens().refreshToken());
        LoginResponse body = new LoginResponse(
                new AccessTokenResponse(result.tokens().accessToken()), result.user());
        return ApiResponse.ok(body);
    }

    @PostMapping("/refresh")
    public ApiResponse<AccessTokenResponse> refresh(
            @CookieValue(value = RefreshTokenCookie.NAME, required = false) String refreshToken,
            HttpServletResponse response) {
        TokenPair tokens = authService.refresh(refreshToken);
        refreshCookie.set(response, tokens.refreshToken());
        return ApiResponse.ok(new AccessTokenResponse(tokens.accessToken()));
    }

    @PostMapping("/forgot-password")
    public ApiResponse<MessageResponse> forgotPassword(@Valid @RequestBody ForgotPasswordRequest req, HttpServletRequest request) {
        String ip = ClientIp.from(request);
        String key = "forgot-password:" + ip + ":" + req.email().toLowerCase();
        if (!rateLimitService.tryConsume(key, FORGOT_PASSWORD_LIMIT, FORGOT_PASSWORD_WINDOW)) {
            throw new TooManyRequestsException("Too many reset requests for this email — please try again later");
        }
        authService.forgotPassword(req);
        return ApiResponse.ok(new MessageResponse(
                "If that email is registered you will receive a reset link shortly"));
    }

    @PostMapping("/reset-password")
    public ApiResponse<MessageResponse> resetPassword(@Valid @RequestBody ResetPasswordRequest req) {
        authService.resetPassword(req);
        return ApiResponse.ok(new MessageResponse(
                "Password updated — please log in with your new credentials"));
    }

    @PatchMapping("/change-password")
    public ApiResponse<MessageResponse> changePassword(
            @Valid @RequestBody ChangePasswordRequest req, HttpServletResponse response) {
        authService.changePassword(TenantContext.userId(), req);
        // Tokens are now invalid — clear the cookie; the client must re-authenticate.
        refreshCookie.clear(response);
        return ApiResponse.ok(new MessageResponse("Password updated — please sign in again"));
    }

    @PostMapping("/logout")
    public ApiResponse<MessageResponse> logout(HttpServletResponse response) {
        authService.logout(TenantContext.userId());
        refreshCookie.clear(response);
        return ApiResponse.ok(new MessageResponse("Logged out"));
    }

    @GetMapping("/me")
    public ApiResponse<MeResponse> me() {
        return ApiResponse.ok(authService.me(TenantContext.userId()));
    }

    @PatchMapping("/me")
    public ApiResponse<MeResponse> updateProfile(@Valid @RequestBody UpdateProfileRequest req) {
        return ApiResponse.ok(authService.updateProfile(TenantContext.userId(), req.name()));
    }
}
