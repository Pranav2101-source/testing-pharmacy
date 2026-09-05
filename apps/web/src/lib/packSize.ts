/**
 * Best-effort "units per pack" from free text — a PREFILL only, the pharmacist still
 * checks it against a real strip. Conservative on purpose: a wrong guess mis-prices
 * every loose sale. Mirrors migration 20260901000001's backfill rule.
 *   "1x10" / "10 x 15" → the second number
 *   "15" / "15 tablets" / "10's" → the number
 *   "200 ml", "50 g", "500mg 10 tablets", "strip of 15" → nothing (left for a human)
 */
export function parsePackSize(text: string | null): number | undefined {
  if (!text) return undefined;
  const t = text.trim();
  const grid = t.match(/^(\d+)\s*[xX*]\s*(\d+)\b/);
  if (grid) { const n = Number(grid[2]); if (n >= 2 && n <= 100000) return n; }
  // A bare count with an optional piece word and NOTHING else. A volume/weight, a
  // strength, a second number or extra words all fail this and fall through.
  const bare = t.match(/^(\d+)\s*(?:tab(?:let)?s?|cap(?:sule)?s?|pcs?|pieces?|nos?|'?s)?$/i);
  if (bare) { const n = Number(bare[1]); if (n >= 2 && n <= 100000) return n; }
  return undefined;
}

/**
 * What the billing cart's PACK column shows — the catalogue's free-text `packSize`
 * when it actually describes the packaging, otherwise a computed "{unitsPerPack}/strip"
 * label. Display-only: this never writes back to the catalogue, and `unitsPerPack`
 * itself is untouched — it stays exactly what the loose-selling math already trusts as
 * its source of truth. This function only decides what a cashier reads.
 *
 * A bare number ("1", "10" — digits and nothing else) tells a cashier nothing about
 * what's actually in the pack: tablets, ml, capsules. That's indistinguishable from a
 * lazily-entered catalogue row, so it's treated the same as an empty packSize — but
 * only demoted when unitsPerPack gives something better to show instead. With no
 * unitsPerPack to fall back to, the bare number is still shown as-is: it's poor, but
 * it's the only data there is.
 */
export function packDisplayLabel(
  packSize: string | null | undefined,
  unitsPerPack: number | null | undefined,
): string {
  const trimmed = (packSize ?? "").trim();
  const isBareNumber = /^\d+$/.test(trimmed);
  if (trimmed && !isBareNumber) return trimmed;
  if (unitsPerPack && unitsPerPack > 0) return `${unitsPerPack}/strip`;
  return trimmed || "—";
}
