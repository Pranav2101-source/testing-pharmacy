/**
 * Reclassifies Melgain (a topical minoxidil SOLUTION) as a measured, bottle-packed
 * medicine, and clears the bogus 10-per-pack override that was making the POS treat it
 * like a strip of ten tablets.
 *
 * ## What was wrong
 *
 * Melgain sits in the shared catalogue with `baseUnit` NULL and `unitsPerPack` NULL. A
 * pharmacy then classified it through the ONLY route open to it — a
 * `PharmacyMedicineOverride` with `unitsPerPack = 10` (written by the POS "cut the strip"
 * prompt, which offers a pack multiple for any medicine, measured or not). Consequences:
 *
 *   - the billing cart labelled a 1-bottle line "10/strip" and offered a Unit/U toggle,
 *     because with no `baseUnit` every label falls back to tablet vocabulary;
 *   - a 40-unit prescription billed as "4 packs", i.e. four bottles, on the strength of a
 *     pack multiple nobody had measured;
 *   - none of the mL→bottle handling engaged at all, since all of it keys off `baseUnit`
 *     being ML/GM.
 *
 * ## What this does
 *
 *   1. Sets `baseUnit = 'ML'` on the catalogue row (plus `form`/`unit` when blank), which
 *      is what makes every downstream surface — cart, triage, receipts, the dispensing
 *      engine's round-up messages — speak in bottles and mL.
 *   2. DELETES the `unitsPerPack` from any pharmacy override for it, and turns
 *      `allowLooseSale` off.
 *
 * ## Why `--ml` is REQUIRED to apply
 *
 * This script cannot see a physical bottle, and Melgain ships in more than one size. It
 * will not guess — but it also refuses to write the HALF of the fix it can do on its own,
 * because that intermediate state is worse than the bug:
 *
 *   - `baseUnit = ML` with NO pack volume leaves `unitsPerPack` NULL, so the dispensing
 *     engine's `upp` falls to 1 and a 40-unit prescription line allocates FORTY BOTTLES
 *     instead of the four it bills today. Fixing a label by multiplying a dispense by ten
 *     is not a fix.
 *   - Leaving the pharmacy's `unitsPerPack = 10` in place while setting `baseUnit = ML`
 *     just relabels the same wrong number as "10ml a bottle".
 *
 * So the only coherent end state is: base unit AND a real volume, together, in one
 * transaction — with the bogus per-pharmacy override cleared so the corrected catalogue
 * value is what every pharmacy reads. Read the volume off an actual pack and pass it.
 *
 * ## Usage
 *
 *   # report what is wrong and what would change — always safe, touches nothing
 *   DATABASE_URL=... tsx scripts/fix-melgain-measured-unit.ts
 *
 *   # apply, with a volume you have physically verified — address the row by ID, taken
 *   # from the dry-run report, because --name is a CONTAINS match ("Melgain" also matches
 *   # "Melgain Lotion", which is a different pack size)
 *   DATABASE_URL=... tsx scripts/fix-melgain-measured-unit.ts --apply --ml=5 --id=cmti7eo...
 *
 * Idempotent: re-running after a successful apply reports "already correct" and writes
 * nothing. Every write is inside one transaction per medicine.
 *
 * NOTE: the dry run on 2026-09-10 matched TWO rows — "Melgain" (which carries the bad
 * override) and "Melgain Lotion". Check the report before applying; if they need
 * different volumes, run once per row with a narrower `--name=`.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Matches "Melgain", "Melgain 2%", "MELGAIN SOLUTION" — but not an unrelated substring. */
const DEFAULT_NAME_PATTERN = "melgain";

type Args = { apply: boolean; ml: number | null; name: string; id: string | null };

