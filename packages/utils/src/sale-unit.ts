/**
 * How a medicine's quantity is interpreted at the point of sale — the one place
 * "what does the number in the Qty box mean" is decided.
 *
 * <p>Billing was built tablet-first: a quantity was strips, or loose tablets cut
 * from a strip, and every label said so ("Strip", "opens 2 sealed strips"). A
 * syrup, a tonic, an ointment or eye-drops do not fit that: the sale unit is a
 * whole sealed bottle/tube, the base unit is a measured volume/weight (mL, g),
 * and "strip" is the wrong word on every control.
 *
 * <p>This resolves a medicine's catalogue fields into a small, display-agnostic
 * model the cart, the prescription→cart bridge and the receipts all read from,
 * so a syrup reads as "Bottle / mL" and a cream as "Tube / g" without any of
 * those call sites special-casing dosage forms themselves.
 *
 * <p>Mirrors {@code com.checkup.pharmacy.common.util.PackUnits} in the Java API —
 * the two must agree, because the backend's dispensing engine and this frontend
 * both label the same sale the same way.
 */

/** The smallest dispensable unit of a medicine. Stored on the catalogue, or inferred from {@code form}. */
export type BaseUnitCode = "TABLET" | "CAPSULE" | "ML" | "GM" | "EACH";

export type SaleUnitModelInput = {
  /** Free-text dosage form: "tablet", "syrup", "cream", "drops"… */
  form?: string | null;
  /** {@code Medicine.unit} — the packaging word: "Strip", "Bottle", "Tube", "Vial"… */
  unit?: string | null;
  /** Free-text pack size label: "15 tablets", "100ml". */
  packSize?: string | null;
  /** Structured base units in one sealed pack. NULL = not classified — no loose sale. */
  unitsPerPack?: number | null;
  /** Stored base unit, if a platform admin has set one. */
  baseUnit?: string | null;
  /** This pharmacy has opted in to cut-strip / loose selling for the medicine. */
  allowLooseSale?: boolean | null;
  /** Drug schedule — "X" can never be split out of its original pack. */
  schedule?: string | null;
};

export type SaleUnitModel = {
  /** Resolved base unit — stored value, else inferred from {@code form}, else EACH. */
  baseUnit: BaseUnitCode;
  /** True when {@code unitsPerPack} is a real structured value — loose selling is only possible then. */
  classified: boolean;
  /** True when this line may actually be sold as loose base units at the POS right now. */
  divisible: boolean;
  /**
   * True when the base unit is a measured volume/weight (mL, g) rather than a
   * countable piece — such a line is never offered tablet-style "cut the strip"
   * pack-rounding prompts; a part-pack prescription just rounds up to whole packs.
   */
  measured: boolean;
  /** Singular label for one whole sealed sale unit: "strip", "bottle", "tube", "vial", "unit"… */
  packUnitLabel: string;
  /** Singular label for one loose base unit: "tablet", "capsule", "mL", "g", "unit". */
  looseUnitLabel: string;
  /** Terse loose-unit label for narrow cells: "tab", "cap", "mL", "g", "u". */
  looseUnitShort: string;
};

const COUNTABLE_FORM = /tab/i;
const CAPSULE_FORM = /cap/i;
const LIQUID_FORM = /syrup|solution|suspension|drop|liquid|elixir|oral|lotion|tonic|linctus/i;
const SEMISOLID_FORM = /cream|ointment|gel|powder|paste|balm/i;

/**
 * The stored base unit, or one inferred from the free-text {@code form}, or EACH.
 * Byte-for-byte the same decision as {@code BaseUnits.resolve} in the Java API.
 */
export function resolveBaseUnit(
  baseUnit?: string | null,
  form?: string | null,
): BaseUnitCode {
  const stored = baseUnit?.trim().toUpperCase();
  if (stored === "TABLET" || stored === "CAPSULE" || stored === "ML" || stored === "GM" || stored === "EACH") {
    return stored;
  }
  if (!form || !form.trim()) return "EACH";
  if (COUNTABLE_FORM.test(form)) return "TABLET";
  if (CAPSULE_FORM.test(form)) return "CAPSULE";
  if (LIQUID_FORM.test(form)) return "ML";
  if (SEMISOLID_FORM.test(form)) return "GM";
  return "EACH";
}

