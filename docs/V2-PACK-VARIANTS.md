# V2 — Pack Variants (multi pack size under one medicine)

**Status:** deferred. Phase 1–3 (unit-aware quantity for syrup / tonic / cream) shipped
with the one-size-per-SKU model below. This document records the follow-up.

## Today's model (V1)

The sealed pack size — the mL/g in one bottle/tube, and the tablets in one strip — lives
on the **medicine**, not the batch:

- `Medicine.unitsPerPack` — global catalogue value
- `PharmacyMedicineOverride.unitsPerPack` — this pharmacy's value, wins over catalogue
- `InvoiceItem.unitsPerPack` — snapshot at sale time
- The dispensing engine resolves `COALESCE(override, medicine.unitsPerPack)`
- `Inventory` (the batch) carries **no** pack size — only `quantity` (pack count), `mrp`
  (per batch) and `looseUnits`

So **one medicine = one pack size, per pharmacy.**

### How multiple sizes are handled now

Each fill volume is its **own catalogue medicine**, exactly as a tablet's 10s and 15s
strips are separate entries:

| Catalogue entry | `unitsPerPack` | `baseUnit` | own MRP | own barcode |
|---|---|---|---|---|
| Benadryl Cough Syrup 50 ml  | 50  | ML | ✔ | ✔ |
| Benadryl Cough Syrup 100 ml | 100 | ML | ✔ | ✔ |
| Benadryl Cough Syrup 200 ml | 200 | ML | ✔ | ✔ |

The pharmacist picks the size on the shelf; a barcode scan disambiguates automatically.
Per-mL price = `batch.mrp ÷ that SKU's unitsPerPack`, always correct because every batch
under one SKU is the same fill.

### V1 guard rails (shipped alongside this doc)

`PackSizeGuard` (`common/util`):

- **Catalogue create / update** — a measured medicine whose free-text `packSize` names one
  volume while `unitsPerPack` says another is **rejected** (400): a SKU that disagrees with
  itself would mis-price every loose sale.
- **Manual add-stock & GRN confirm** — for a measured medicine that is loose-sale-enabled
  or has a structured pack size, a new batch whose MRP is well outside the medicine's
  current stock (`< 0.62×` or `> 1.6×` the median) raises a **non-blocking warning**
  ("this looks like a different bottle size — receive it as its own medicine"). Never
  blocks a legitimate receipt (a real price revision can trip it too).

## The V1 limitation

If a shop lumps every size under **one generic row** and stocks mixed fills:

- `mrp` is per-batch (fine) but `unitsPerPack` is a single value → a 200 ml batch billed
  as 100 ml is a **2× overcharge on a loose sale**
- "total mL on hand" drifts

This is the same boundary tablets already have — there is no per-batch strip size either.
The V1 guard rails make the mistake loud; they don't make the model support it.

## V2 requirement

Support **one medicine name with several pack sizes**, so a pharmacist searches "Benadryl
Syrup" once and sees / stocks 50 / 100 / 200 ml under it without three near-duplicate
catalogue rows.

### Option A — per-batch fill size (smaller change)

- Add `Inventory.unitsPerPack Int?` (and record it on the GRN line / add-stock form).
  `NULL` falls back to the medicine's value — every existing row is unaffected.
- Dispensing / billing / loose pricing read the **batch's** `unitsPerPack` when set,
  else the medicine's.
- `InvoiceItem.unitsPerPack` already snapshots per line — no change to the sale record.
- Search still shows one medicine; the batch picker shows "100 ml" / "200 ml" per batch.

**Cost:** every place that reads `medicine.unitsPerPack` for math must prefer
`batch.unitsPerPack` — dispensing engine, `BillingService`, `prescriptionToCart`,
stock-summary, reports' pack/piece folding. Migration is additive (nullable column).

### Option B — first-class pack variants (larger change)

- A `MedicineVariant` child of `Medicine` — `{ size, unitsPerPack, baseUnit, mrp, barcode,
  hsnCode? }`. `Inventory`, `GRNItem`, `InvoiceItem`, `PrescriptionItem` gain a nullable
  `variantId`.
- The parent `Medicine` becomes a grouping; search returns the parent, expands to variants.
- Prescription matching links to the parent, pharmacist picks the variant at triage.

**Cost:** touches every medicine-linked table and every read path; a real migration.
Only worth it if variant-level attributes beyond size (barcode, HSN, scheme) diverge often.

### Recommendation

Start with **Option A**. It removes the 2× loose-pricing hazard, keeps one search result
per medicine, and is an additive migration. Move to Option B only if shops turn out to
need variant-level barcodes / pricing that Option A can't express.

### Out of scope for V2 too

- Auto-splitting an existing mixed-size generic row into sized variants (a one-off data
  cleanup tool, if ever needed).
- Dispensing loose across two different bottle sizes in one line.
