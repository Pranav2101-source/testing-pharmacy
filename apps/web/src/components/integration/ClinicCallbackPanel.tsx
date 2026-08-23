import { useState } from "react";
import { CheckCircle2, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

export type DispenseNotify = {
  status: "PENDING" | "SENT" | "FAILED" | string;
  notifiedAt: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  /**
   * Computed by the server. Do NOT re-derive this from `status` — see below.
   */
  canRetry: boolean;
};

/** Same shape as {@link DispenseNotify} — the report differs, the state machine does not. */
export type CancelNotify = DispenseNotify;

const COPY = {
  dispense: {
    endpoint: "dispense-notify",
    sending: "Sending the dispensing update to the clinic…",
    sentPrefix: "Clinic updated",
    failedGivenUp: "The clinic could not be updated",
    failedRetrying: "Could not reach the clinic — trying again automatically",
    givenUpFooter: (attempts: number) =>
      `Stopped after ${attempts} attempt${attempts === 1 ? "" : "s"}. The sale is recorded here; only the clinic's copy is out of date.`,
  },
  cancel: {
    endpoint: "cancel-notify",
    sending: "Telling the clinic this prescription was cancelled…",
    sentPrefix: "Clinic told about the cancellation",
    failedGivenUp: "The clinic could not be told this was cancelled",
    failedRetrying: "Could not reach the clinic — trying again automatically",
    givenUpFooter: (attempts: number) =>
      `Stopped after ${attempts} attempt${attempts === 1 ? "" : "s"}. The cancellation stands here; only the clinic has not been told.`,
  },
} as const;

/**
 * Whether the clinic has been told something — what was dispensed, or that the prescription
 * was cancelled. One component for both: they are the exact same state machine (see
 * {@link DispenseNotify}/{@link CancelNotify}) reporting two different facts, and the
 * distinction this panel is built around — FAILED-and-still-trying versus
 * FAILED-and-given-up — applies identically to either.
 *
 * <p>That verdict is the server's (`canRetry`) precisely so this component cannot get it
 * wrong by reading `status` alone.
 */
export default function ClinicCallbackPanel({
  prescriptionId,
  notify,
  onRetried,
  kind = "dispense",
}: {
  prescriptionId: string;
  notify: DispenseNotify | CancelNotify | null;
  onRetried: () => void;
  kind?: "dispense" | "cancel";
}) {
  const toast = useToast();
  const [retrying, setRetrying] = useState(false);
  const copy = COPY[kind];

  // Null means nothing has happened yet that owes the clinic a report. Deliberately renders
  // nothing rather than "not sent" — which would describe a delivery that was never due and
  // read as a fault.
  if (!notify) return null;

  async function retry() {
    setRetrying(true);
    try {
      await api.post(`/prescriptions/${prescriptionId}/${copy.endpoint}/retry`);
      toast.success("Queued — the clinic will be updated within a minute");
      onRetried();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not queue another attempt"));
    } finally {
      setRetrying(false);
    }
  }

  if (notify.status === "SENT") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="text-emerald-800">
          {copy.sentPrefix}
          {notify.notifiedAt && (
            <span className="text-emerald-700">
              {" "}
              on {format(new Date(notify.notifiedAt), "d MMM yyyy, h:mm a")}
            </span>
          )}
        </span>
      </div>
    );
  }

  if (notify.status === "PENDING") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
        <Clock className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-amber-800">{copy.sending}</span>
      </div>
    );
  }

  // FAILED. Which of the two failures it is decides what the pharmacist is shown.
  const givenUp = notify.canRetry;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        givenUp ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50",
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={cn("mt-0.5 h-4 w-4 shrink-0", givenUp ? "text-red-600" : "text-amber-600")}
        />
        <div className="flex-1">
          <p className={givenUp ? "font-medium text-red-800" : "text-amber-800"}>
            {givenUp ? copy.failedGivenUp : copy.failedRetrying}
          </p>

          {notify.error && (
            <p className={cn("mt-0.5", givenUp ? "text-red-700" : "text-amber-700")}>{notify.error}</p>
          )}

          {/* Only shown while retries are still coming: it is the reason no action is needed. */}
          {!givenUp && notify.nextAttemptAt && (
            <p className="mt-0.5 text-amber-700">
              Next attempt at {format(new Date(notify.nextAttemptAt), "h:mm a")} — nothing to do.
            </p>
          )}

          {givenUp && (
            <p className="mt-0.5 text-red-700">{copy.givenUpFooter(notify.attempts)}</p>
          )}
        </div>

        {givenUp && (
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
            {retrying ? "Queueing…" : "Try again"}
          </button>
        )}
      </div>
    </div>
  );
}
