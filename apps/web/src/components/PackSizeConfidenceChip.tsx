import { Link } from "react-router-dom";
import { ShieldQuestion, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { packSizeChip, verifyPackSizeHref, type PackSizeConfidence } from "@/lib/packSizeConfidence";

/**
 * "Nobody has checked the number this was divided by."
 *
 * <p>Deliberately a chip and not a warning. The plausibility guard already shouts when the
 * ARITHMETIC comes out strange, and it catches the loud version of this bug — 40 ml resolving to
 * eight bottles. It cannot catch the quiet version, because a wrong pack size does not always
 * produce a strange answer: halve a bottle volume and a two-bottle course becomes four, under
 * every ceiling, looking perfectly ordinary on every screen. Nothing is anomalous; the divisor
 * is simply wrong, and the only person who can tell is one holding the bottle.
 *
 * <p>So this says something different from a warning, and says it always: not "that looks odd"
 * but "this number has never been checked". Which is true of a great deal of a real catalogue —
 * hence slate rather than amber, no blocking, no acknowledgement to click. A badge that fires on
 * half the lines and demands a dismissal is a badge people learn to dismiss without reading.
 *
 * <p>Rendered with an action wherever a pharmacist can actually do something (Inventory), and as
 * plain text where they cannot (a modal with no route out) — a chip that looks clickable and
 * isn't is worse than one that never offered.
 */
export function PackSizeConfidenceChip({
  confidence,
  medicineId,
  medicineName,
  onVerify,
  className,
}: {
  confidence: PackSizeConfidence | null | undefined;
  medicineId?: string;
  medicineName?: string;
  /**
   * Opens the confirm-pack-size dialog in place. Takes precedence over the deep link — a screen
   * that already has the medicine in hand should not send the pharmacist somewhere else to do
   * something it can do right here.
   */
  onVerify?: () => void;
  className?: string;
}) {
  const chip = packSizeChip(confidence);
  if (!chip) return null;

  const Icon = chip.urgent ? ShieldAlert : ShieldQuestion;
  const body = (
    <>
      <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
      {chip.label}
    </>
  );
  const base = cn(
    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 border text-[10px] font-semibold",
    chip.className,
    className,
  );

  if (onVerify) {
    return (
      <button type="button" onClick={onVerify} title={`${chip.title}\n\nClick to confirm the pack size.`}
        className={cn(base, "transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400")}>
        {body}
      </button>
    );
  }

  if (medicineId && medicineName) {
    return (
      <Link to={verifyPackSizeHref(medicineId, medicineName)}
        title={`${chip.title}\n\nOpens Inventory, where you can confirm it.`}
        className={cn(base, "transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400")}>
        {body}
      </Link>
    );
  }

  return <span title={chip.title} className={base}>{body}</span>;
}
