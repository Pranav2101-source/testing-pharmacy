# Supabase migration reconciliation — analysis (READ-ONLY, nothing executed)

DB: `wgaqsrzcisdpbftntjde` (Supabase, prod). Inspected via read-only catalog queries
(`information_schema`, `pg_catalog`) over the transaction pooler, and one
`prisma migrate diff --script` (introspection only — issues no DDL, applied nothing).

`_prisma_migrations`: 68 rows — 66 `ok`, 2 `rolled_back`. 18 migration folders have no row.
Actual schema was moved forward with `prisma db push`, so **almost every "pending" object
already physically exists**. The 3 branch-tip migrations
(`20260905000002`, `20260907000001`, `20260907000002`) were stamped applied today at an
identical timestamp (`migrate resolve --applied`) — their objects *are* present and correct.

Legend for "current DB state": **FULL** = every object the migration creates already exists
and matches; **PARTIAL** = some exists; **MISSING** = none exists.

---

## The 18 unrecorded migrations

| # | Migration | Intended changes | Current DB state | Safe to `resolve --applied`? | Reason / caveat |
|---|---|---|---|---|---|
| 1 | `20260814000001_grn_item_igst` | `grn_items.igst DECIMAL(12,2) NOT NULL DEFAULT 0` | **FULL** — `numeric(12,2) NOT NULL default 0` | ✅ Yes | Column present & typed correctly. SQL is `IF NOT EXISTS` (also re-runnable). |
| 2 | `20260814000002_supplier_return_confirmed_at` | `supplier_returns.confirmedAt TIMESTAMP(3)` + backfill `= updatedAt WHERE status='CONFIRMED'` | **FULL** (column) — nullable `timestamp`; backfill state not verifiable but idempotent | ✅ Yes | Column present. Optionally re-run the backfill `UPDATE` by hand (idempotent, 8 rows) to be certain. |
| 3 | `20260818000001_medicine_catalogue_trgm_search` | `pg_trgm` ext; 3 GIN tr's on `LOWER(name/genericName/manufacturer)`; 2 btree on `LOWER(name/genericName)` | **FULL** — extension + all 5 indexes present, defs match | ✅ Yes | Entirely `IF NOT EXISTS`. |
| 4 | `20260819000003_emr_dispense_callback` | `prescriptions.dispenseNotify{Status,edAt,Error,Attempts,NextAttemptAt}`; partial idx `prescriptions_dispense_notify_due_idx`; `prescription_items.dispensedMedicine{Id,Name}` | **FULL** — all columns + index present | ✅ Yes | ⚠️ `dispenseNotifiedAt` / `dispenseNotifyNextAttemptAt` are `timestamptz` in DB vs `TIMESTAMP(3)` in the migration/schema. Pre-existing drift (not from this migration). Handle in corrective step. |
| 5 | `20260820000001_emr_legacy_pairing` | `pharmacies.emr{ClinicExternalId,ClinicLinkId,PairedAt,ApiKey,ApiSecretHash,WebhookSecretCiphertext/Iv/Tag}`; **partial** unique `pharmacies_emrApiKey_key WHERE emrApiKey IS NOT NULL` | **FULL** — all columns + partial unique index present | ✅ Yes | ⚠️ `schema.prisma` models `emrApiKey` as a plain `@unique` (non-partial). Corrective diff tries to "add" it → name clash (see corrective-script risks). |
| 6 | `20260820000002_prescription_viewed_at` | `prescriptions.viewedAt TIMESTAMP(3)` | **FULL** — `timestamp`, nullable | ✅ Yes | `IF NOT EXISTS`. |
| 7 | `20260822000002_prescription_cancel_notify` | `prescriptions.cancelNotify{Status,edAt,Error,Attempts,NextAttemptAt}`; partial idx `prescriptions_cancel_notify_due_idx` | **FULL** — 5 columns + index present | ✅ Yes | `IF NOT EXISTS` throughout. |
| 8 | `20260823000001_prescription_perf_indexes` | `prescriptions_unviewed_emr_idx`, `prescriptions_emr_sourced_idx`; `pg_trgm` + `btree_gin`; 3 GIN idx `prescriptions_pharmacyId_{patientName,doctorName,prescriptionNumber}_lower_trgm_idx` | **FULL** — `btree_gin` ext + all 5 indexes present | ✅ Yes | `IF NOT EXISTS` throughout. |
| 9 | `20260823000002_emr_pairing_lookup_hash` | `pharmacies.emrSecretLookupHash TEXT`; partial idx `pharmacies_emr_secret_lookup_hash_idx` | **FULL** — column + index present | ✅ Yes | `IF NOT EXISTS`. |
| 10 | `20260826000001_grn_created_confirmed_by` | `goods_receipt_notes.createdBy/confirmedBy TEXT`; 2 FKs → `users(id)` `ON DELETE SET NULL ON UPDATE CASCADE` | **FULL** — both columns + both FKs present, defs match exactly | ✅ Yes | 🚫 **Not idempotent** (bare `ADD COLUMN` / `ADD CONSTRAINT`). Must NOT go through `migrate deploy` — it would abort. `resolve --applied` only. |
| 11 | `20260901000001_loose_dispensing` | `medicines.unitsPerPack/baseUnit`; `inventory.looseUnits`; `invoice_items.saleUnit`; `pharmacy_medicine_overrides.allowLooseSale`; 3 CHECKs; backfill of `baseUnit`/`unitsPerPack` for stocked meds | **FULL** — all columns + `inventory_looseUnits_nonneg` + `invoice_items_saleUnit_check` present. `medicines_unitsPerPack_positive` present at the **tighter** def from #12 (superset — fine) | ✅ Yes | `IF NOT EXISTS` + `DROP/ADD CONSTRAINT`. Backfill re-runnable & harmless. |
| 12 | `20260901000002_loose_dispensing_guards` | retighten `medicines_unitsPerPack_positive` → `>=1 AND <=100000`; `pharmacy_medicine_overrides.unitsPerPack` + CHECK `pmo_unitsPerPack_range >=2..100000` | **FULL** — constraint at exact target def; column + range check present | ✅ Yes | Re-runnable. |
| 13 | `20260901000003_invoice_item_base_unit` | `invoice_items.baseUnit TEXT` | **FULL** | ✅ Yes | `IF NOT EXISTS`. |
| 14 | `20260901000004_loose_pos_defaults` | `pharmacy_medicine_overrides.looseByDefault BOOL`, `looseConfirmedAt TIMESTAMP(3)` | **FULL** — both columns present | ✅ Yes | `IF NOT EXISTS`. |
| 15 | `20260901000005_stock_audit_loose` | `stock_audit_items.{expected,counted,variance}LooseUnits` | **FULL** — all 3 present | ✅ Yes | `IF NOT EXISTS`. |
| 16 | `20260901000006_inventory_movement_base_unit` | `inventory_movements.baseUnit TEXT` | **FULL** | ✅ Yes | `IF NOT EXISTS`. |
| 17 | `20260904000001_pharmacy_medicine` | `MedicineMatchStatus` enum; `pharmacy_medicines` table + 2 FKs + 2 idx + RLS + policy; `grn_items`/`inventory`: `+localMedicineId`, `medicineId DROP NOT NULL`, `+FK`, `+xor CHECK`, `+idx`, `inventory` partial-unique | **FULL** — enum, table (RLS on+forced, policy `tenant_isolation`), both FKs, both idx; `grn_items` & `inventory`: `localMedicineId` present, `medicineId` now `NULLABLE`, xor checks + FKs + indexes + partial unique all present | ✅ Yes | 🚫 **Completely non-idempotent** (`CREATE TYPE`, `CREATE TABLE`, bare `ALTER`). `migrate deploy` would fail on line 1 (`type already exists`). `resolve --applied` is the **only** safe path. `pharmacy_medicines` = 0 rows, 0 local rows in grn/inv → xor checks hold trivially. |
| 18 | `20260905000001_medicine_composition_trgm_search` | GIN idx `medicines_composition_lower_trgm_idx` on `LOWER(composition)` | **FULL** | ✅ Yes | `IF NOT EXISTS`. |

