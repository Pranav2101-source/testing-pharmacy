/**
 * The amber tag shown next to a pack quantity wherever a batch has pieces left
 * over from an opened strip (cut-strip selling) — same look everywhere it appears
 * (Batches, Stock Ledger, Reports' Dead Stock and Expiry tables), so every screen
 * reads as one system rather than several hand-copied variants of the same idea.
 *
 * Pass `baseUnit` ("TABLET" | "CAPSULE" | "ML" | …) to name the piece — "+4 tablets"
 * instead of the generic "+4 loose" — so the number can't be mistaken for more packs.
 *
 * Renders nothing for a falsy/zero count, so a caller can pass `item.looseUnits`
 * straight through without its own `> 0` guard.
 */
const PIECE_NOUN: Record<string, [one: string, many: string]> = {
  TABLET:  ["tablet", "tablets"],
  CAPSULE: ["capsule", "capsules"],
  ML:      ["ml", "ml"],
  GM:      ["g", "g"],
  EACH:    ["unit", "units"],
};

export function LooseTag({
  units,
  baseUnit,
}: {
  units: number | null | undefined;
  baseUnit?: string | null;
}) {
  if (!units) return null;
  const pair = PIECE_NOUN[(baseUnit ?? "").toUpperCase()];
  const noun = pair ? (units === 1 ? pair[0] : pair[1]) : "loose";
  return (
    <span className="text-[10px] text-amber-600 font-semibold ml-1 whitespace-nowrap">
      +{units} {noun}
    </span>
  );
}
