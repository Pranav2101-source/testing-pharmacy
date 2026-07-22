package com.checkup.pharmacy.modules.notification;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.notification.dto.NotificationLogResponse;
import com.checkup.pharmacy.modules.notification.dto.UnreadCountResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** In-app notification bell — tenant-scoped, open to any authenticated staff member. */
@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping("/logs")
    public ApiResponse<List<NotificationLogResponse>> logs() {
        return ApiResponse.ok(notificationService.getLogs());
    }

    @GetMapping("/unread-count")
    public ApiResponse<UnreadCountResponse> unreadCount() {
        return ApiResponse.ok(notificationService.getUnreadCount());
    }

    @PatchMapping("/mark-read")
    public ApiResponse<Void> markAllRead() {
        notificationService.markAllRead();
        return ApiResponse.ok(null);
    }

    @PatchMapping("/{id}/read")
    public ApiResponse<Void> markOneRead(@PathVariable String id) {
        notificationService.markOneRead(id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/failed")
    public ApiResponse<List<NotificationLogResponse>> failed() {
        return ApiResponse.ok(notificationService.getFailed());
    }
}
