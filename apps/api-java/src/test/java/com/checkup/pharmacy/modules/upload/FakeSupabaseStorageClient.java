package com.checkup.pharmacy.modules.upload;

import com.checkup.pharmacy.common.storage.SupabaseStorageClient;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory stand-in for {@link SupabaseStorageClient}, scoped to tests that
 * {@code @Import} {@link Config}.
 *
 * <p>The real client is a thin HTTP wrapper over Supabase's Storage REST API —
 * there is nothing to fake at the unit level, and no local Postgres/Redis-style
 * container for it the way the rest of this harness uses. Rather than have
 * UploadIT silently depend on real network access to a third-party service (or
 * fail confusingly against the empty-string defaults application.yml falls back
 * to when SUPABASE_URL is unset), this subclasses the real client — legal
 * because none of its methods are {@code final} — and replaces the three HTTP
 * calls with an in-memory map. UploadService itself, including the content-type
 * sniffing this class exists to exercise, runs unmodified.
 */
class FakeSupabaseStorageClient extends SupabaseStorageClient {

    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

    FakeSupabaseStorageClient() {
        super("http://fake.local", "fake-service-role-key", "fake-bucket");
    }

    @Override
    public void upload(String path, byte[] bytes, String contentType) {
        objects.put(path, bytes);
    }

    @Override
    public byte[] download(String path) {
        byte[] bytes = objects.get(path);
        if (bytes == null) {
            throw new IllegalStateException("No fake object stored at " + path);
        }
        return bytes;
    }

    @Override
    public String createSignedUrl(String path, int expiresInSeconds) {
        return "http://fake.local/storage/v1/object/sign/fake-bucket/" + path + "?fake-token";
    }

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        SupabaseStorageClient fakeSupabaseStorageClient() {
            return new FakeSupabaseStorageClient();
        }
    }
}
