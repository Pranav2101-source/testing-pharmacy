package com.checkup.pharmacy.modules.notification;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The in-app notification log.
 *
 * <p>Not {@code @Transactional} — {@code inAppNotify} runs in
 * {@code Propagation.REQUIRES_NEW} specifically so a notification failure can
 * never roll back the business operation that triggered it (see its javadoc).
 * That means it writes on its own connection and needs the pharmacy fixture
 * actually committed, same reasoning as AuthIT/SupportIT/CalendarIT.
 */
class NotificationIT extends AbstractPostgresIT {

    @Autowired private NotificationService notificationService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;

    private String pharmacyId;
    private String ownerId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        ownerId = user.getId();
        authenticateAs(ownerId, pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    @DisplayName("a notification appears in the caller's own log")
    void notificationAppearsInOwnLog() {
        notificationService.inAppNotify(pharmacyId, "Test Subject", "Test message body");

        assertThat(notificationService.getLogs())
                .anySatisfy(n -> assertThat(n.subject()).isEqualTo("Test Subject"));
    }

    @Test
    @DisplayName("a fresh notification counts as unread")
    void freshNotificationIsUnread() {
        long before = notificationService.getUnreadCount().count();
        notificationService.inAppNotify(pharmacyId, "Unread test", "body");

        assertThat(notificationService.getUnreadCount().count()).isEqualTo(before + 1);
    }

    @Test
    @DisplayName("marking all read clears the unread count")
    void markAllReadClearsCount() {
        notificationService.inAppNotify(pharmacyId, "One", "body");
        notificationService.inAppNotify(pharmacyId, "Two", "body");

        notificationService.markAllRead();

        assertThat(notificationService.getUnreadCount().count()).isZero();
    }

    @Test
    @DisplayName("marking one notification read does not affect the others")
    void markOneReadLeavesOthersUnread() {
        notificationService.inAppNotify(pharmacyId, "Keep unread", "body");
        notificationService.inAppNotify(pharmacyId, "Will be read", "body");

        String toMark = notificationService.getLogs().stream()
                .filter(n -> n.subject().equals("Will be read")).findFirst().orElseThrow().id();
        notificationService.markOneRead(toMark);

        assertThat(notificationService.getUnreadCount().count()).isEqualTo(1);
    }

    @Test
    @DisplayName("another pharmacy's notifications do not appear in this pharmacy's log")
    void anotherPharmacysNotificationsAreInvisible() {
        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        notificationService.inAppNotify(other.getId(), "Not for you", "body");
        notificationService.inAppNotify(pharmacyId, "For you", "body");

        assertThat(notificationService.getLogs())
                .extracting(n -> n.subject())
                .contains("For you")
                .doesNotContain("Not for you");
    }

    /**
     * markOneRead resolves its target via {@code findByIdAndPharmacyId} and, if
     * nothing matches, simply does nothing ({@code Optional.ifPresent}) rather than
     * throwing. Worth pinning explicitly: the alternative — reporting "not found" for
     * an id that DOES exist, just for someone else — would itself leak that the id is
     * a real notification belonging to another tenant.
     */
    @Test
    @DisplayName("marking another pharmacy's notification id read is a silent no-op")
    void markingAnotherPharmacysNotificationIsANoOp() {
        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        notificationService.inAppNotify(other.getId(), "Their notification", "body");
        User otherOwner = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));

        authenticateAs(otherOwner.getId(), other.getId(), Role.OWNER);
        String theirNotificationId = notificationService.getLogs().stream().findFirst().orElseThrow().id();

        authenticateAs(ownerId, pharmacyId, Role.OWNER); // back to this test's own tenant
        notificationService.markOneRead(theirNotificationId); // must not throw, must not affect their unread count

        authenticateAs(otherOwner.getId(), other.getId(), Role.OWNER);
        assertThat(notificationService.getUnreadCount().count())
                .as("a no-op read from a foreign caller must not mark their notification read")
                .isEqualTo(1);
    }
}
