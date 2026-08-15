package com.checkup.pharmacy.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class DatabaseUrlEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Map<String, Object> props = new HashMap<>();

        // 1. Try to read DATABASE_URL from ../../.env
        Path envPath = Paths.get("../../.env");
        if (!Files.exists(envPath)) {
            // fallback for when running from project root
            envPath = Paths.get(".env");
        }

        String databaseUrl = environment.getProperty("DATABASE_URL");

        if (Files.exists(envPath)) {
            try {
                List<String> lines = Files.readAllLines(envPath);
                for (String line : lines) {
                    if (line.trim().startsWith("DATABASE_URL=")) {
                        String val = line.trim().substring("DATABASE_URL=".length()).trim();
                        // Remove quotes
                        if (val.startsWith("\"") && val.endsWith("\"")) {
                            val = val.substring(1, val.length() - 1);
                        }
                        databaseUrl = val;
                    }
                    if (line.trim().startsWith("JWT_SECRET=")) {
                        String val = line.trim().substring("JWT_SECRET=".length()).trim();
                        if (val.startsWith("\"") && val.endsWith("\"")) {
                            val = val.substring(1, val.length() - 1);
                        }
                        props.put("JWT_SECRET", val);
                    }
                }
            } catch (IOException e) {
                // Ignore
            }
        }

        if (databaseUrl != null && databaseUrl.startsWith("postgresql://")) {
            try {
                URI uri = new URI(databaseUrl);
                String host = uri.getHost();
                int port = uri.getPort();
                String path = uri.getPath(); // /dbname
                String userInfo = uri.getUserInfo();
                String query = uri.getQuery();

                String username = null;
                String password = null;
                if (userInfo != null) {
                    String[] parts = userInfo.split(":", 2);
                    username = parts[0];
                    if (parts.length > 1) {
                        password = parts[1];
                    }
                }

                String jdbcUrl = "jdbc:postgresql://" + host + (port != -1 ? ":" + port : "") + path;
                if (query != null) {
                    jdbcUrl += "?" + query + "&prepareThreshold=0";
                } else {
                    jdbcUrl += "?prepareThreshold=0";
                }
                
                if (host != null && host.contains("supabase.com") && !jdbcUrl.contains("sslmode=")) {
                    jdbcUrl += "&sslmode=require";
                }

                props.put("JDBC_DATABASE_URL", jdbcUrl);
                if (username != null) props.put("DB_USER", username);
                if (password != null) props.put("DB_PASSWORD", password);
                
                System.out.println("======================================================");
                System.out.println("[Config] Injecting production Supabase credentials");
                System.out.println("  JDBC URL: " + jdbcUrl);
                System.out.println("  Host: " + host);
                System.out.println("  Database: " + path);
                System.out.println("  Username: " + username);
                System.out.println("  Source: Root .env (DATABASE_URL)");
                System.out.println("  Active profile: " + String.join(",", environment.getActiveProfiles()));
                System.out.println("======================================================");

            } catch (Exception e) {
                System.err.println("Failed to parse DATABASE_URL: " + e.getMessage());
            }
        }

        if (!props.isEmpty()) {
            environment.getPropertySources().addFirst(new MapPropertySource("prismaUrlProperties", props));
        }
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE - 10;
    }
}