/** Known packaging words → the singular noun we show for one whole sale unit. */
const PACK_WORD: Record<string, string> = {
  strip: "strip",
  bottle: "bottle",
  tube: "tube",
  sachet: "sachet",
  box: "box",
  vial: "vial",
  ampoule: "ampoule",
  drops: "bottle", // "Drops" packaging is a dropper bottle
  spray: "unit",
  piece: "unit",
  jar: "jar",
  packet: "packet",
};

/** What one sealed sale unit is called — {@code Medicine.unit} if it's a known word, else inferred from the base unit. */
function packUnitLabelFor(unit: string | null | undefined, baseUnit: BaseUnitCode): string {
  const known = unit?.trim().toLowerCase();
  if (known && PACK_WORD[known]) return PACK_WORD[known];
  // A free-text packaging value we don't recognise is still better than a guess,
  // as long as it isn't itself a size string ("100ml") — those we ignore.
  if (known && /^[a-z][a-z .\-/]{1,18}$/.test(known)) return known.replace(/s$/, "");
  switch (baseUnit) {
    case "TABLET":
    case "CAPSULE":
      return "strip";
    case "ML":
      return "bottle";
    case "GM":
      return "tube";
    default:
      return "unit";
  }
}

const LOOSE_LABEL: Record<BaseUnitCode, string> = {
  TABLET: "tablet",
  CAPSULE: "capsule",
  ML: "mL",
  GM: "g",
  EACH: "unit",
};

const LOOSE_SHORT: Record<BaseUnitCode, string> = {
  TABLET: "tab",
  CAPSULE: "cap",
  ML: "mL",
  GM: "g",
  EACH: "u",
};

/**
 * Resolve a medicine's catalogue fields into the point-of-sale unit model.
 *
 * <p>{@code divisible} is the same condition the cart's Strip/loose toggle has
 * always used ({@code allowLooseSale} + a real pack multiple + not Schedule X) —
 * centralised here so a liquid that a pharmacy genuinely dispenses by the mL and
 * a tablet it cuts by the piece both flow through one definition.
 */
export function saleUnitModel(input: SaleUnitModelInput): SaleUnitModel {
  const baseUnit = resolveBaseUnit(input.baseUnit, input.form);
  const upp = input.unitsPerPack ?? null;
  const classified = upp != null && upp > 0;
  const isScheduleX = (input.schedule ?? "").trim().toUpperCase() === "X";
  const divisible = !!input.allowLooseSale && upp != null && upp > 1 && !isScheduleX;
  const measured = baseUnit === "ML" || baseUnit === "GM";

  return {
    baseUnit,
    classified,
    divisible,
    measured,
    packUnitLabel: packUnitLabelFor(input.unit, baseUnit),
    looseUnitLabel: LOOSE_LABEL[baseUnit],
    looseUnitShort: LOOSE_SHORT[baseUnit],
  };
}

/**
 * True when a base unit is a measured volume/weight (ML, GM) rather than a
 * countable piece. Such a line never gets a tablet-style "cut the strip" prompt —
 * a part-pack prescription just rounds up to whole sealed packs. Mirrors
 * {@code PackUnits.isMeasured} in the Java API.
 */
export function isMeasuredBaseUnit(baseUnit?: string | null): boolean {
  const bu = baseUnit?.trim().toUpperCase();
  return bu === "ML" || bu === "GM";
}

/** "bottle" → "Bottle", "mL" → "mL" (already cased). Title-cases only a plain lowercase word. */
export function titleCaseUnit(label: string): string {
  if (!label) return label;
  if (label !== label.toLowerCase()) return label; // "mL" stays "mL"
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "1 bottle" / "2 bottles" — pluralises the pack/loose unit label for a count. */
export function pluraliseUnit(label: string, count: number): string {
  if (count === 1) return label;
  if (label === "mL" || label === "g") return label; // measured units don't pluralise
  return `${label}s`;
}
