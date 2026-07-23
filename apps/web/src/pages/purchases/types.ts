import {
  Clock, Send, Package, CheckCircle2, XCircle,
  FileText, Truck, BarChart3, RotateCcw, Building2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type POStatus       = "DRAFT" | "PENDING" | "PARTIAL" | "RECEIVED" | "CANCELLED";
export type ApprovalStatus = "NOT_REQUIRED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
export type GRNStatus      = "DRAFT" | "CONFIRMED" | "CANCELLED";
export type SRStatus       = "DRAFT" | "CONFIRMED" | "CANCELLED";

export type PurchaseOrder = {
  id: string; orderNumber: string; invoiceNo: string | null;
  status: POStatus; approvalStatus: ApprovalStatus;
  subtotal: number; totalGst: number; totalAmount: number;
  notes: string | null; orderedAt: string; expectedDate: string | null;
  sourceUploadId: string | null;
  supplier: { id: string; name: string };
  // The backend sends a flat count here, not a Prisma-style `_count` wrapper
  // (unlike Supplier/SupplierHistory, which do use `_count` — see GrnResponse
  // and PurchaseOrderResponse on the Java side for the actual shapes).
  itemCount: number;
};

export type GRN = {
  id: string; grnNumber: string; supplierInvoiceNo: string | null;
  status: GRNStatus; subtotal: number; totalGst: number; totalAmount: number;
  createdAt: string; confirmedAt: string | null; paymentDueDate: string | null;
  sourceUploadId: string | null;
  supplier: { id: string; name: string };
  purchaseOrder: { id: string; orderNumber: string } | null;
  // The list endpoint sends `itemCount` and an EMPTY `items` array (it never needs
  // the lines, only the count); the detail/create endpoints send both. Always read
  // the count via `itemCount`, falling back to items.length for any older cached row.
  itemCount: number;
  items?: unknown[];
};

export type SupplierReturn = {
  id: string; returnNumber: string; debitNoteNo: string | null;
  status: SRStatus; totalAmount: number; createdAt: string;
  supplier: { id: string; name: string };
  itemCount: number;
};

export type Supplier = { id: string; name: string; phone?: string };

export type Medicine = {
  id: string; name: string; genericName: string | null;
  gstRate: number; hsnCode: string | null;
};

export type POLineItem = {
  medicineId: string; medicineName: string; batchNumber: string;
  expiryDate: string; quantity: number; purchaseRate: number; mrp: number; gstRate: number;
};

export type GRNLineItem = {
  medicineId: string; medicineName: string; batchNumber: string; expiryDate: string;
  orderedQty: number; receivedQty: number; freeQty: number;
  purchaseRate: number; mrp: number; discount: number; gstRate: number;
};

export type SRLineItem = {
  inventoryId: string; medicineId: string; medicineName: string;
  batchNumber: string; expiryDate: string; quantity: number;
  purchaseRate: number; reason: string;
};

export type SupplierFormState = {
  name: string; gstin: string; dlNumber: string; phone: string; email: string;
  address: string; city: string; state: string;
  creditLimit: string; creditDays: string; paymentTerms: string;
};

export type FullSupplier = Supplier & {
  gstin: string | null; dlNumber: string | null; email: string | null;
  address: string | null; city: string | null; state: string | null;
  creditLimit: number; creditDays: number; paymentTerms: string | null;
  ledgerBalance: number;
  isActive: boolean; _count: { purchaseOrders: number };
};

export type AutoSuggestion = {
  medicineId: string; medicineName: string; currentStock: number;
  avgDailySales: number; daysOfStock: number; suggestedQuantity: number;
};

export type InventoryBatch = {
  id: string; batchNumber: string; expiryDate: string;
  quantity: number; purchaseRate: number;
  medicine: { id: string; name: string };
};

export type HistoryData = {
  orders:     { items: { id: string; orderNumber: string; status: string; totalAmount: number; orderedAt: string; _count: { items: number } }[] };
  recentGRNs: { id: string; grnNumber: string; status: string; totalAmount: number; createdAt: string }[];
  summary:    { totalOrders: number; totalSpend: number };
};

export type Tab = "purchase" | "gate-inward" | "po" | "returns" | "distributors";

export type PanelType =
  | "auto-suggest" | "overdue-bills" | "pending-approvals"
  | "quick-payment" | "credit-note" | null;

export type QABtn = {
  icon:     React.ElementType;
  label:    string;
  sub:      string;
  action:   () => void;
  badge?:   number;
  divider?: boolean;
  danger?:  boolean;
  iconBg?:  string;
  iconCls?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const PO_STATUS: Record<POStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:     { label: "Draft",     cls: "bg-slate-100 text-slate-600 border-slate-200",    icon: Clock        },
  PENDING:   { label: "Sent",      cls: "bg-amber-50  text-amber-700  border-amber-200",   icon: Send         },
  PARTIAL:   { label: "Partial",   cls: "bg-blue-50   text-blue-700   border-blue-200",    icon: Package      },
  RECEIVED:  { label: "Received",  cls: "bg-green-50  text-green-700  border-green-200",   icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50    text-red-600    border-red-200",     icon: XCircle      },
};

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; cls: string }> = {
  NOT_REQUIRED:    { label: "—",            cls: "" },
  PENDING_APPROVAL:{ label: "Needs Approval", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  APPROVED:        { label: "Approved",     cls: "bg-green-50  text-green-700  border-green-200" },
  REJECTED:        { label: "Rejected",     cls: "bg-red-50    text-red-600    border-red-200" },
};

export const GRN_STATUS: Record<GRNStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:     { label: "Pending",   cls: "bg-amber-50  text-amber-700  border-amber-200",   icon: Clock        },
  CONFIRMED: { label: "Received",  cls: "bg-green-50  text-green-700  border-green-200",   icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50    text-red-600    border-red-200",     icon: XCircle      },
};

export const SR_STATUS: Record<SRStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:     { label: "Draft",     cls: "bg-slate-100 text-slate-600 border-slate-200",    icon: Clock        },
  CONFIRMED: { label: "Confirmed", cls: "bg-blue-50   text-blue-700  border-blue-200",    icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50    text-red-600   border-red-200",     icon: XCircle      },
};

export const GST_RATES  = [0, 5, 12, 18];

export const SR_REASONS = [
  { value: "DAMAGED",       label: "Damaged"       },
  { value: "NEAR_EXPIRY",   label: "Near Expiry"   },
  { value: "EXPIRED",       label: "Expired"       },
  { value: "WRONG_PRODUCT", label: "Wrong Product" },
  { value: "QUALITY_ISSUE", label: "Quality Issue" },
  { value: "SHORT_SUPPLY",  label: "Short Supply"  },
  { value: "OTHER",         label: "Other"         },
];

export const SUPPLIER_BLANK: SupplierFormState = {
  name: "", gstin: "", dlNumber: "", phone: "", email: "",
  address: "", city: "", state: "", creditLimit: "0", creditDays: "30", paymentTerms: "",
};

export const TABS: { key: Tab; label: string; icon: React.ElementType; color: string }[] = [
  { key: "purchase",      label: "Purchase",      icon: FileText,   color: "emerald" },
  { key: "gate-inward",   label: "Gate Inward",   icon: Truck,      color: "amber"   },
  { key: "po",            label: "Purchase Order",icon: BarChart3,  color: "blue"    },
  { key: "returns",       label: "Returns",       icon: RotateCcw,  color: "red"     },
  { key: "distributors",  label: "Distributors",  icon: Building2,  color: "slate"   },
];