**All 18 → `resolve --applied` is safe.** None needs SQL executed; every object is already
present. #10 and #17 are the ones where `resolve` (not `deploy`) genuinely matters — their
SQL is not re-runnable.

---

## The 2 rolled-back migrations

| Migration | Intended changes | Current DB state | Safe to `resolve --applied`? | Reason / caveat |
|---|---|---|---|---|
| `20260612000001_decimal_money_and_document_sequences` | ~20 tables' money cols → `DECIMAL(12,2)`; `medicines.catalogMrp` add+convert; `CREATE TABLE document_sequences` + FK + seed counters from existing doc numbers | **FULL** — `invoices.totalAmount/subtotal`, `medicines.gstRate/catalogMrp` = `numeric(12,2)`; `document_sequences` present, FK present, RLS on, **108 rows** (counters seeded) | ✅ Yes | Ledger row: `rolled_back_at` set, `finished_at NULL`, `steps 0`. Work fully landed later (push / manual). `resolve --applied` will clear `rolled_back_at` and stamp it done. Nothing re-executed → the big `ALTER`s and the seed are not re-run. |
| `20260618000005_prescriptions` | `PrescriptionStatus` enum; `CREATE TABLE prescriptions` + `prescription_items` (+pkeys/FKs/unique/idx); rewire `invoices.prescriptionId` FK `uploads`→`prescriptions` **+ `UPDATE invoices SET prescriptionId = NULL`**; RLS + policies + `GRANT ... TO app_user`; `purchase_order_items_purchaseOrderId_idx` | **FULL** — enum present; `prescriptions` (**219 rows**) + `prescription_items` (**382 rows**) present, RLS + policies present; PO-items index present | ✅ Yes | Ledger row `rolled_back` 2026-06-20. ⚠️ The destructive `UPDATE invoices SET prescriptionId = NULL` already ran long ago — **must not be re-executed**. `resolve --applied` does not re-run it. |

