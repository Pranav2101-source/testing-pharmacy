import { saleUnitModel } from "@pharmacy/utils";

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
 * The volume/weight in one pack from free text — "100 ml" → 100, "15g" → 15,
 * "1x100ml" → 100. For a MEASURED medicine (syrup/cream), where {@link parsePackSize}
 * deliberately returns nothing because a bottle is not a unit of 1 ml. A prefill the
 * pharmacist still eyeballs — never trusted or auto-applied.
 */
export function parseMeasuredPackSize(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  // ml / g only — NOT mg or mcg, which are a strength ("500mg"), never a pack volume.
  const m = text.trim().match(/(?:^|[x×*]\s*)(\d{1,6})\s*(ml|millilitres?|milliliters?|g|gm|grams?)(?![a-z])/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 2 && n <= 100000 ? n : undefined;
}

/**
 * What the billing cart's PACK column shows — the catalogue's free-text `packSize`
 * when it actually describes the packaging, otherwise a computed label from
 * `unitsPerPack` and the base unit ("15/strip" for a tablet, "100ml" for a syrup,
 * "100g" for a cream). Display-only: this never writes back to the catalogue, and
 * `unitsPerPack` itself is untouched — it stays exactly what the loose-selling math
 * already trusts as its source of truth. This function only decides what a cashier reads.
 *
 * A bare number ("1", "10" — digits and nothing else) tells a cashier nothing about
 * what's actually in the pack: tablets, ml, capsules. That's indistinguishable from a
 * lazily-entered catalogue row, so it's treated the same as an empty packSize — but
 * only demoted when `unitsPerPack` gives something better to show instead. With no
 * `unitsPerPack` to fall back to, the bare number is still shown as-is: it's poor, but
 * it's the only data there is.
 *
 * The base unit matters for the fallback: a measured medicine (syrup, cream — ML/GM) is
 * a bottle/tube of that volume, NOT "N/strip", so its computed label is "{n}ml" / "{n}g".
 *
 * For a countable medicine the fallback names the medicine's OWN packaging word —
 * "10/strip" for a strip, "10/bottle" for a bottle of 10 lozenges — resolved through
 * {@link saleUnitModel}, the same resolver the Qty toggle and every cart message use.
 * This used to hardcode "/strip", which is how a Melgain bottle read "10/strip" in the
 * billing cart while the inventory screen, reading the same catalogue field, said
 * "40 bottles". `unit` and `baseUnit` are both optional: with neither, the resolver's
 * own last resort is "unit", never "strip" — an unclassified medicine now says
 * "10/unit" rather than asserting packaging nobody recorded.
 */
export function packDisplayLabel(
  packSize: string | null | undefined,
  unitsPerPack: number | null | undefined,
  baseUnit?: string | null,
  unit?: string | null,
): string {
  const trimmed = (packSize ?? "").trim();
  const isBareNumber = /^\d+$/.test(trimmed);
  if (trimmed && !isBareNumber) return trimmed;
  if (unitsPerPack && unitsPerPack > 0) {
    const bu = baseUnit?.trim().toUpperCase();
    if (bu === "ML") return `${unitsPerPack}ml`;
    if (bu === "GM") return `${unitsPerPack}g`;
    return `${unitsPerPack}/${saleUnitModel({ unit, baseUnit }).packUnitLabel}`;
  }
  return trimmed || "—";
}
