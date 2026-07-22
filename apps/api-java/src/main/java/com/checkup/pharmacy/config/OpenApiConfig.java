package com.checkup.pharmacy.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** API docs at /swagger-ui.html (springdoc-openapi, A8) — schema only, never live tenant data. */
@Configuration
public class OpenApiConfig {

    private static final String BEARER_SCHEME = "bearerAuth";

    @Bean
    public OpenAPI checkupPharmacyOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("Checkup Pharmacy API")
                        .description("Spring Boot backend for Checkup Care Pharmacy. " +
                                "Most endpoints require a JWT access token — use the Authorize button " +
                                "with the token returned by POST /api/v1/auth/login.")
                        .version("v1"))
                .addSecurityItem(new SecurityRequirement().addList(BEARER_SCHEME))
                .components(new Components().addSecuritySchemes(BEARER_SCHEME,
                        new SecurityScheme()
                                .name(BEARER_SCHEME)
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")));
    }
}
