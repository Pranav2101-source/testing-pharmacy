/**
 * The "+N loose" amber tag shown next to a pack quantity wherever a batch has pieces left
 * over from an opened strip (cut-strip selling) — same look everywhere it appears (Stock
 * Ledger, Reports' Dead Stock and Expiry tables), so every screen reads as one system rather
 * than several hand-copied variants of the same idea.
 *
 * Renders nothing for a falsy/zero count, so a caller can pass `item.looseUnits` straight
 * through without its own `> 0` guard.
 */
export function LooseTag({ units }: { units: number | null | undefined }) {
  if (!units) return null;
  return (
    <span className="text-[10px] text-amber-600 font-semibold ml-1 whitespace-nowrap">
      +{units} loose
    </span>
  );
}