---

## Corrective drift script — object-by-object (file: `corrective_diff_DB_to_schema.sql`)

This is what `migrate diff (DB → schema.prisma)` produced. It is the gap between the
**physical DB** and **`schema.prisma`** — i.e. what `db push` left behind that no migration
covers. **It is NOT ready to run as-is** (one guaranteed failure, two fragile casts).

### ✅ Safe — additive
| Statement | Note |
|---|---|
| `CREATE INDEX inventory_pharmacyId_status_medicineId_createdAt_idx` | Genuinely missing; not in any migration — schema-only. Large table (2 011 rows) — trivial. Consider `CONCURRENTLY`. |
| `CREATE INDEX inventory_movements_inventoryId_direction_type_createdAt_idx` | Same — genuinely missing, additive. |

### ✅ Safe — verified zero-impact
| Statement(s) | Verification |
|---|---|
| `DROP TABLE api_credentials, clinic_links, invoice_settings, pairing_codes, purchase_order_items, supplier_credit_notes, supplier_payments, supplier_return_items` (+ their `DROP CONSTRAINT` FK lines) | **All 8 tables = 0 rows.** Superseded: PO-items/return-items/credit-notes/payments folded into JSON columns / `supplier_ledger_entries`; `invoice_settings` inlined to `pharmacies.invoiceSettings`; `api_credentials`/`clinic_links`/`pairing_codes` = old EMR design. No inbound FKs from live tables. |
| `AlterEnum "AuditModule"` (remove `INTEGRATION`) | **0 `audit_logs` rows** use `INTEGRATION` (distinct values: AUTH, SETTINGS, SYSTEM, SUBSCRIPTIONS, TENANTS, SUPPORT, ANALYTICS). Transactional block; brief `ACCESS EXCLUSIVE` on `audit_logs` (883 rows) — run off-peak. |
| `ALTER TABLE prescription_items DROP COLUMN computedQuantity, emrItemId, quantityConfirmed, substitutedFromMedicineId` | `computedQuantity`, `emrItemId`, `substitutedFromMedicineId` = **0 populated**. `quantityConfirmed` NOT NULL but **100 % `true`** (feature superseded by `quantityAutoCalculated`). Current `PrescriptionItem.java` entity maps **none** of these 4; no other Java refs. Hibernate `ddl-auto: validate` tolerates the extra columns today, so dropping is cosmetic-safe but **irreversible**. |
| `ALTER TABLE prescriptions DROP COLUMN emrClinicId, emrDoctorId, emrPatientId, emrPrescriptionId, sourceSystem` | **All 5 = 0 populated** (new design uses `externalEmr*`, 204 rows). Java hits are wire/DTO fields, not columns. Safe, irreversible. |
| `DROP INDEX prescriptions_pharmacyId_sourceSystem_createdAt_idx` | Indexes `sourceSystem`, which is being dropped — must go with it. |
| `ALTER INDEX prescriptions_pharmacyId_externalEmrTenantId_externalEmrPrescri RENAME TO ..._key` | Pure rename. |

