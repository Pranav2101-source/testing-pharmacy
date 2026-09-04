import {
  Check, ShieldAlert, Clock, Skull,
} from "lucide-react";

// ─── Core types ───────────────────────────────────────────────────────────────

export type BatchStatus = "ACTIVE" | "QUARANTINE" | "EXPIRED" | "DAMAGED";

export type InventoryItem = {
  id:               string;
  batchNumber:      string;
  expiryDate:       string;
  quantity:         number;
  /** Loose pieces from an opened pack (cut-strip selling). 0 for pack-only stock. */
  looseUnits?:      number;
  reservedQuantity: number;
  purchaseRate:     number;
  mrp:              number;
  location:         string | null;
  shelfId:          string | null;
  minimumStock:     number;
  reorderLevel:     number;
  status:           BatchStatus;
  medicine: {
    id:          string;
    name:        string;
    genericName: string | null;
    category:    string | null;
    form:        string | null;
    strength:    string | null;
    unit:        string | null;
    hsnCode:     string | null;
    gstRate:     number;
    isActive:    boolean;
    brand:       { id: string; name: string } | null;
    unitsPerPack?:   number | null;
    baseUnit?:       string | null;
    allowLooseSale?: boolean;
    looseByDefault?: boolean;
    /** Catalogue values (not pharmacy-specific) — drive the Inventory "enable loose selling" flow. */
    schedule?:       string | null;
    packSize?:       string | null;
  };
  shelf: { id: string; code: string; rack: { id: string; code: string; name: string } } | null;
};

export type LedgerEntry = {
  id:             string;
  type:           string;
  direction:      "IN" | "OUT";
  quantity:       number;
  quantityBefore: number;
  quantityAfter:  number;
  referenceType:  string | null;
  notes:          string | null;
  // Set only on a loose (cut-strip) row: the unit ("TABLET" | "CAPSULE" | "ML" | "GM" | "EACH")
  // that quantity / before / after are counted in for that row. null → the row is in whole packs.
  baseUnit:       string | null;
  createdAt:      string;
  inventory: { batchNumber: string; medicine: { name: string; genericName: string | null } };
  user:       { id: string; name: string };
};

export type ShelfOption = { id: string; code: string; level: number; rack: { id: string; code: string; name: string } };

export type AlertCounts = { expiry: number; lowStock: number };

// ─── AI insight types ──────────────────────────────────────────────────────────

export type WasteRiskTier = "HIGH" | "MEDIUM" | "LOW" | "SAFE" | "NO_DATA";

export type WasteRisk = {
  avgDailySales: number;
  willSellUnits: number;
  atRiskUnits:   number;
  potentialLoss: number;
  riskTier:      WasteRiskTier;
};

export type ReorderInsight = {
  avgDailySales: number;
  suggestedQty:  number;
  coverDays:     number;
  leadTimeDays:  number;
  hasData:       boolean;
};

export type CalibrateChange = {
  medicineId:    string;
  medicineName:  string;
  oldMin:        number;
  newMin:        number;
  avgDailySales: number;
};

export type CalibrateResult = {
  updated:  number;
  skipped:  number;
  analyzed: number;
  changes:  CalibrateChange[];
};

// ─── Alert tier types ───────────────────────────────────────────────────────────

export type ExpiryTier = "EXPIRED" | "CRITICAL" | "WARNING" | "NOTICE";
export type StockTier  = "OUT_OF_STOCK" | "REORDER" | "LOW";

export type ExpiryAlert = InventoryItem & { tier: ExpiryTier; daysToExpiry: number; wasteRisk: WasteRisk };
export type StockAlert  = InventoryItem & { tier: StockTier; reorder: ReorderInsight };

// ─── Page tabs ────────────────────────────────────────────────────────────────

export type PageTab = "batches" | "ledger" | "alerts" | "audit";
export const VALID_TABS: PageTab[] = ["batches", "ledger", "alerts", "audit"];

// ─── Display-config constants ──────────────────────────────────────────────────

export const BATCH_STATUS_CFG: Record<BatchStatus, { label: string; cls: string; icon: React.ElementType }> = {
  ACTIVE:     { label: "Active",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Check        },
  QUARANTINE: { label: "Quarantine", cls: "bg-amber-50   text-amber-700   border-amber-200",  icon: ShieldAlert  },
  EXPIRED:    { label: "Expired",    cls: "bg-red-50     text-red-600     border-red-200",    icon: Clock        },
  DAMAGED:    { label: "Damaged",    cls: "bg-gray-100   text-gray-600    border-gray-200",   icon: Skull        },
};

