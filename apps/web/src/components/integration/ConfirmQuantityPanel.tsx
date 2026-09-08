import { useState } from "react";
import { HelpCircle, Check, Loader2 } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";

type UnconfirmedItem = {
  id: string;
  medicineName: string;
  quantity: number;
  dosage: string | null;
  /**
   * Why an automatic quantity couldn't be worked out for this line — e.g. "This medicine is
   * measured in millilitres, not counted as whole units" or "The clinic sent no duration for
   * this line". Null for a line nothing ever attempted a calculation for (an explicit
   * clinic quantity was never missing in the first place, or the medicine isn't linked yet).
   * Computed server-side by PrescriptionQuantityCalculator — never re-derived here, since
   * explaining a refusal would mean re-implementing the same parsing rules twice.
   */
  quantityCalculationNote?: string | null;
};

/**
 * Resolves prescription lines the clinic sent with no usable quantity — "as directed", or the
 * field left blank. These are ingested as a `quantity: 0` placeholder rather than rejected
 * (see `PrescriptionItem.needsQuantityConfirmation`), and a pharmacist has to settle the real
 * number before this line can be sold or counted toward the prescription being complete.
 *
 * Mirrors {@link "./ReviewIngestedItemsPanel"} deliberately: same "only show what needs a
 * human, resolve it in place, refresh on success" shape, for the exact same reason — a line
 * that silently never gets addressed is worse than one flagged clearly.
 */
export default function ConfirmQuantityPanel({
  prescriptionId,
  items,
  onConfirmed,
}: {
  prescriptionId: string;
  items: UnconfirmedItem[];
  onConfirmed: () => void;
}) {
  const unconfirmed: UnconfirmedItem[] = items.filter((i) => i.quantity <= 0);

  if (unconfirmed.length === 0) return null;

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-sky-900">
            {unconfirmed.length} line{unconfirmed.length === 1 ? "" : "s"} need
            {unconfirmed.length === 1 ? "s" : ""} a quantity confirmed
          </p>
          <p className="mt-0.5 text-xs text-sky-700">
            The clinic sent these with no fixed amount, and it couldn't be worked out
            automatically — see the reason under each one. Confirm how much to hand over — the
            prescription cannot be completed until each one is set.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {unconfirmed.map((item) => (
          <UnconfirmedRow key={item.id} prescriptionId={prescriptionId} item={item} onConfirmed={onConfirmed} />
        ))}
      </div>
    </div>
  );
}

/**
 * The unit the pharmacist should be counting in, pulled straight out of the backend's
 * own refusal sentence ("…enter the number of bottles to dispense…"). Keeping the noun
 * in one place — {@code PrescriptionQuantityCalculator} — and reading it back here avoids
 * a second copy of the base-unit → packaging-word mapping on the client, and it degrades
 * to a plain "Qty" when the note doesn't name one (a countable medicine, or an older note).
 */
function unitFromNote(note: string | null | undefined): string | null {
  const m = note?.match(/number of ([a-z]+) to dispense/i);
  return m ? m[1]! : null;
}

function UnconfirmedRow({
  prescriptionId,
  item,
  onConfirmed,
}: {
  prescriptionId: string;
  item: UnconfirmedItem;
  onConfirmed: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);

  const parsed = parseInt(value, 10);
  const valid = Number.isInteger(parsed) && parsed > 0;
  const unit = unitFromNote(item.quantityCalculationNote);
  // A measured medicine (bottles/tubes) billed in double digits from a prescription is
  // almost always the total mL/g typed in by mistake — flag it, don't block it.
  const looksLikeVolume = !!unit && valid && parsed > 20;

  async function confirm() {
    if (!valid) return;
    setConfirming(true);
    try {
      await api.patch(`/prescriptions/${prescriptionId}/items/${item.id}/quantity`, { quantity: parsed });
      toast.success(`Quantity confirmed for "${item.medicineName}"`);
      onConfirmed();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not confirm this quantity"));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-lg border border-sky-200 bg-white p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{item.medicineName}</p>
          <p className="text-xs text-slate-500">{item.dosage || "No dosage given"} · quantity not stated</p>
          {item.quantityCalculationNote && (
            <p className="mt-0.5 text-xs text-amber-700">{item.quantityCalculationNote}</p>
          )}
        </div>
        <form
          className="flex shrink-0 items-center gap-1.5"
          onSubmit={(e) => { e.preventDefault(); confirm(); }}
        >
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={unit ? unit.charAt(0).toUpperCase() + unit.slice(1) : "Qty"}
            aria-label={unit ? `Number of ${unit} for ${item.medicineName}` : `Quantity for ${item.medicineName}`}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-center focus:border-sky-400 focus:outline-none"
          />
          {unit && <span className="text-xs text-slate-400">{unit}</span>}
          <button
            type="submit"
            disabled={!valid || confirming}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Confirm
          </button>
        </form>
      </div>
      {looksLikeVolume && (
        <p className="mt-1.5 text-xs text-amber-700">
          {parsed} {unit}? Enter how many sealed {unit} to hand over — not the total {" "}
          {item.quantityCalculationNote?.match(/measured in (\w+)/)?.[1] ?? "amount"}.
        </p>
      )}
    </div>
  );
}
