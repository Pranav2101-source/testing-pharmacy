package com.checkup.pharmacy.modules.medicine;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * The pool the GRN local-medicine background matcher runs on — mirrors
 * {@code EmrDispenseCallbackConfig} exactly (named, bounded, ABORT-on-saturation):
 * an unqualified {@code @Async} would use Spring's unbounded default executor, and
 * this codebase names every executor for that reason.
 *
 * <p>Unlike the EMR dispense callback, this work never makes an outbound HTTP call
 * — it is pure DB reads/writes — so the pool stays small and a rejection is cheap:
 * the row is left PENDING and the scheduled backstop (see
 * {@code GrnMedicineMatchRetryJob}) picks it up on its next sweep.
 */
@Configuration
@EnableAsync
public class GrnMedicineMatchConfig {

    public static final String EXECUTOR = "grnMedicineMatchExecutor";

    @Bean(EXECUTOR)
    public Executor grnMedicineMatchExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("grn-match-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(20);
        executor.initialize();
        return executor;
    }
}
