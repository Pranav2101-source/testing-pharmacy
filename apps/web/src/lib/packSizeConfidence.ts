/**
 * How far a medicine's pack size may be trusted, and how to say so on screen.
 *
 * Mirrors the backend's `PackSizeConfidence` / `PackSizeSource` enums (see
 * `common/enums/PackSizeConfidence.java` and migration 20260910000001). Kept in one module
 * rather than re-declared per screen so triage, inventory and the catalogue cannot drift into
 * describing the same state three different ways — the failure that started all of this was two
 * screens quietly disagreeing about what one number meant.
 */

/**
 * `null` / `undefined` is a real, distinct state: the medicine has NO pack size on record, so
 * there is nothing to trust or doubt. It must not collapse into "UNVERIFIED" — an unclassified
 * medicine is correctly refused for loose sale, while an unverified one sells normally, and a UI
 * that flagged both the same way would put a warning on every unclassified line in the catalogue.
 */
export type PackSizeConfidence = "VERIFIED" | "UNVERIFIED" | "DISPUTED";

export type PackSizeSource =
  | "CATALOGUE_ADMIN"
  | "PHARMACIST"
  | "PACK_SIZE_TEXT"
  | "BULK_IMPORT"
  | "EMR_INGEST"
  | "DATA_SCRIPT"
  | "RAW_WRITE"
  | "BACKFILL";

export type PackSizeChip = {
  label: string;
  /** Explains what the state means and what to do about it — the chip's `title`. */
  title: string;
  /** Tailwind classes for the chip body. */
  className: string;
  /** True for the state that is a contradiction rather than merely an absence of evidence. */
  urgent: boolean;
};

/**
 * The chip to render for a confidence value, or `null` when there is nothing worth saying.
 *
 * VERIFIED returns null on purpose. A badge that appears on the good state as well as the bad
 * one is decoration: it doubles the things on a line without changing what a pharmacist should
 * do about any of them. Silence is the affirmation.
 *
 * `null`/unknown confidence also returns null — see the type above for why those are different
 * from UNVERIFIED and must not be flagged as though they were.
 */
export function packSizeChip(confidence: PackSizeConfidence | null | undefined): PackSizeChip | null {
  switch (confidence) {
    case "UNVERIFIED":
      return {
        label: "Unverified pack size",
        title:
          "Nobody has confirmed how much this pack holds. It is still used for billing — but "
          + "every millilitre-to-bottle conversion divides by it, so a wrong value multiplies "
          + "through the whole bill. Check it against a pack when you next have one in your hand.",
        // Slate, not amber. This is true of most of an ordinary catalogue, and a warning colour
        // on a state that common is one people stop seeing within a week.
        className: "border-slate-200 bg-slate-100 text-slate-600",
        urgent: false,
      };
    case "DISPUTED":
      return {
        label: "Pack size disputed",
        // Two different routes lead here and the pharmacist needs both named: the migration flags
        // a pack size that contradicts the medicine's own record, and — far more often since the
        // feedback loop — a quorum of pharmacies has been dispensing a different number of packs
        // than this size implies. Naming only the first sends someone hunting for a strength typo
        // that is not there.
        title:
          "This pack size has been flagged as likely wrong — either it contradicts the medicine's "
          + "own record (often a strength or concentration typed into the pack-size field), or "
          + "pharmacists at several shops have been dispensing a different number of packs than it "
          + "implies. Treat the quantity on this line as unreliable until it has been checked "
          + "against a physical pack.",
        className: "border-red-200 bg-red-50 text-red-700",
        urgent: true,
      };
    default:
      return null;
  }
}

/** True when the pack size is on record but nothing has vouched for it. */
export function needsPackSizeCheck(confidence: PackSizeConfidence | null | undefined): boolean {
  return confidence === "UNVERIFIED" || confidence === "DISPUTED";
}

/**
 * Deep link to the one screen where a pharmacist can actually record a checked pack size —
 * Inventory → Batches, with the row's own "confirm the pack size" dialog already open.
 *
 * The dialog is built from the medicine itself (fetched by id), so it opens whether or not a
 * batch of it is on the shelf. The name rides along as the search term so the list behind the
 * dialog shows that medicine's batches rather than page one of everything. `verifyPackSize` is
 * consumed and stripped by BatchesTab so a refresh does not reopen the dialog over whatever the
 * pharmacist moved on to.
 */
export function verifyPackSizeHref(medicineId: string, medicineName: string): string {
  const params = new URLSearchParams({
    tab: "batches",
    search: medicineName,
    verifyPackSize: medicineId,
  });
  return `/dashboard/inventory?${params.toString()}`;
}
