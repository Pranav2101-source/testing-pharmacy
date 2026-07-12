import type { LucideIcon } from "lucide-react";
import {
  Pill, Baby, Flower, Shield, Bath, Salad, Bandage, Stethoscope,
  Sparkles, ShoppingBag,
  Tablets, PillBottle, Cylinder, Package, Box, TestTube, Syringe,
  Droplet, SprayCan, CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Product taxonomy — the single source of truth for the packaging-unit picker,
// the category/product-type picker, and the tags that render them across the
// app (catalog, inventory, POS). Both `Medicine.category` and `Medicine.unit`
// remain free-text strings in the DB/API; these are curated presets that make
// data-entry fast and consistent, but any legacy/free-text value is preserved
// and still rendered (as a neutral chip) — so nothing existing breaks.
// ─────────────────────────────────────────────────────────────────────────────

export type TaxonomyOption = {
  value: string;      // canonical stored string
  label: string;      // display label (== value here, kept explicit for clarity)
  Icon:  LucideIcon;
  // Full Tailwind class strings — NEVER build these with template literals, the
  // JIT scanner only emits CSS for class names it can see whole in source.
  tag:   string;      // classes for the rendered tag chip
  hint?: string;      // optional one-liner shown in the picker tile
};

// ── Packaging units (Medicine.unit) ──────────────────────────────────────────
// Curated to this pharmacy's real needs (strip/bottle/sachet dominate) plus the
// common pharmacy packaging types. Not the exhaustive 18-type list — "Other"
// (free-text) covers the long tail without cluttering the picker.
export const PACKAGING_UNITS: TaxonomyOption[] = [
  { value: "Strip",   label: "Strip",   Icon: Tablets,    tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Blister of tablets/capsules" },
  { value: "Bottle",  label: "Bottle",  Icon: PillBottle, tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Syrup / liquid / pills" },
  { value: "Tube",    label: "Tube",    Icon: Cylinder,   tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Cream / ointment / gel" },
  { value: "Sachet",  label: "Sachet",  Icon: Package,    tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Powder / single-dose pouch" },
  { value: "Box",     label: "Box",     Icon: Box,        tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Carton / multi-pack" },
  { value: "Vial",    label: "Vial",    Icon: TestTube,   tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Injectable vial" },
  { value: "Ampoule", label: "Ampoule", Icon: Syringe,    tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Sealed injectable" },
  { value: "Drops",   label: "Drops",   Icon: Droplet,    tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Eye / ear / nasal drops" },
  { value: "Spray",   label: "Spray",   Icon: SprayCan,   tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Inhaler / aerosol" },
  { value: "Piece",   label: "Piece",   Icon: CircleDot,  tag: "bg-slate-100 text-slate-600 border-slate-200", hint: "Single unit / device" },
];

// ── Product categories (Medicine.category) ───────────────────────────────────
// Answers "what kind of product is this?" at a glance — the gap where a diaper,
// a sanitary pad, and a tablet all looked identical by name alone. Each gets a
// distinct colour so lists are scannable.
export const PRODUCT_CATEGORIES: TaxonomyOption[] = [
  { value: "Medicine",      label: "Medicine",      Icon: Pill,        tag: "bg-blue-50 text-blue-700 border-blue-200",       hint: "Tablets, syrups, injectables" },
  { value: "Baby Care",     label: "Baby Care",     Icon: Baby,        tag: "bg-pink-50 text-pink-700 border-pink-200",       hint: "Diapers, baby food, wipes" },
  { value: "Sanitary",      label: "Sanitary",      Icon: Flower,      tag: "bg-rose-50 text-rose-700 border-rose-200",       hint: "Pads, tampons, hygiene" },
  { value: "Adult Care",    label: "Adult Care",    Icon: Shield,      tag: "bg-indigo-50 text-indigo-700 border-indigo-200", hint: "Adult diapers, mobility" },
  { value: "Personal Care", label: "Personal Care", Icon: Bath,        tag: "bg-teal-50 text-teal-700 border-teal-200",       hint: "Soap, shampoo, skincare" },
  { value: "Nutrition",     label: "Nutrition",     Icon: Salad,       tag: "bg-emerald-50 text-emerald-700 border-emerald-200", hint: "Supplements, protein, health drinks" },
  { value: "Surgical",      label: "Surgical",      Icon: Bandage,     tag: "bg-cyan-50 text-cyan-700 border-cyan-200",       hint: "Dressings, gloves, consumables" },
  { value: "Devices",       label: "Devices",       Icon: Stethoscope, tag: "bg-violet-50 text-violet-700 border-violet-200", hint: "BP monitors, thermometers" },
  { value: "Cosmetics",     label: "Cosmetics",     Icon: Sparkles,    tag: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200", hint: "Beauty, grooming" },
  { value: "General",       label: "General",       Icon: ShoppingBag, tag: "bg-slate-100 text-slate-600 border-slate-200",   hint: "Everything else" },
];

const CATEGORY_BY_VALUE = new Map(PRODUCT_CATEGORIES.map((o) => [o.value.toLowerCase(), o]));
const PACKAGING_BY_VALUE = new Map(PACKAGING_UNITS.map((o) => [o.value.toLowerCase(), o]));

export function findCategory(value: string | null | undefined): TaxonomyOption | null {
  if (!value) return null;
  return CATEGORY_BY_VALUE.get(value.trim().toLowerCase()) ?? null;
}

export function findPackaging(value: string | null | undefined): TaxonomyOption | null {
  if (!value) return null;
  return PACKAGING_BY_VALUE.get(value.trim().toLowerCase()) ?? null;
}

// ── Tag chip ─────────────────────────────────────────────────────────────────
// Renders a known option with its icon + colour, or an unrecognised free-text
// value as a neutral chip (so legacy data like "Analgesic" still shows cleanly).
// Returns null for empty values so callers can `{value && <ProductTag .../>}`.
export function ProductTag({
  value,
  kind,
  size = "sm",
  className,
}: {
  value: string | null | undefined;
  kind: "category" | "packaging";
  size?: "sm" | "xs";
  className?: string;
}) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const option = kind === "category" ? findCategory(trimmed) : findPackaging(trimmed);
  const Icon = option?.Icon;
  const sizeCls = size === "xs"
    ? "text-[10px] px-1.5 py-0.5 gap-1"
    : "text-[11px] px-2 py-0.5 gap-1";
  const iconCls = size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3";

  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold border rounded-full whitespace-nowrap",
        sizeCls,
        option?.tag ?? "bg-slate-100 text-slate-500 border-slate-200",
        className,
      )}
      title={option ? `${kind === "category" ? "Category" : "Packaging"}: ${option.label}` : trimmed}
    >
      {Icon && <Icon className={iconCls} />}
      {option?.label ?? trimmed}
    </span>
  );
}