function parseArgs(argv: string[]): Args {
  const apply = argv.includes("--apply");
  const idArg = argv.find((a) => a.startsWith("--id="));
  const id = idArg ? idArg.slice("--id=".length).trim() : null;
  if (idArg && !id) throw new Error("--id= cannot be empty");

  const nameArg = argv.find((a) => a.startsWith("--name="));
  const name = nameArg ? nameArg.slice("--name=".length).trim() : DEFAULT_NAME_PATTERN;
  if (!name) throw new Error("--name= cannot be empty");
  // --name is a CONTAINS match, so "Melgain" also matches "Melgain Lotion". That is fine for
  // reporting, but writing a pack volume to a row you did not mean to touch is not — so an
  // apply that could hit more than one row should be addressed by id instead.
  if (apply && !id) {
    console.warn("⚠  Applying by name match. Prefer --id=<medicineId> (from the dry-run report)\n"
      + "   when more than one row can match, so a volume lands only on the row you meant.\n");
  }

  const mlArg = argv.find((a) => a.startsWith("--ml="));
  let ml: number | null = null;
  if (mlArg) {
    ml = Number(mlArg.slice("--ml=".length));
    if (!Number.isInteger(ml) || ml < 2 || ml > 100000) {
      throw new Error(`--ml must be a whole number between 2 and 100000, got "${mlArg}"`);
    }
  }
  // Refused rather than defaulted: see the header. Half of this fix, applied alone, makes a
  // 40-unit prescription line allocate 40 bottles instead of 4.
  if (apply && ml === null) {
    throw new Error(
      "--apply requires --ml=<bottle volume in ml>, read off a physical pack.\n"
      + "Setting the base unit without a real pack volume would leave unitsPerPack NULL, and the\n"
      + "dispensing engine would then treat every prescribed unit as a whole bottle.\n"
      + "Run without --apply first to see the current values.",
    );
  }
  return { apply, ml, name, id };
}

