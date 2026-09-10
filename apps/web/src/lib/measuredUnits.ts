/**
 * Shared vocabulary for a measured (ML / GM) medicine line, so the triage screen, the stock
 * panel, the billing cart and the prescribed-lines panel all say the same thing: a whole
 * sealed-pack count, with the clinical volume in brackets.
 *
 * A measured prescription line stores `quantity` as a base-unit dispense target (mL / g) and
 * `roundedPackCount` as the sealed packs it resolves to — so the pack size is
 * `quantity / roundedPackCount` (100 for a 100 ml bottle).
 */

/** Short unit + pack noun from a clinical UOM. */
export function measuredWords(clinicalUom: string | null | undefined): { unit: string; pack: string } {
  const gm = (clinicalUom ?? "").toUpperCase() === "GM";
  return { unit: gm ? "g" : "ml", pack: gm ? "tube" : "bottle" };
}

/** True when this line is a measured one with its pack count already resolved. */
export function isResolvedMeasured(line: {
  clinicalUom?: string | null;
  roundedPackCount?: number | null;
}): boolean {
  return !!line.clinicalUom && line.roundedPackCount != null && line.roundedPackCount > 0;
}

/**
 * "2 bottles (200 ml)" for a base-unit amount, given the pack size — or just "500 ml" when the
 * pack size is unknown. `packSize` is `quantity / roundedPackCount` for a resolved line.
 */
export function formatMeasuredAmount(
  baseUnits: number,
  clinicalUom: string | null | undefined,
  packSize: number | null | undefined,
): string {
  const { unit, pack } = measuredWords(clinicalUom);
  if (!packSize || packSize <= 0) return `${round1(baseUnits)} ${unit}`;
  const packs = baseUnits / packSize;
  const wholePacks = Number.isInteger(packs) ? packs : Math.round(packs * 100) / 100;
  const noun = wholePacks === 1 ? pack : `${pack}s`;
  return `${wholePacks} ${noun} (${round1(baseUnits)} ${unit})`;
}

/**
 * The conversion itself, spelled out — "40 ml ÷ 5 ml/bottle → 8 bottles".
 *
 * Shown on EVERY measured triage line, not only anomalous ones. A wrong catalogue pack size
 * produces arithmetic that is correct at every step and absurd at the end, and the only reader
 * who can catch that is a pharmacist who has held the bottle — so the divisor has to be on
 * screen next to the answer it produced. A line that reads "40 QTY" hides the one number that
 * was wrong; this one puts it in the middle of the sentence.
 *
 * `packSize` is the mL/g in one sealed pack as resolved live from the catalogue (the stock
 * endpoint's `effectivePackSize`), NOT `quantity / roundedPackCount` — a line resolved before
 * its medicine was classified has no `roundedPackCount` at all, and that is exactly the case
 * this needs to render.
 */
export function formatConversion(
  volume: number,
  packSize: number,
  clinicalUom: string | null | undefined,
  packWord: string,
): string | null {
  if (!packSize || packSize <= 0 || volume <= 0) return null;
  const { unit } = measuredWords(clinicalUom);
  const packs = Math.ceil(volume / packSize);
  return `${round1(volume)} ${unit} ÷ ${packSize} ${unit}/${packWord} → ${packs} ${packs === 1 ? packWord : `${packWord}s`}`;
}

/** The pack size (mL/g per sealed pack) for a resolved measured line, or null. */
export function measuredPackSize(line: {
  quantity: number;
  roundedPackCount?: number | null;
}): number | null {
  if (!line.roundedPackCount || line.roundedPackCount <= 0) return null;
  return line.quantity / line.roundedPackCount;
}

/**
 * The clinical volume the doctor prescribed and how far the whole sealed packs actually
 * dispensed overshoot it — the raw numbers behind the "internal note" microtext
 * ("105 ml Rx · 95 ml excess"). Null unless this is a measured line whose pack count
 * and pack size are both known.
 *
 * On a billing cart line, `quantity` is the sealed-pack count and `unitsPerPack` is the
 * mL/g in one sealed pack, so the dispensed volume is `quantity * unitsPerPack`.
 */
export function measuredRxOvershoot(line: {
  prescribedVolumeClinical?: number | null;
  clinicalUom?: string | null;
  quantity?: number | null;
  roundedPackCount?: number | null;
  unitsPerPack?: number | null;
}): { prescribed: number; excess: number; unit: string } | null {
  const rx = line.prescribedVolumeClinical;
  const packs = line.roundedPackCount ?? line.quantity;
  const upp = line.unitsPerPack;
  if (rx == null || !line.clinicalUom || !packs || packs <= 0 || !upp || upp <= 0) return null;
  const { unit } = measuredWords(line.clinicalUom);
  const dispensed = packs * upp;
  return { prescribed: round1(rx), excess: Math.max(0, round1(dispensed - rx)), unit };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
