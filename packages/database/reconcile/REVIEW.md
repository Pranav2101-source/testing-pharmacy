# Step 2 — corrective migration, REVIEW ONLY (nothing applied to prod)

File to review: `prisma/migrations/20260908000001_reconcile_db_push_drift/migration.sql`

## What it does (8 sections)

| § | Change | Rows touched | Risk |
|---|---|---|---|
| 1 | `AuditModule` enum — drop unused `INTEGRATION` variant | 0 (`audit_logs` rewrite ~1 000 rows, brief `ACCESS EXCLUSIVE`) | low, run off-peak |
| 2 | Re-point 4 FKs `ON DELETE RESTRICT → SET NULL` (`grn_items.medicineId`, `inventory.medicineId`, `supplier_ledger_entries.grnId`, `.supplierReturnId`); drop FK on the dropped `prescription_items.substitutedFromMedicineId` | brief validation scan (≤2 000 rows) | low |
| 3 | Drop 3 indexes (`prescriptions_…sourceSystem…`, `goods_receipt_notes_…createdAt…` recreated ASC in §6, partial `pharmacies_emrApiKey_key` replaced in §6) | — | none |
| 4 | Drop dead columns: `prescription_items.{computedQuantity, emrItemId, quantityConfirmed, substitutedFromMedicineId}`, `prescriptions.{emrClinicId, emrDoctorId, emrPatientId, emrPrescriptionId, sourceSystem}`; convert `prescriptions.{dispenseNotifiedAt, dispenseNotifyNextAttemptAt}` `timestamptz → timestamp(3)` via explicit `AT TIME ZONE 'UTC'` (guarded) | all dropped cols **0 non-null** except `quantityConfirmed` (100 % `true`, entity no longer maps it); timestamp convert: 24 + 0 rows | **irreversible**, verified safe |
| 5 | `DROP TABLE … CASCADE` × 8 legacy tables | **all 0 rows, 0 inbound FKs, 0 views** | none |
| 6 | Create 3 indexes to match schema + plain-unique `pharmacies_emrApiKey_key` | index builds on ≤2 200-row tables | none |
| 7 | Rename `prescriptions_pharmacyId_externalEmrTenantId_externalEmrPrescri` → `…externalEmrPre_key` | — | none |

## Hand-edits vs the raw `migrate diff` output

1. **`pharmacies_emrApiKey_key`** — raw script would `CREATE` it without dropping the existing partial index of the same name → **guaranteed failure**. Added `DROP INDEX IF EXISTS` first (§3). Plain unique still allows many NULLs (~90/94 rows).
2. **timestamp casts** — raw script had bare `SET DATA TYPE TIMESTAMP(3)` (reinterprets against session TZ). Replaced with explicit `USING (col AT TIME ZONE 'UTC')`, wrapped in a `DO $$` guard so a from-scratch replay (already `timestamp(3)`) skips it.
3. **legacy-table FK drops** — raw script did `ALTER TABLE api_credentials DROP CONSTRAINT …`, which errors on a clean replay where those 3 tables never existed. Replaced with `DROP TABLE IF EXISTS … CASCADE` (CASCADE removes the table's own FKs; `IF EXISTS` covers the 3 push-only tables).

## Validation done (read-only / local only)

- ✅ Replays cleanly from scratch into a throwaway local shadow DB (`migrate diff --from-migrations … --shadow-database-url <local>` reached the diff stage with no apply error).
- ✅ A fresh `migrate diff --from-url <prod> --to-schema-datamodel schema.prisma` was regenerated and compared statement-by-statement — **this migration covers 100 % of it, nothing extra**. So: apply to prod ⇒ prod == `schema.prisma`.
- ✅ Every `DROP` target re-verified present on prod; every "0 rows / 0 non-null" claim re-queried.

## Known residual (NOT on prod — do not need it for this fix)

`migrate diff --from-migrations` still shows older **migration-history ↔ schema.prisma** debt that `db push` already silently fixed on prod and this migration deliberately does not touch:

- ~15 FK "drop + re-add" pairs (`audit_logs.userId`, `*.pharmacyId` on several child tables, `batch_recalls.recalledBy`, …) — prod already matches schema
- `prescriptions.{prescribedDate, validUntil, createdAt, updatedAt}` + `prescription_items.createdAt` are `TIMESTAMPTZ` in the old `20260618000005_prescriptions` migration — **prod already has them as `timestamp`**
- `batch_recalls.affectedIds` / `migration_sessions.completedSteps` array defaults; a stray standalone `invoices(doctorId)` index

**Optional follow-up** (separate PR, low priority): on a shadow DB run
`prisma migrate dev --name square_up_history` to capture that delta into one more
migration. It will be a near-total no-op against prod. Not required for `migrate deploy`
to work.

## Backup taken (2026-09-08)

Free tier = no PITR, and local `pg_dump` 16 can't dump the 17.6 server, so a **targeted
logical backup** was written via the Prisma client to
`C:/Users/prana/supabase-backups/2026-09-08T11-53-27_pre_reconcile/`:
- full rows of all 10 affected tables (8 to-be-dropped — all confirmed 0 rows; plus
  `prescriptions` 220 rows and `prescription_items` 383 rows, every column incl. the
  ones being dropped)
- `ddl_snapshot.json` — columns, constraints, indexes, enums, and the full
  `_prisma_migrations` table for the touched objects
- `medicines` (~252k rows) deliberately excluded — untouched by the migration, re-importable

This covers everything the migration can destroy. Combined with `migrate deploy` running
the whole file in one transaction (see header note — the inner BEGIN/COMMIT was removed so
it is truly all-or-nothing), it is a sufficient safety net.

## Proposed apply sequence (for when you approve — still NOT done)

1. ✅ Backup taken (above).
2. `cd packages/database` then, with `DATABASE_URL`/`DIRECT_URL` pointed at the session
   pooler (`aws-1-…pooler.supabase.com:5432`):
   `prisma migrate deploy` — applies **only** `20260908000001_reconcile_db_push_drift`
   (it is the sole pending migration) in one transaction, and records it. No
   `migrate resolve` needed.
3. `prisma migrate status` → "Database schema is up to date!"
4. `prisma migrate diff --exit-code --from-url <prod> --to-schema-datamodel schema.prisma`
   → exit 0 confirms prod == schema.
5. `cd apps/api-java && ./mvnw -q -Dtest='*' test` (or at least boot the app) — Hibernate
   `ddl-auto: validate` will fail loudly if any mapped column/table is now missing.
6. Commit the migration folder + `reconcile/`.