async function main() {
  const { apply, ml, name, id } = parseArgs(process.argv.slice(2));
  console.log(apply ? "Mode: APPLY (writes enabled)" : "Mode: DRY RUN (no writes — pass --apply --ml=<n>)");
  console.log(id ? `Target: medicine id ${id}` : `Target: name contains "${name}"`);
  if (ml !== null) console.log(`Recording a verified pack volume of ${ml} ml.`);

  const medicines = await prisma.medicine.findMany({
    where: id ? { id } : { name: { contains: name, mode: "insensitive" } },
    select: {
      id: true, name: true, form: true, unit: true, packSize: true,
      baseUnit: true, unitsPerPack: true, packSizeConfidence: true, packSizeSource: true,
    },
  });

  if (medicines.length === 0) {
    console.log(`No catalogue medicine matches ${id ? `id "${id}"` : `"${name}"`}. Nothing to do.`);
    return;
  }
  if (apply && medicines.length > 1) {
    console.log(`\n⚠  ${medicines.length} rows match "${name}" and they would ALL get ${ml} ml.`);
    console.log("   If they are different pack sizes, stop and run once per row with --name=.\n");
  }
  console.log(`Found ${medicines.length} matching catalogue medicine(s).\n`);

  for (const med of medicines) {
    console.log(`── ${med.name} (${med.id})`);
    console.log(`   before: baseUnit=${med.baseUnit ?? "NULL"} form=${med.form ?? "NULL"} `
      + `unit=${med.unit ?? "NULL"} packSize=${med.packSize ?? "NULL"} unitsPerPack=${med.unitsPerPack ?? "NULL"} `
      + `confidence=${med.packSizeConfidence ?? "NULL"}/${med.packSizeSource ?? "NULL"}`);

    // Only ever FILL blanks for form/unit — a catalogue that already says "Lotion" or
    // "Vial" knows something this script does not, and overwriting it would be a guess
    // dressed up as a fix. baseUnit is the one field asserted outright: ML is what makes
    // a topical solution behave as a measured medicine, and it is the whole point here.
    const medicineData: Record<string, unknown> = { baseUnit: "ML" };
    if (!med.form?.trim()) medicineData.form = "solution";
    if (!med.unit?.trim()) medicineData.unit = "Bottle";
    // The corrected volume goes on the CATALOGUE, so every pharmacy gets it, and the
    // per-pharmacy override that was standing in for it is cleared below.
    //
    // --ml is documented as a number read off a physical pack and is REFUSED rather than
    // defaulted (see the header), which is precisely the evidence PackSizeConfidence.VERIFIED
    // is meant to record. So this script asserts it — and asserts DATA_SCRIPT alongside, so a
    // volume that later turns out to be wrong leads back to this run rather than to whichever
    // pharmacist happened to be looking at the medicine afterwards.
    //
    // Writing these three columns is only HALF of the claim; the transaction below has to
    // announce itself as well, or the trigger overwrites all of it. See there.
    if (ml !== null) {
      medicineData.unitsPerPack = ml;
      medicineData.packSizeConfidence = "VERIFIED";
      medicineData.packSizeSource = "DATA_SCRIPT";
      medicineData.packSizeVerifiedAt = new Date();
    }

    const overrides = await prisma.pharmacyMedicineOverride.findMany({
      where: { medicineId: med.id },
      select: { pharmacyId: true, unitsPerPack: true, allowLooseSale: true, looseByDefault: true },
    });
    const bogus = overrides.filter((o) => o.unitsPerPack !== null || o.allowLooseSale || o.looseByDefault);
    for (const o of overrides) {
      console.log(`   override[${o.pharmacyId}]: unitsPerPack=${o.unitsPerPack ?? "NULL"} `
        + `allowLooseSale=${o.allowLooseSale} looseByDefault=${o.looseByDefault}`);
    }

    // A row carrying the right volume but still marked UNVERIFIED is NOT already right — an
    // earlier run of this script (before it announced itself) left exactly that state, and
    // re-running is how it gets upgraded. Cheap to check, and the alternative is a correct
    // volume wearing an "unverified pack size" badge in triage forever.
    const medicineAlreadyRight = med.baseUnit === "ML"
      && (ml === null || med.unitsPerPack === ml)
      && (ml === null || med.packSizeConfidence === "VERIFIED")
      && !!med.form?.trim() && !!med.unit?.trim();
    if (medicineAlreadyRight && bogus.length === 0) {
      console.log("   → already correct, skipping.\n");
      continue;
    }

    if (!apply) {
      console.log(`   → WOULD SET ${JSON.stringify(medicineData)}`);
      if (bogus.length > 0) {
        console.log(`   → WOULD CLEAR unitsPerPack + loose flags on ${bogus.length} pharmacy override(s)`);
      }
      console.log("");
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // Opt out of the raw-write guard (migration 20260910000001).
      //
      // A BEFORE trigger on `medicines` stamps packSizeConfidence = UNVERIFIED and
      // packSizeSource = RAW_WRITE onto any write that does not set this GUC, and it
      // OVERWRITES rather than defaults — a raw write asserting VERIFIED is exactly the claim
      // it exists to disbelieve. That default is correct and this script is the reason it
      // exists: the original bad Melgain pack size arrived from a repair run just like this
      // one. Opting out is therefore a deliberate assertion, not a workaround, and it is only
      // defensible because --apply refuses to run without a volume somebody read off a pack.
      //
      // is_local => true scopes it to this transaction, so it cannot leak onto the next
      // borrower of a pooled connection. It must run INSIDE prisma.$transaction (which pins
      // one connection) and BEFORE the update — a session-level SET or a call outside the
      // transaction would either leak or land on a different connection entirely.
      await tx.$executeRaw`SELECT set_config('app.pack_size_evidence', 'on', true)`;
      await tx.medicine.update({ where: { id: med.id }, data: medicineData });
      if (bogus.length > 0) {
        await tx.pharmacyMedicineOverride.updateMany({
          where: { medicineId: med.id },
          // NULL, not 1: the override row means "use the catalogue value", and the
          // catalogue now carries the real volume set just above. Writing 1 would assert
          // that one bottle holds one mL. Loose selling goes off with it — a pharmacy that
          // genuinely decants by the mL can turn it back on against the corrected volume.
          data: { unitsPerPack: null, allowLooseSale: false, looseByDefault: false },
        });
      }
    });
    console.log(`   → updated catalogue${ml !== null ? ` (${ml} ml, recorded VERIFIED / DATA_SCRIPT)` : ""}`
      + `${bogus.length > 0 ? ` + cleared ${bogus.length} override(s)` : ""}.\n`);
  }

  if (!apply) {
    console.log("Dry run complete — no changes were written. Re-run with --apply to commit.");
  } else {
    console.log("Done. Pharmacists should set the real bottle volume via Inventory → Categorize / loose setup.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
