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
  /** For a measured (mL/g) line: the clinical volume the clinic prescribed. Preferred over parsing the note. */
  prescribedVolumeClinical?: number | null;
  /** "ML" | "GM". */
  clinicalUom?: string | null;
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

/**
 * The total volume/weight the clinic prescribed, read out of the deferral note
 * ("The clinic prescribed 30 ml, but…"). Used only to catch the pharmacist typing
 * that millilitre figure back in where a bottle count belongs — the exact mistake
 * that turns "30 ml" into "30 sealed bottles" on the bill. Null for a note that
 * names no figure (a countable medicine, an older note).
 */
function clinicVolumeFromNote(note: string | null | undefined): number | null {
  const m = note?.match(/prescribed\s+(\d+)\s*(?:ml|milli|g\b|gram)/i);
  return m ? parseInt(m[1]!, 10) : null;
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
  const unit = unitFromNote(item.quantityCalculationNote)
    ?? (item.clinicalUom ? ((item.clinicalUom.toUpperCase() === "GM") ? "tubes" : "bottles") : null);
  // Prefer the structured clinical volume; fall back to parsing the note for older rows.
  const clinicVolume = item.prescribedVolumeClinical ?? clinicVolumeFromNote(item.quantityCalculationNote);
  const measuredUnit = item.quantityCalculationNote?.match(/measured in (\w+)/)?.[1]
    ?? (item.clinicalUom?.toUpperCase() === "GM" ? "grams" : "millilitres");
  // A measured line asks for a BOTTLE / TUBE count. Entering a number at or above the clinic's
  // total volume almost always means the millilitres were typed in by mistake — this is how
  // "30 ml" became "30 sealed bottles" on a real bill. Warn prominently, but do NOT block:
  // an unusual-but-real case (a very small bottle, a long course) must still be dispensable,
  // and the millilitre-vs-pack ambiguity is now resolved automatically wherever a pack size
  // is on record — this panel only ever sees the lines where it is not.
  const enteredVolumeByMistake =
    !!unit && valid && clinicVolume != null && clinicVolume >= 10 && parsed >= clinicVolume;
  // Fallback nudge when there is no figure to compare against — still just a warning.
  const looksLikeVolume = !!unit && valid && !enteredVolumeByMistake && parsed > 20;
  const canConfirm = valid && !confirming;

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
            disabled={!canConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Confirm
          </button>
        </form>
      </div>
      {enteredVolumeByMistake && (
        <p className="mt-1.5 text-xs font-medium text-red-600">
          {parsed} {unit}? That's the {clinicVolume} {measuredUnit} the clinic prescribed — enter how many
          sealed {unit} to hand over (usually 1), not the total {measuredUnit}.
        </p>
      )}
      {looksLikeVolume && (
        <p className="mt-1.5 text-xs text-amber-700">
          {parsed} {unit}? Enter how many sealed {unit} to hand over — not the total {measuredUnit}.
        </p>
      )}
    </div>
  );
}