### ⚠️ Must hand-edit before running
| Statement | Problem | Fix |
|---|---|---|
| `CREATE UNIQUE INDEX "pharmacies_emrApiKey_key" ON "pharmacies"("emrApiKey")` (line 142) | **Guaranteed failure** — name already taken by the *partial* unique index from migration #5. Aborts the whole script here. | Prepend `DROP INDEX "pharmacies_emrApiKey_key";`, or (better) change `schema.prisma` to keep the partial index and drop this line. Non-null `emrApiKey` values are unique (all pharmacies unpaired) so either index is valid. |
| `ALTER COLUMN "dispenseNotifiedAt" SET DATA TYPE TIMESTAMP(3)` + `dispenseNotifyNextAttemptAt` (lines 105–106) | `timestamptz → timestamp` with **no `USING` clause** → values reinterpreted against session `TimeZone`. 24 rows have `dispenseNotifiedAt`. | Either add `USING "dispenseNotifiedAt" AT TIME ZONE 'UTC'`, **or** change `schema.prisma` to `@db.Timestamptz(3)` for these two fields and drop the ALTER (align schema → DB; less risk). |
| `DropForeignKey`+`AddForeignKey` for `grn_items_medicineId_fkey`, `inventory_medicineId_fkey` (lines 22/25 → 145/148) | Real change: `RESTRICT/NO ACTION` → `ON DELETE SET NULL` (correct now that `medicineId` is nullable, per migration #17 — but #17 never altered the existing FK). | Keep. Low risk, brief lock. Order: drop then re-add in same txn. |
| `DropForeignKey`+`AddForeignKey` for `supplier_ledger_entries_grnId_fkey`, `supplier_ledger_entries_supplierReturnId_fkey` (lines 58/61 → 151/154) | FK re-point to `SET NULL`. | Keep; low risk. |
| `DROP INDEX` + `CREATE INDEX goods_receipt_notes_pharmacyId_status_createdAt_idx` (lines 88 → 133) | DB has `... "createdAt" DESC`; schema wants no `DESC`. Cosmetic. | Optional — either keep (drop+recreate) or align `schema.prisma` and skip. |

### Recommended reconciliation sequence (for your review — NOT run)
1. `prisma migrate resolve --applied <name>` for the **18** (any order — all independent).
2. For the **2 rolled-back**: `prisma migrate resolve --applied <name>` (if Prisma refuses
   a rolled-back row, the fallback is a one-line `UPDATE _prisma_migrations SET
   finished_at = now(), rolled_back_at = NULL, applied_steps_count = 1 WHERE migration_name
   = ...` — a manual write, needs explicit approval).
3. `prisma migrate status` → should now report **"Database schema is up to date"** for the
   ledger, with only the drift remaining.
4. Hand-edit `corrective_diff_DB_to_schema.sql` per the ⚠️ table → save as a **new**
   migration folder `20260908000001_reconcile_db_push_drift/migration.sql`.
5. Apply that one migration in a transaction against the **session pooler / direct**
   connection (home-network firewall blocks `db.<ref>.supabase.co:5432`; use
   `aws-1-...pooler.supabase.com:5432`), then `migrate resolve --applied` it (since it was
   run by hand) — or `migrate deploy` it if it's the only pending one and fully idempotent.
6. `prisma migrate diff --exit-code --from-url <db> --to-schema-datamodel schema.prisma`
   → exit 0 confirms DB == schema.
