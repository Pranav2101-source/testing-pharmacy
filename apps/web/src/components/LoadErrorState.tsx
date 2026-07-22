import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shown when a panel's data failed to load.
 *
 * <p>Exists to keep "this failed" visually distinct from "there is nothing here".
 * Several report sections used to `catch` and render an empty array, so a network
 * blip, a 500, or a 400 all produced the same confident empty state — "No
 * controlled medicine dispensing records", "No dead stock". On a pharmacy's
 * compliance and stock screens that is not a cosmetic problem: it is the software
 * asserting a fact about the business that it does not actually know.
 *
 * Always pass the server's own message when there is one — the backend returns
 * actionable text (for example, asking for a narrower date range on an oversized
 * register), and replacing it with a generic string throws away the only part the
 * user can act on.
 */
export function LoadErrorState({
  title,
  message,
  onRetry,
  compact = false,
}: {
  /** What failed, in the user's terms — e.g. "Register could not be loaded". */
  title: string;
  /** The specific reason, ideally straight from the API. */
  message: string;
  /** Omit to render without a retry affordance (e.g. when a parent controls reload). */
  onRetry?: () => void;
  /** Tighter padding for small cards sitting inside a grid. */
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center px-6",
        compact ? "py-6" : "py-12",
      )}
    >
      <AlertTriangle
        className={cn("text-amber-400 mb-2", compact ? "w-6 h-6" : "w-8 h-8")}
        strokeWidth={1.4}
      />
      <p className={cn("font-semibold text-slate-700", compact ? "text-[12px]" : "text-[13px]")}>
        {title}
      </p>
      <p className="text-[11px] text-slate-500 mt-1 max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[12px] font-bold transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
