package com.checkup.pharmacy.common.concurrency;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Component;

/**
 * Transaction-scoped Postgres advisory lock for a "find-or-create by a natural
 * key" race — two concurrent transactions both missing a not-yet-existing row
 * and both inserting it.
 *
 * <p>{@link RetryOnConflict} does not fit this shape: it replays a whole
 * transaction after a lock/serialization failure, which is the right answer
 * when contention is on a row that already exists (see its javadoc). Here there
 * is no row to contend over until one of the racers creates it, so the fix has
 * to happen before the SELECT, not after a failed INSERT — an advisory lock
 * keyed on the natural key itself is the standard Postgres answer to exactly
 * that gap.
 *
 * <p>{@code pg_advisory_xact_lock} is transaction-scoped: it blocks the caller
 * until acquired and releases automatically on commit or rollback, so there is
 * no cleanup to forget and no risk of a leaked lock outliving its transaction.
 * The 64-bit key is a hash of the caller-supplied string, so a collision
 * between two unrelated keys is possible in principle (birthday bound on 2^64)
 * but immaterial here: a false-positive collision only costs the second caller
 * an extra, harmless wait, never an incorrect result.
 */
@Component
public class AdvisoryLock {

    private final EntityManager entityManager;

    public AdvisoryLock(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    /**
     * Blocks until this transaction holds the lock for {@code key}. Must be called
     * from inside an active transaction — the lock is meaningless (and Postgres
     * would release it immediately) otherwise.
     */
    public void acquire(String key) {
        entityManager.createNativeQuery("SELECT pg_advisory_xact_lock(hashtext(?1)::bigint)")
                .setParameter(1, key)
                .getSingleResult();
    }
}
