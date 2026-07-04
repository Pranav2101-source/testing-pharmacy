// ─── Row-level validation for each entity type ───────────────────────────────
// The actual validation logic now lives in the shared @pharmacy/utils
// migration-core so the synchronous import path (this module, via the service)
// and the async pg-boss worker (packages/jobs) validate rows identically —
// they used to be copy-pasted and drifted apart. This file re-exports the
// shared validators (and their result types) so existing imports keep working.

export {
  validateInventoryRow,
  validateSupplierRow,
  validateCustomerRow,
  validateDoctorRow,
  type ValidatedInventoryRow,
  type ValidatedSupplierRow,
  type ValidatedCustomerRow,
  type ValidatedDoctorRow,
} from "@pharmacy/utils";
