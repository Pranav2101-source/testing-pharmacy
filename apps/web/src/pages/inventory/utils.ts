export function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

export function daysUntil(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

/**
 * What a stock count is expressed in. `inventory.quantity` is always a count of
 * whole packs — a strip, a bottle, a vial — never loose pieces (those live in
 * `looseUnits`). We label it with the medicine's own packaging type when it's
 * been classified, and fall back to the neutral "pack" otherwise: either way the
 * reader knows the number is not individual tablets.
 */
export function packNoun(unit: string | null | undefined, qty: number): string {
  const u = (unit ?? "").trim().toLowerCase() || "pack";
  if (qty === 1) return u;
  if (/s$/.test(u)) return u;                     // "drops" → "drops"
  if (/(x|z|ch|sh)$/.test(u)) return `${u}es`;    // "box"   → "boxes"
  return `${u}s`;
}
