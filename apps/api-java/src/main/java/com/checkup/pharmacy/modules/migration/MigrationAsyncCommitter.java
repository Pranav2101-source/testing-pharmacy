package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.enums.ImportJobStatus;
import com.checkup.pharmacy.security.UserPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.function.Supplier;

/**
 * Runs a large CSV import on a background thread.
 *
 * <p>A commit of 50,000 rows cannot be served inside an HTTP request: the browser, the
 * proxy in front of the API, or Railway's own request timeout will give up long before
 * the work finishes, and the pharmacist is left with a failed page load and no idea
 * whether their stock was imported. The wizard already knew how to wait — the job row
 * carries PENDING/PROCESSING/COMPLETED and the UI polls it every three seconds — but
 * nothing ever produced a job it needed to wait for.
 *
 * <p>A SEPARATE BEAN on purpose. {@code @Async}, like {@code @Transactional}, works
 * through a proxy, so a MigrationService method calling another MigrationService method
 * would bypass it entirely and run inline — the exact bug this class exists to avoid,
 * and one that would look like it worked in every small test.
 */
@Component
public class MigrationAsyncCommitter {

    private static final Logger log = LoggerFactory.getLogger(MigrationAsyncCommitter.class);

    private final MigrationImportJobRepository jobRepository;
    /**
     * Programmatic transactions, not {@code @Transactional} on the methods below.
     *
     * <p>Those are called from {@link #run} in this same class, and a self-invocation
     * never passes through the proxy that applies the annotation — the settle-the-job
     * write would silently join the work's already-rolled-back transaction and be lost
     * with it, leaving exactly the stuck PROCESSING row this class exists to prevent.
     */
    private final TransactionTemplate newTransaction;

    public MigrationAsyncCommitter(MigrationImportJobRepository jobRepository,
                                   PlatformTransactionManager transactionManager) {
        this.jobRepository = jobRepository;
        this.newTransaction = new TransactionTemplate(transactionManager);
        this.newTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Executes the import, then settles the job row either way.
     *
     * @param principal the user who started the import. Passed explicitly rather than
     *                  inherited: {@code SecurityContextHolder} is thread-local and the
     *                  request that dispatched this has already returned and cleared it,
     *                  so a worker relying on ambient context would find none and every
     *                  tenant-scoped query inside would throw Unauthorized.
     * @param work      the existing synchronous commit. It settles the job row this
     *                  task created, so the wizard — which polls the id handed back at
     *                  dispatch — sees that same row reach COMPLETED.
     */
    @Async
    public void run(String jobId, UserPrincipal principal, Supplier<?> work) {
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new UsernamePasswordAuthenticationToken(
                principal, null, List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().name()))));
        SecurityContextHolder.setContext(context);
        try {
            work.get();
            // The commit completes THIS job row (see MigrationService.writeJob), so the
            // normal path leaves nothing to do here. This is the safety net for a run
            // that returned without settling its row at all, which would otherwise sit
            // at PROCESSING forever and block rollback.
            discardIfStillUnfinished(jobId);
        } catch (Exception e) {
            // Never let this escape. An @Async void method's exception goes to the
            // executor's uncaught handler and nowhere near the user: the job would stay
            // PROCESSING forever, the wizard would poll it forever, and rollback would
            // stay blocked on an import that is no longer running.
            log.error("Background migration import {} failed", jobId, e);
            markFailed(jobId, e);
        } finally {
            SecurityContextHolder.clearContext(); // pooled thread — must not keep this
        }
    }

    /** Its own transaction, and deliberately tolerant. */
    private void markFailed(String jobId, Exception cause) {
        try {
            newTransaction.executeWithoutResult(status -> jobRepository.findById(jobId).ifPresent(job -> {
                if (job.getStatus() == ImportJobStatus.PROCESSING || job.getStatus() == ImportJobStatus.PENDING) {
                    job.fail(readableReason(cause));
                    jobRepository.save(job);
                }
            }));
        } catch (Exception secondary) {
            // If even this fails the database is unreachable; log and let the job be
            // swept as stale rather than throwing from a background thread.
            log.error("Could not mark migration job {} as failed", jobId, secondary);
        }
    }

    private void discardIfStillUnfinished(String jobId) {
        newTransaction.executeWithoutResult(status -> jobRepository.findById(jobId).ifPresent(job -> {
            if (job.getStatus() == ImportJobStatus.PROCESSING || job.getStatus() == ImportJobStatus.PENDING) {
                jobRepository.delete(job);
            }
        }));
    }

    /**
     * A sentence the pharmacist can act on, not a stack trace.
     *
     * <p>Whatever is stored here is rendered in the wizard, so a raw
     * {@code PSQLException: duplicate key value violates ...} would be both alarming and
     * useless. The full exception is in the log for whoever is on support.
     */
    private static String readableReason(Exception cause) {
        String message = cause.getMessage();
        if (message == null || message.isBlank()) {
            return "The import stopped unexpectedly. Nothing was saved — please try again.";
        }
        String trimmed = message.length() > 300 ? message.substring(0, 300) + "…" : message;
        return "The import stopped unexpectedly and nothing was saved: " + trimmed;
    }
}
