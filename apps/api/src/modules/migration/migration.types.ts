// ─── Shared types for the migration module ───────────────────────────────────

export type MigrationEntityType = "INVENTORY" | "SUPPLIERS" | "CUSTOMERS" | "DOCTORS" | "MEDICINE";

// ── Column mapping ────────────────────────────────────────────────────────────

/** Our canonical field names that a CSV column can be mapped to. */
export type CanonicalField =
  // Inventory / medicine
  | "medicineName"
  | "batchNumber"
  | "expiryDate"
  | "quantity"
  | "mrp"
  | "purchaseRate"
  | "manufacturer"
  | "gstRate"
  | "hsnCode"
  | "minimumStock"
  // Supplier
  | "supplierName"
  | "gstin"
  | "dlNumber"
  | "phone"
  | "email"
  | "address"
  | "city"
  | "state"
  | "creditDays"
  | "openingBalance"
  // Customer
  | "customerName"
  | "dateOfBirth"
  | "gender"
  | "creditLimit"
  | "openingDue"
  | "abhaNumber"
  | "cardNumber"
  | "notes"
  // Doctor
  | "doctorName"
  | "registrationNo"
  | "specialty"
  | "clinic";

export interface ColumnDetection {
  csvHeader:       string;
  suggestedField:  CanonicalField | null;
  confidence:      "high" | "medium" | "low" | "none";
}

/** { "Item Name": "medicineName", "Batch No": "batchNumber", ... } */
export type ColumnMappings = Record<string, CanonicalField>;

// ── Parsed rows ───────────────────────────────────────────────────────────────

export interface ParsedInventoryRow {
  rowNumber:    number;
  medicineName: string;
  batchNumber:  string;
  expiryDate:   string;   // ISO string after normalisation
  quantity:     number;
  mrp:          number;
  purchaseRate: number;
  gstRate:      number;
  manufacturer?: string;
  hsnCode?:     string;
  minimumStock?: number;
}

export interface ParsedSupplierRow {
  rowNumber:      number;
  supplierName:   string;
  gstin?:         string;
  dlNumber?:      string;
  phone?:         string;
  email?:         string;
  address?:       string;
  city?:          string;
  state?:         string;
  creditDays?:    number;
  openingBalance?: number;
}

export interface ParsedCustomerRow {
  rowNumber:      number;
  customerName:   string;
  phone?:         string;
  email?:         string;
  address?:       string;
  dateOfBirth?:   string;
  gender?:        string;
  creditLimit?:   number;
  openingDue?:    number;
  abhaNumber?:    string;
  cardNumber?:    string;
  notes?:         string;
}

export interface ParsedDoctorRow {
  rowNumber:      number;
  doctorName:     string;
  registrationNo?: string;
  specialty?:     string;
  clinic?:        string;
  phone?:         string;
  email?:         string;
}

// ── Validation ────────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface RowIssue {
  row:      number;
  field?:   string;
  message:  string;
  severity: ValidationSeverity;
}

// ── Medicine matching ─────────────────────────────────────────────────────────

export interface MedicineSuggestion {
  csvValue:    string;             // e.g. "PCM 500"
  suggestions: CatalogMatch[];     // top 3 from Meilisearch
  existingMapping?: {              // already confirmed in a prior session
    medicineId: string | null;
    isNew:      boolean;
  };
}

export interface CatalogMatch {
  medicineId:   string;
  name:         string;
  genericName?: string;
  manufacturer?: string;
  form?:        string;
  strength?:    string;
  confidence:   number;            // 0–1
}

// ── Commit results ────────────────────────────────────────────────────────────

export interface CommitResult {
  entityType:   MigrationEntityType;
  totalRows:    number;
  successRows:  number;
  failedRows:   number;
  errors:       RowIssue[];
  jobId?:       string;           // set when dispatched to pg-boss
  async:        boolean;
}
