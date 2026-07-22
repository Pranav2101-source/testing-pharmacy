# ── Build stage ───────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# Leverage layer caching: resolve dependencies before copying source.
COPY pom.xml ./
# If you generate the Maven wrapper (mvn wrapper:wrapper), prefer ./mvnw here.
RUN apk add --no-cache maven && mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q clean package -DskipTests

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/pharmacy-api-0.0.1.jar app.jar

# Railway injects PORT; Spring reads it via server.port=${PORT:8080}.
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