export const REFERENCE_TYPE_LABEL: Record<string, string> = {
  GRN:            "GRN",
  INVOICE:        "Invoice",
  INVOICE_CANCEL: "Invoice Cancel",
  SALES_RETURN:   "Sales Return",
  SUPPLIER_RETURN:"Supplier Return",
  BATCH_RECALL:   "Batch Recall",
  STATUS_CHANGE:  "Status Change",
  STOCK_AUDIT:    "Stock Audit",
  CORRECTION:     "Correction",
  DAMAGE:         "Damage",
  EXPIRY_WRITEOFF:"Expiry Write-off",
  OPENING_BALANCE:"Opening Balance",
  TRANSFER:       "Transfer",
  THEFT:          "Theft",
  BREAKAGE:       "Breakage",
  STOCK_COUNT:    "Stock Count",
  OTHER:          "Other",
};

export const MOVEMENT_TYPE_CFG: Record<string, string> = {
  SALE:           "text-red-600",
  RETURN:         "text-emerald-600",
  PURCHASE:       "text-blue-600",
  ADJUSTMENT:     "text-amber-600",
  OPENING:        "text-purple-600",
  DAMAGE:         "text-gray-600",
  EXPIRY_REMOVAL: "text-orange-600",
};

export const TAB_COLORS = {
  blue:   { border: "border-blue-600",   text: "text-blue-700",   badge: "bg-blue-100 text-blue-700",     icon: "text-blue-600"   },
  purple: { border: "border-purple-600", text: "text-purple-700", badge: "bg-purple-100 text-purple-700", icon: "text-purple-600" },
  red:    { border: "border-red-600",    text: "text-red-700",    badge: "bg-red-100 text-red-700",       icon: "text-red-600"    },
  orange: { border: "border-orange-500", text: "text-orange-700", badge: "bg-orange-100 text-orange-700", icon: "text-orange-500" },
} as const;

// Ordered by daily frequency of use in a pharmacy
export const ADJUSTMENT_REASONS = [
  { value: "STOCK_COUNT",     label: "Physical Count",   hint: "After counting actual shelf stock"  },
  { value: "CORRECTION",      label: "Correction",       hint: "Fix a data entry mistake"           },
  { value: "DAMAGE",          label: "Damage",           hint: "Physically damaged — cannot sell"   },
  { value: "EXPIRY_WRITEOFF", label: "Expiry Write-off", hint: "Remove expired batch from stock"    },
  { value: "BREAKAGE",        label: "Breakage",         hint: "Broken vials, tablets, strips"      },
  { value: "THEFT",           label: "Theft / Loss",     hint: "Missing or stolen items"            },
  { value: "TRANSFER",        label: "Transfer",         hint: "Move stock to / from another store" },
  { value: "OPENING_BALANCE", label: "Opening Balance",  hint: "First-time entry for this batch"    },
  { value: "OTHER",           label: "Other",            hint: "Describe in notes below"            },
] as const;

export const WASTE_RISK_CFG: Record<WasteRiskTier, { label: string; cls: string }> = {
  HIGH:    { label: "High Risk",  cls: "bg-red-50    text-red-700   border-red-300"    },
  MEDIUM:  { label: "Med Risk",   cls: "bg-orange-50 text-orange-700 border-orange-200" },
  LOW:     { label: "Low Risk",   cls: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  SAFE:    { label: "All Clear",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  NO_DATA: { label: "No Data",   cls: "bg-slate-100 text-slate-500  border-slate-200"  },
};

export const EXPIRY_TIER_CFG: Record<ExpiryTier, { label: string; rowCls: string; badgeCls: string }> = {
  EXPIRED:  { label: "Expired",   rowCls: "bg-red-50/40",    badgeCls: "bg-red-100     text-red-700   border-red-300"   },
  CRITICAL: { label: "≤ 30 days", rowCls: "bg-orange-50/30", badgeCls: "bg-orange-50   text-orange-700 border-orange-200" },
  WARNING:  { label: "31–60 days",rowCls: "bg-amber-50/20",  badgeCls: "bg-amber-50    text-amber-700  border-amber-200"  },
  NOTICE:   { label: "61–90 days",rowCls: "",                badgeCls: "bg-yellow-50   text-yellow-700 border-yellow-200" },
};

export const STOCK_TIER_CFG: Record<StockTier, { label: string; badgeCls: string }> = {
  OUT_OF_STOCK: { label: "Out of Stock", badgeCls: "bg-red-100   text-red-700   border-red-300"   },
  REORDER:      { label: "Reorder Now",  badgeCls: "bg-orange-50 text-orange-700 border-orange-200" },
  LOW:          { label: "Low Stock",    badgeCls: "bg-amber-50  text-amber-700  border-amber-200"  },
};
