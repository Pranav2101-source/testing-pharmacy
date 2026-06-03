import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, Loader2, FileX, X, Check, Send, Trash2,
  ChevronDown, AlertTriangle, ShieldAlert,
  CreditCard, FileText, Truck, BarChart3, RefreshCw,
  ChevronLeft, ChevronRight, Eye, IndianRupee,
  CheckCircle2, XCircle, RotateCcw, Clock, Package,
  Building2, Phone, Mail, MapPin, History, AlertCircle, Edit2,
  Lightbulb, Wallet, ShieldCheck, FileSpreadsheet, TrendingUp,
  Banknote, ClipboardList, Zap, Download, ArrowRight,
} from "lucide-react";
import { BarcodeInput } from "@/components/BarcodeInput";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type POStatus       = "DRAFT" | "PENDING" | "PARTIAL" | "RECEIVED" | "CANCELLED";
type ApprovalStatus = "NOT_REQUIRED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
type GRNStatus      = "DRAFT" | "CONFIRMED" | "CANCELLED";
type SRStatus       = "DRAFT" | "CONFIRMED" | "CANCELLED";

type PurchaseOrder = {
  id: string; orderNumber: string; invoiceNo: string | null;
  status: POStatus; approvalStatus: ApprovalStatus;
  subtotal: number; totalGst: number; totalAmount: number;
  notes: string | null; orderedAt: string; expectedDate: string | null;
  supplier: { id: string; name: string };
  _count: { items: number; grns: number };
};

type GRN = {
  id: string; grnNumber: string; supplierInvoiceNo: string | null;
  status: GRNStatus; subtotal: number; totalGst: number; totalAmount: number;
  createdAt: string; confirmedAt: string | null; paymentDueDate: string | null;
  supplier: { id: string; name: string };
  purchaseOrder: { id: string; orderNumber: string } | null;
  _count: { items: number };
};

type SupplierReturn = {
  id: string; returnNumber: string; debitNoteNo: string | null;
  status: SRStatus; totalAmount: number; createdAt: string;
  supplier: { id: string; name: string };
  _count: { items: number };
};

type Supplier = { id: string; name: string; phone?: string };

type Medicine = {
  id: string; name: string; genericName: string | null;
  gstRate: number; hsnCode: string | null;
};

type POLineItem = {
  medicineId: string; medicineName: string; batchNumber: string;
  expiryDate: string; quantity: number; purchaseRate: number; mrp: number; gstRate: number;
};

type GRNLineItem = {
  medicineId: string; medicineName: string; batchNumber: string; expiryDate: string;
  orderedQty: number; receivedQty: number; freeQty: number;
  purchaseRate: number; mrp: number; discount: number; gstRate: number;
};

type SRLineItem = {
  inventoryId: string; medicineId: string; medicineName: string;
  batchNumber: string; expiryDate: string; quantity: number;
  purchaseRate: number; reason: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PO_STATUS: Record<POStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:     { label: "Draft",     cls: "bg-slate-100 text-slate-600 border-slate-200",    icon: Clock        },
  PENDING:   { label: "Sent",      cls: "bg-amber-50  text-amber-700  border-amber-200",   icon: Send         },
  PARTIAL:   { label: "Partial",   cls: "bg-blue-50   text-blue-700   border-blue-200",    icon: Package      },
  RECEIVED:  { label: "Received",  cls: "bg-green-50  text-green-700  border-green-200",   icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50    text-red-600    border-red-200",     icon: XCircle      },
};

const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; cls: string }> = {
  NOT_REQUIRED:    { label: "—",            cls: "" },
  PENDING_APPROVAL:{ label: "Needs Approval", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  APPROVED:        { label: "Approved",     cls: "bg-green-50  text-green-700  border-green-200" },
  REJECTED:        { label: "Rejected",     cls: "bg-red-50    text-red-600    border-red-200" },
};

const GRN_STATUS: Record<GRNStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:     { label: "Pending",   cls: "bg-amber-50  text-amber-700  border-amber-200",   icon: Clock        },
  CONFIRMED: { label: "Received",  cls: "bg-green-50  text-green-700  border-green-200",   icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50    text-red-600    border-red-200",     icon: XCircle      },
};

const SR_STATUS: Record<SRStatus, { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:     { label: "Draft",     cls: "bg-slate-100 text-slate-600 border-slate-200",    icon: Clock        },
  CONFIRMED: { label: "Confirmed", cls: "bg-blue-50   text-blue-700  border-blue-200",    icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50    text-red-600   border-red-200",     icon: XCircle      },
};

const GST_RATES  = [0, 5, 12, 18];
const SR_REASONS = [
  { value: "DAMAGED",       label: "Damaged"       },
  { value: "NEAR_EXPIRY",   label: "Near Expiry"   },
  { value: "EXPIRED",       label: "Expired"       },
  { value: "WRONG_PRODUCT", label: "Wrong Product" },
  { value: "QUALITY_ISSUE", label: "Quality Issue" },
  { value: "SHORT_SUPPLY",  label: "Short Supply"  },
  { value: "OTHER",         label: "Other"         },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function currency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0 }).format(n);
}

function isOverdue(dueDate: string | null | undefined) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ─── Reusable UI ──────────────────────────────────────────────────────────────

function StatusBadge<T extends string>({ status, cfg }: {
  status: T; cfg: Record<string, { label: string; cls: string; icon?: React.ElementType }>;
}) {
  const c = cfg[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  const Icon = (c as any).icon as React.ElementType | undefined;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap", c.cls)}>
      {Icon && <Icon className="w-2.5 h-2.5" />}{c.label}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{children}</label>;
}

function FInput({ value, onChange, placeholder, type = "text", className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string;
}) {
  return (
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={cn("w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors", className)} />
  );
}

function MedicineCombobox({ onSelect, onClearError }: { onSelect: (m: Medicine) => void; onClearError?: () => void }) {
  const [q, setQ]             = useState("");
  const [results, setResults] = useState<Medicine[]>([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/medicines/search", { params: { q, limit: 8 } });
        setResults(data.data);
        setOpen(true);
      } catch {/* */} finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden h-9 bg-white">
        <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) onClearError?.(); }} placeholder="Search medicine name…"
          className="flex-1 px-3 text-[13px] placeholder-slate-400 focus:outline-none h-full bg-transparent" />
        {loading ? <Loader2 className="w-3.5 h-3.5 text-slate-400 mx-2.5 animate-spin" /> : <Search className="w-3.5 h-3.5 text-slate-400 mx-2.5" />}
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden">
          {results.length > 0 ? results.map((m) => (
            <button key={m.id} type="button" onClick={() => { onSelect(m); setQ(""); setOpen(false); }}
              className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0">
              <p className="text-[13px] font-semibold text-slate-800">{m.name}</p>
              {m.genericName && <p className="text-[11px] text-slate-400">{m.genericName}</p>}
              <p className="text-[10px] text-slate-300">GST {m.gstRate}%{m.hsnCode ? ` · HSN ${m.hsnCode}` : ""}</p>
            </button>
          )) : (
            <div className="px-3.5 py-3 text-center">
              <p className="text-[13px] font-semibold text-slate-500">No medicine found for "{q}"</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Go to <span className="font-semibold">Medicines</span> page to add it to the catalog first.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Pagination({ page, totalPages, total, limit, onChange }: {
  page: number; totalPages: number; total: number; limit: number; onChange: (p: number) => void;
}) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/50 flex-shrink-0">
      <span className="text-[12px] text-slate-500">
        Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total} records
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}
          className="w-7 h-7 rounded-md border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[12px] text-slate-500 px-3 py-1 bg-white border border-slate-200 rounded-md min-w-[70px] text-center">
          Page {page} / {totalPages}
        </span>
        <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          className="w-7 h-7 rounded-md border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, desc, action, onAction }: {
  icon: React.ElementType; title: string; desc?: string; action?: string; onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-slate-300" />
      </div>
      <p className="text-[15px] font-semibold text-slate-700 mb-1">{title}</p>
      {desc && <p className="text-[13px] text-slate-400 mb-4 max-w-xs">{desc}</p>}
      {action && onAction && (
        <button onClick={onAction} className="text-[12px] text-blue-600 hover:text-blue-700 font-semibold hover:underline">
          {action}
        </button>
      )}
    </div>
  );
}

// ─── Summary Stats Bar ─────────────────────────────────────────────────────────

function SummaryBar() {
  const [stats, setStats] = useState<{
    pendingGRNs: number; overduePayments: number; pendingApprovals: number; monthSpend: number;
  } | null>(null);

  useEffect(() => {
    async function load() {
      const now  = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const to   = now.toISOString();
      try {
        const [grnRes, poRes, summaryRes] = await Promise.all([
          api.get("/purchases/grn", { params: { status: "DRAFT", limit: 1 } }),
          api.get("/purchases/orders", { params: { approvalStatus: "PENDING_APPROVAL", limit: 1 } }),
          api.get("/reports/purchases/summary", { params: { from, to } }),
        ]);
        setStats({
          pendingGRNs:       grnRes.data.data.total,
          overduePayments:   summaryRes.data.data.overduePayments,
          pendingApprovals:  poRes.data.data.total,
          monthSpend:        summaryRes.data.data.totalSpend,
        });
      } catch {/* */}
    }
    load();
  }, []);

  const cards = [
    {
      label: "This Month Spend",
      value: stats ? currency(stats.monthSpend) : "—",
      icon: IndianRupee,
      cls:  "text-blue-700  bg-blue-50",
    },
    {
      label: "Pending Gate Inward",
      value: stats ? `${stats.pendingGRNs} GRN${stats.pendingGRNs !== 1 ? "s" : ""}` : "—",
      icon: Truck,
      cls:  "text-amber-700 bg-amber-50",
      warn: stats ? stats.pendingGRNs > 0 : false,
    },
    {
      label: "Overdue Payments",
      value: stats ? `${stats.overduePayments} bill${stats.overduePayments !== 1 ? "s" : ""}` : "—",
      icon: AlertTriangle,
      cls:  stats?.overduePayments ? "text-red-700 bg-red-50" : "text-slate-500 bg-slate-50",
      warn: stats ? stats.overduePayments > 0 : false,
    },
    {
      label: "Pending Approval",
      value: stats ? `${stats.pendingApprovals} PO${stats.pendingApprovals !== 1 ? "s" : ""}` : "—",
      icon: ShieldAlert,
      cls:  stats?.pendingApprovals ? "text-orange-700 bg-orange-50" : "text-slate-500 bg-slate-50",
      warn: stats ? stats.pendingApprovals > 0 : false,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 px-5 py-3 bg-[#f7f9fc] border-b border-slate-200">
      {cards.map((c) => (
        <div key={c.label} className={cn("flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 border", c.warn ? "border-current/20 shadow-sm" : "border-slate-200 bg-white")}>
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", c.cls)}>
            <c.icon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500 leading-none mb-0.5">{c.label}</p>
            <p className={cn("text-[14px] font-bold leading-none", c.warn ? "text-red-700" : "text-slate-800")}>{c.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Filter Bar (shared across tabs) ─────────────────────────────────────────

function FilterBar({ search, onSearch, supplierId, onSupplier, suppliers, dateFrom, dateTo,
  onDateFrom, onDateTo, statusValue, onStatus, statusOptions, rightSlot }: {
  search: string; onSearch: (v: string) => void;
  supplierId: string; onSupplier: (v: string) => void;
  suppliers: Supplier[];
  dateFrom: string; dateTo: string;
  onDateFrom: (v: string) => void; onDateTo: (v: string) => void;
  statusValue: string; onStatus: (v: string) => void;
  statusOptions: { value: string; label: string }[];
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white flex-shrink-0 flex-wrap">
      {/* Search */}
      <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden h-8 flex-1 min-w-[180px] max-w-[260px]">
        <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 flex-shrink-0" />
        <input type="text" value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by number, name…"
          className="flex-1 px-2 text-[12px] text-slate-700 placeholder-slate-400 focus:outline-none h-full bg-transparent" />
        {search && (
          <button onClick={() => onSearch("")} className="mr-2 text-slate-300 hover:text-slate-500">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1 border border-slate-200 rounded-lg bg-white h-8 px-2.5 text-[12px] text-slate-600">
        <input type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)}
          className="focus:outline-none bg-transparent text-[12px] text-slate-600 w-[92px]" />
        <span className="text-slate-300">–</span>
        <input type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)}
          className="focus:outline-none bg-transparent text-[12px] text-slate-600 w-[92px]" />
      </div>

      {/* Distributor */}
      <select value={supplierId} onChange={(e) => onSupplier(e.target.value)}
        className="border border-slate-200 rounded-lg bg-white h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none min-w-[140px] max-w-[180px]">
        <option value="">All Distributors</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {/* Status */}
      <select value={statusValue} onChange={(e) => onStatus(e.target.value)}
        className="border border-slate-200 rounded-lg bg-white h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none min-w-[110px]">
        <option value="">All Status</option>
        {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
    </div>
  );
}

// ─── Create PO Modal ──────────────────────────────────────────────────────────

// ─── CSV Templates ────────────────────────────────────────────────────────────

const GRN_CSV_TEMPLATE =
  "medicineName,batchNumber,expiryDate,receivedQty,freeQty,purchaseRate,mrp,discount,gstRate\n" +
  "Paracetamol 500mg Strip,BATCH001,2027-06-30,100,5,4.50,8.00,0,12\n" +
  "Amoxicillin 250mg,BATCH002,2027-03-31,50,0,18.00,32.00,0,12\n";

const PO_CSV_TEMPLATE =
  "medicineName,batchNumber,expiryDate,quantity,purchaseRate,mrp,gstRate\n" +
  "Paracetamol 500mg Strip,BATCH001,2027-06-30,100,4.50,8.00,12\n" +
  "Amoxicillin 250mg,BATCH002,2027-03-31,50,18.00,32.00,12\n";

// Return template only needs: name, batch, expiry, returnQty, purchaseRate.
// freeQty / discount / mrp / gstRate / orderedQty are not relevant for returns.
const RETURN_CSV_TEMPLATE =
  "medicineName,batchNumber,expiryDate,returnQty,purchaseRate\n" +
  "Paracetamol 500mg Strip,BATCH001,2025-12-31,10,4.50\n" +
  "Amoxicillin 250mg,BATCH002,2025-06-30,5,18.00\n";

function downloadTemplate(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Client-side CSV/TSV parser ───────────────────────────────────────────────
// Parses comma-separated or tab-separated (pasted from Excel / Google Sheets).

function parseRawRows(raw: string): { headers: string[]; rows: string[][] } {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n").filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const delim   = (lines[0] ?? "").includes("\t") ? "\t" : ",";
  const headers = (lines[0] ?? "").split(delim).map((h) => h.trim().replace(/^"|"$/g, "").trim());
  const rows    = lines.slice(1).map((l) =>
    l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "").trim())
  );
  return { headers, rows };
}

function csvToGRNItems(raw: string): { items: Partial<GRNLineItem>[]; errors: string[] } {
  const { headers, rows } = parseRawRows(raw);
  const errors: string[]  = [];
  const items: Partial<GRNLineItem>[] = [];
  const col = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    const name = col(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicineName is required`); continue; }
    const rQty = parseFloat(col(row, "receivedQty") || "1");
    const rate = parseFloat(col(row, "purchaseRate") || "0");
    const mrp  = parseFloat(col(row, "mrp")          || "0");
    const gst  = parseFloat(col(row, "gstRate")       || "12");
    if (isNaN(rQty) || rQty <= 0)  { errors.push(`Row ${line}: receivedQty must be positive`); continue; }
    if (isNaN(rate) || rate <= 0)  { errors.push(`Row ${line}: purchaseRate must be positive`); continue; }
    if (isNaN(mrp)  || mrp  <= 0)  { errors.push(`Row ${line}: mrp must be positive`);          continue; }
    if (![0,5,12,18].includes(gst)){ errors.push(`Row ${line}: gstRate must be 0,5,12 or 18`); continue; }
    // Parse expiryDate — YYYY-MM-DD or DD/MM/YYYY
    let expiry = col(row, "expiryDate");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(expiry)) {
      const [dd, mm, yyyy] = expiry.split("/");
      expiry = `${yyyy}-${mm}-${dd}`;
    }
    items.push({
      medicineName: name,
      medicineId:   "",   // resolved later via search
      batchNumber:  col(row, "batchNumber"),
      expiryDate:   expiry,
      receivedQty:  Math.floor(rQty),
      freeQty:      Math.floor(parseFloat(col(row, "freeQty") || "0")),
      purchaseRate: rate,
      mrp,
      discount:     parseFloat(col(row, "discount") || "0"),
      gstRate:      gst,
      orderedQty:   0,
    });
  }
  return { items, errors };
}

function csvToPOItems(raw: string): { items: Partial<POLineItem>[]; errors: string[] } {
  const { headers, rows } = parseRawRows(raw);
  const errors: string[]  = [];
  const items: Partial<POLineItem>[] = [];
  const col = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    const name = col(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicineName is required`); continue; }
    const qty  = parseFloat(col(row, "quantity")     || "1");
    const rate = parseFloat(col(row, "purchaseRate") || "0");
    const mrp  = parseFloat(col(row, "mrp")          || "0");
    const gst  = parseFloat(col(row, "gstRate")       || "12");
    if (isNaN(qty)  || qty  <= 0) { errors.push(`Row ${line}: quantity must be positive`);       continue; }
    if (isNaN(rate) || rate <= 0) { errors.push(`Row ${line}: purchaseRate must be positive`);   continue; }
    if (isNaN(mrp)  || mrp  <= 0) { errors.push(`Row ${line}: mrp must be positive`);            continue; }
    if (![0,5,12,18].includes(gst)){ errors.push(`Row ${line}: gstRate must be 0,5,12 or 18`);  continue; }
    let expiry = col(row, "expiryDate");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(expiry)) {
      const [dd, mm, yyyy] = expiry.split("/");
      expiry = `${yyyy}-${mm}-${dd}`;
    }
    items.push({
      medicineName: name,
      medicineId:   "",
      batchNumber:  col(row, "batchNumber"),
      expiryDate:   expiry,
      quantity:     Math.floor(qty),
      purchaseRate: rate,
      mrp,
      gstRate:      gst,
    });
  }
  return { items, errors };
}

function csvToReturnItems(raw: string): { items: Partial<SRLineItem>[]; errors: string[] } {
  const { headers, rows } = parseRawRows(raw);
  const errors: string[]  = [];
  const items: Partial<SRLineItem>[] = [];
  const col = (row: string[], name: string) => row[headers.indexOf(name)] ?? "";

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i] ?? [];
    const line = i + 2;
    const name = col(row, "medicineName");
    if (!name) { errors.push(`Row ${line}: medicineName is required`); continue; }
    const qty  = parseFloat(col(row, "returnQty") || "1");
    const rate = parseFloat(col(row, "purchaseRate") || "0");
    if (isNaN(qty)  || qty  <= 0) { errors.push(`Row ${line}: returnQty must be positive`);    continue; }
    if (isNaN(rate) || rate <= 0) { errors.push(`Row ${line}: purchaseRate must be positive`); continue; }
    let expiry = col(row, "expiryDate");
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(expiry)) {
      const [dd, mm, yyyy] = expiry.split("/");
      expiry = `${yyyy}-${mm}-${dd}`;
    }
    items.push({
      inventoryId:  "",
      medicineId:   "",
      medicineName: name,
      batchNumber:  col(row, "batchNumber"),
      expiryDate:   expiry,
      quantity:     Math.floor(qty),
      purchaseRate: rate,
      reason:       "DAMAGED" as const,
    });
  }
  return { items, errors };
}

// ─── ImportPanel ──────────────────────────────────────────────────────────────
// Shared CSV / paste-from-spreadsheet panel for GRN, PO, and Return modals.

function ImportPanel({ type, onImport, onClose }: {
  type:      "grn" | "po" | "return";
  onImport:  (raw: string) => void;
  onClose:   () => void;
}) {
  const [text,    setText]    = useState("");
  const [dragging,setDrag]    = useState(false);
  const fileRef               = useRef<HTMLInputElement>(null);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => setText((e.target?.result as string) ?? "");
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }

  const template  = type === "grn" ? GRN_CSV_TEMPLATE : type === "return" ? RETURN_CSV_TEMPLATE : PO_CSV_TEMPLATE;
  const filename  = type === "grn" ? "grn_import_template.csv" : type === "return" ? "return_import_template.csv" : "po_import_template.csv";
  const rowCount  = text.trim().split("\n").filter(Boolean).length - 1;
  const hasData   = rowCount > 0;

  return (
    <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
          <FileSpreadsheet className="w-4 h-4 text-blue-600" />Import from CSV / Excel / Google Sheets
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => downloadTemplate(filename, template)}
            className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 bg-white hover:bg-blue-50 rounded-md px-2.5 py-1.5 transition-colors">
            <Download className="w-3 h-3" />Download Template
          </button>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Drop zone / file picker */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
          dragging ? "border-blue-400 bg-blue-100/50" : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/30",
        )}>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
        <FileSpreadsheet className="w-6 h-6 text-slate-400 mx-auto mb-1" />
        <p className="text-[12px] font-semibold text-slate-600">Drop .csv file here or click to browse</p>
        <p className="text-[11px] text-slate-400 mt-0.5">For Excel / Google Sheets: File → Download as CSV, then import here</p>
      </div>

      {/* Paste area */}
      <div>
        <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
          Or paste directly from Excel / Google Sheets (Ctrl+C the cells, then paste below):
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            type === "return"
              ? "medicineName\tbatchNumber\texpiryDate\treturnQty\tpurchaseRate\nParacetamol 500mg\tBATCH001\t2025-12-31\t10\t4.50"
              : type === "po"
              ? "medicineName\tbatchNumber\texpiryDate\tquantity\tpurchaseRate\tmrp\tgstRate\nParacetamol 500mg\tBATCH001\t2027-06-30\t100\t4.50\t8.00\t12"
              : "medicineName\tbatchNumber\texpiryDate\treceivedQty\tfreeQty\tpurchaseRate\tmrp\tdiscount\tgstRate\nParacetamol 500mg\tBATCH001\t2027-06-30\t100\t5\t4.50\t8.00\t0\t12"
          }
          rows={5}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white placeholder-slate-300"
        />
      </div>

      {hasData && (
        <button type="button" onClick={() => onImport(text)}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors">
          <Check className="w-4 h-4" />Import {rowCount} row{rowCount !== 1 ? "s" : ""} into form
        </button>
      )}
    </div>
  );
}

// ─── AutoSuggestPanel ────────────────────────────────────────────────────────
// Loads low-stock medicines from the backend and lets the user bulk-select
// them for a Purchase Order. User still fills batch/expiry/rates after.

type AutoSuggestion = {
  medicineId: string; medicineName: string; currentStock: number;
  avgDailySales: number; daysOfStock: number; suggestedQuantity: number;
};

function SmartReorderPanel({ supplierId, onAdd, onClose }: {
  supplierId: string;
  onAdd: (items: POLineItem[]) => void;
  onClose: () => void;
}) {
  const [loading,    setLoading]    = useState(true);
  const [suggestions,setSuggestions]= useState<AutoSuggestion[]>([]);
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setFetchError(null);
    const params: Record<string, any> = { daysThreshold: 30 };
    if (supplierId) params.supplierId = supplierId;
    api.get("/purchases/suggestions", { params })
      .then(({ data }) => {
        setSuggestions(data.data);
        const initQty: Record<string, number> = {};
        for (const s of (data.data as AutoSuggestion[])) initQty[s.medicineId] = s.suggestedQuantity;
        setQuantities(initQty);
        setSelected(new Set((data.data as AutoSuggestion[]).map((s) => s.medicineId)));
      })
      .catch(() => setFetchError("Failed to load suggestions"))
      .finally(() => setLoading(false));
  }, [supplierId]);

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(suggestions.map((s) => s.medicineId)) : new Set());
  }
  function toggle(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function handleAdd() {
    const items: POLineItem[] = suggestions
      .filter((s) => selected.has(s.medicineId))
      .map((s) => ({
        medicineId: s.medicineId, medicineName: s.medicineName,
        batchNumber: "", expiryDate: "",
        quantity: quantities[s.medicineId] ?? s.suggestedQuantity,
        purchaseRate: 0, mrp: 0, gstRate: 12,
      }));
    onAdd(items);
  }

  const selCount = selected.size;
  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
          <Lightbulb className="w-4 h-4 text-amber-500" />Smart Reorder — Low Stock Suggestions
        </p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
          <span className="text-[12px] text-slate-500">Analysing stock levels…</span>
        </div>
      ) : fetchError ? (
        <ErrorBanner msg={fetchError} />
      ) : suggestions.length === 0 ? (
        <p className="text-[13px] text-slate-500 text-center py-6">All medicines are sufficiently stocked. No reorder needed right now.</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">
            {suggestions.length} medicine{suggestions.length !== 1 ? "s" : ""} need restocking. Select the ones to add — you'll still need to fill batch, expiry, and rates below.
          </p>
          <div className="border border-amber-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-[12px]">
              <thead className="bg-amber-50 border-b border-amber-100">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={selCount === suggestions.length && suggestions.length > 0}
                      onChange={(e) => toggleAll(e.target.checked)} className="rounded border-slate-300" />
                  </th>
                  {["Medicine","In Stock","Avg Daily","Days Left","Order Qty"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.medicineId} className={cn("border-b border-slate-100 last:border-0", selected.has(s.medicineId) ? "bg-amber-50/30" : "opacity-50")}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(s.medicineId)}
                        onChange={() => toggle(s.medicineId)} className="rounded border-slate-300" />
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{s.medicineName}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{s.currentStock}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{s.avgDailySales}</td>
                    <td className="px-3 py-2">
                      <span className={cn("font-semibold tabular-nums", s.daysOfStock < 7 ? "text-red-600" : s.daysOfStock < 14 ? "text-amber-600" : "text-slate-600")}>
                        {s.daysOfStock >= 999 ? "—" : s.daysOfStock}
                      </span>
                    </td>
                    <td className="px-3 py-2 w-20">
                      <input type="number" value={quantities[s.medicineId] ?? s.suggestedQuantity} min={1}
                        onChange={(e) => setQuantities((p) => ({ ...p, [s.medicineId]: +e.target.value }))}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] text-center focus:outline-none focus:border-amber-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selCount > 0 && (
            <button type="button" onClick={handleAdd}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors">
              <Plus className="w-4 h-4" />Add {selCount} medicine{selCount !== 1 ? "s" : ""} to PO
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── InventoryBatchPicker ─────────────────────────────────────────────────────
// Searches active inventory batches by name/batch number and lets the user
// select batches to return — pre-fills inventoryId, batchNumber, expiryDate,
// and purchaseRate so the user only needs to enter quantity + reason.

type InventoryBatch = {
  id: string; batchNumber: string; expiryDate: string;
  quantity: number; purchaseRate: number;
  medicine: { id: string; name: string };
};

function InventoryBatchPicker({ onAdd, onClose }: {
  onAdd: (items: SRLineItem[]) => void;
  onClose: () => void;
}) {
  const [search,   setSearch]   = useState("");
  const [batches,  setBatches]  = useState<InventoryBatch[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (search.length < 2) { setBatches([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/inventory", {
          params: { search, inStock: true, status: "ACTIVE", limit: 20 },
        });
        setBatches(data.data.items ?? []);
      } catch {/* */} finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function toggle(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function handleAdd() {
    const toAdd: SRLineItem[] = batches
      .filter((b) => selected.has(b.id))
      .map((b) => ({
        inventoryId:  b.id,
        medicineId:   b.medicine.id,
        medicineName: b.medicine.name,
        batchNumber:  b.batchNumber,
        expiryDate:   new Date(b.expiryDate).toISOString().split("T")[0]!,
        quantity:     1,
        purchaseRate: b.purchaseRate,
        reason:       "DAMAGED" as const,
      }));
    onAdd(toAdd);
  }

  const selCount = selected.size;
  return (
    <div className="border border-violet-200 bg-violet-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
          <Package className="w-4 h-4 text-violet-600" />Select Batches from Inventory
        </p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden h-9">
        <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 flex-shrink-0" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Type medicine name or batch number…"
          autoFocus
          className="flex-1 px-2 text-[13px] placeholder-slate-400 focus:outline-none h-full bg-transparent" />
        {loading && <Loader2 className="w-3.5 h-3.5 text-slate-400 mx-2.5 animate-spin" />}
      </div>
      {batches.length > 0 && (
        <>
          <div className="border border-violet-100 rounded-lg overflow-hidden bg-white max-h-56 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-violet-50 border-b border-violet-100 sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  {["Medicine","Batch","Expiry","In Stock","Buy Rate ₹"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} onClick={() => toggle(b.id)}
                    className={cn("border-b border-slate-100 last:border-0 cursor-pointer hover:bg-violet-50/50", selected.has(b.id) && "bg-violet-50")}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)}
                        onClick={(e) => e.stopPropagation()} className="rounded border-slate-300" />
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800 max-w-[140px] truncate">{b.medicine.name}</td>
                    <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">{b.batchNumber}</td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(b.expiryDate)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{b.quantity}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{b.purchaseRate.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selCount > 0 && (
            <button type="button" onClick={handleAdd}
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors">
              <Plus className="w-4 h-4" />Add {selCount} batch{selCount !== 1 ? "es" : ""} to return
            </button>
          )}
        </>
      )}
      {search.length >= 2 && !loading && batches.length === 0 && (
        <p className="text-[12px] text-slate-400 text-center py-4">No active batches found for "{search}"</p>
      )}
    </div>
  );
}

// ─── SmartAddBar ──────────────────────────────────────────────────────────────
// Compact toolbar of add-medicine shortcuts shown above the medicine search.

function SmartAddBar({ type, supplierId, onImportCSV, onCopyLast, onLoadFromPO, poOptions, selectedPoId, onPoChange, onScan, onAutoSuggest, loadingCopy, loadingPO }: {
  type:            "grn" | "po" | "return";
  supplierId:      string;
  onImportCSV:     () => void;
  onCopyLast?:     () => void;
  onLoadFromPO?:   () => void;
  poOptions?:      { id: string; orderNumber: string; itemCount: number }[];
  selectedPoId?:   string;
  onPoChange?:     (id: string) => void;
  onScan?:         (code: string) => void;
  onAutoSuggest?:  () => void;
  loadingCopy?:    boolean;
  loadingPO?:      boolean;
}) {
  const [scanMode, setScanMode] = useState(false);
  const [scanLoad, setScanLoad] = useState(false);

  async function handleScan(code: string) {
    if (!onScan) return;
    setScanLoad(true);
    try { onScan(code); } finally { setScanLoad(false); }
  }

  return (
    <div className="space-y-2">
      {/* PO selector row — only for GRN */}
      {type === "grn" && poOptions !== undefined && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <FieldLabel>Link to Purchase Order (optional)</FieldLabel>
            <select
              value={selectedPoId ?? ""}
              onChange={(e) => onPoChange?.(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
              <option value="">— No PO (direct purchase) —</option>
              {poOptions.map((po) => (
                <option key={po.id} value={po.id}>{po.orderNumber} ({po.itemCount} items)</option>
              ))}
            </select>
          </div>
          {selectedPoId && (
            <div className="self-end">
              <button type="button" onClick={onLoadFromPO} disabled={loadingPO}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold h-9 px-3 rounded-lg disabled:opacity-60 transition-colors whitespace-nowrap">
                {loadingPO ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                Load items from PO
              </button>
            </div>
          )}
        </div>
      )}

      {/* Shortcut buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Add medicines via:</span>

        {onCopyLast && (
          <button type="button" onClick={onCopyLast} disabled={!supplierId || loadingCopy}
            title={!supplierId ? "Select a distributor first" : ""}
            className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-semibold h-8 px-3 rounded-lg disabled:opacity-40 transition-colors">
            {loadingCopy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {type === "po" ? "Copy Last Order" : "Copy Last Purchase"}
          </button>
        )}

        {type === "po" && onAutoSuggest && (
          <button type="button" onClick={onAutoSuggest}
            className="flex items-center gap-1.5 border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
            <Lightbulb className="w-3.5 h-3.5" />Smart Reorder
          </button>
        )}

        <button type="button" onClick={() => setScanMode((v) => !v)}
          className={cn("flex items-center gap-1.5 border text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors",
            scanMode ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600")}>
          <Search className="w-3.5 h-3.5" />
          {scanMode ? "Hide Scanner" : "Scan Barcode"}
        </button>

        <button type="button" onClick={onImportCSV}
          className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Import CSV / Sheet
        </button>
      </div>

      {/* Barcode scanner (expanded) */}
      {scanMode && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Search className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <BarcodeInput onScan={handleScan} loading={scanLoad} placeholder="Scan or type barcode…" />
          </div>
          <p className="text-[11px] text-amber-600 font-medium whitespace-nowrap">Scan to add medicine</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function CreatePOModal({ suppliers: initialSuppliers, onClose, onDone }: { suppliers: Supplier[]; onClose: () => void; onDone: (newSupplier?: FullSupplier) => void }) {
  const [suppliers,    setSuppliers]    = useState<Supplier[]>(initialSuppliers);
  const [supplierId,   setSupplierId]   = useState("");
  const [invoiceNo,    setInvoiceNo]    = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes,        setNotes]        = useState("");
  const [items,        setItems]        = useState<POLineItem[]>([]);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [showImport,   setShowImport]   = useState(false);
  const [showSuggest,  setShowSuggest]  = useState(false);
  const [copyLoading,  setCopyLoading]  = useState(false);
  const [importError,  setImportError]  = useState<string | null>(null);
  const lastAddedSupplier               = useRef<FullSupplier | undefined>(undefined);

  function addMedicine(m: Medicine) {
    setItems((p) => [...p, { medicineId: m.id, medicineName: m.name, batchNumber: "", expiryDate: "", quantity: 1, purchaseRate: 0, mrp: 0, gstRate: m.gstRate }]);
  }

  function addByBarcode(m: Medicine) {
    addMedicine(m);
  }

  async function handleBarcodeScan(code: string) {
    try {
      const { data } = await api.get(`/medicines/barcode/${encodeURIComponent(code)}`);
      addMedicine(data.data);
    } catch { setError("No medicine found for this barcode"); }
  }

  async function copyLastOrder() {
    if (!supplierId) return;
    setCopyLoading(true);
    try {
      const { data } = await api.get("/purchases/orders", {
        params: { supplierId, status: "RECEIVED", limit: 1 },
      });
      const last = data.data.items?.[0];
      if (!last) { setError("No previous orders found for this distributor"); return; }
      const { data: poData } = await api.get(`/purchases/orders/${last.id}`);
      const poItems: POLineItem[] = (poData.data.items ?? []).map((i: any) => ({
        medicineId:   i.medicineId ?? "",
        medicineName: i.medicineName,
        batchNumber:  "",
        expiryDate:   "",
        quantity:     i.quantity,
        purchaseRate: i.purchaseRate,
        mrp:          i.mrp,
        gstRate:      i.gstRate,
      }));
      setItems((p) => {
        const existing = new Set(p.map((x) => x.medicineName.toLowerCase()));
        return [...p, ...poItems.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
      });
    } catch { setError("Failed to load previous order"); }
    finally { setCopyLoading(false); }
  }

  function handleCSVImport(raw: string) {
    setImportError(null);
    const { items: parsed, errors } = csvToPOItems(raw);
    if (errors.length > 0) { setImportError(errors.slice(0, 3).join(" · ")); return; }
    const toAdd: POLineItem[] = parsed.map((p) => ({
      medicineId:   "",
      medicineName: p.medicineName ?? "",
      batchNumber:  p.batchNumber  ?? "",
      expiryDate:   p.expiryDate   ?? "",
      quantity:     p.quantity     ?? 1,
      purchaseRate: p.purchaseRate ?? 0,
      mrp:          p.mrp          ?? 0,
      gstRate:      p.gstRate      ?? 12,
    }));
    setItems((prev) => {
      const existing = new Set(prev.map((x) => x.medicineName.toLowerCase()));
      return [...prev, ...toAdd.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
    });
    setShowImport(false);
  }

  function upd(idx: number, key: keyof POLineItem, val: string | number) {
    setItems((p) => { const n = [...p]; (n[idx] as any)[key] = val; return n; });
  }

  const totals = items.reduce((a, i) => {
    const sub = i.purchaseRate * i.quantity;
    return { sub: a.sub + sub, gst: a.gst + (sub * i.gstRate) / 100 };
  }, { sub: 0, gst: 0 });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Select a supplier"); return; }
    if (items.length === 0) { setError("Add at least one medicine"); return; }
    const bad = items.find((i) => !i.batchNumber || !i.expiryDate || i.purchaseRate <= 0 || i.mrp <= 0);
    if (bad) { setError("Fill all item fields (batch, expiry, rates)"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/purchases/orders", {
        supplierId, invoiceNo: invoiceNo || undefined, notes: notes || undefined,
        expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
        items: items.map((i) => ({ ...i, expiryDate: new Date(i.expiryDate).toISOString() })),
      });
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create purchase order");
    } finally { setSaving(false); }
  }

  return (
    <ModalShell icon={<FileText className="w-4 h-4 text-blue-600" />} iconBg="bg-blue-50"
      title="New Purchase Order" desc="Created as DRAFT — send to supplier when ready" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <FieldLabel>Distributor / Supplier *</FieldLabel>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <QuickAddHint suppliers={suppliers} onAdded={(s) => { lastAddedSupplier.current = s; setSuppliers((p) => [...p, s]); setSupplierId(s.id); }} />
            </div>
            <div>
              <FieldLabel>Ref Invoice No.</FieldLabel>
              <FInput value={invoiceNo} onChange={setInvoiceNo} placeholder="Optional" />
            </div>
            <div>
              <FieldLabel>Expected Delivery</FieldLabel>
              <FInput type="date" value={expectedDate} onChange={setExpectedDate} />
            </div>
          </div>

          <div>
            {/* Smart-add shortcuts */}
            <SmartAddBar
              type="po"
              supplierId={supplierId}
              onImportCSV={() => { setShowImport((v) => !v); setShowSuggest(false); }}
              onCopyLast={copyLastOrder}
              onScan={handleBarcodeScan}
              onAutoSuggest={() => { setShowSuggest((v) => !v); setShowImport(false); }}
              loadingCopy={copyLoading}
            />
            {showImport && (
              <ImportPanel type="po" onImport={handleCSVImport} onClose={() => setShowImport(false)} />
            )}
            {showSuggest && (
              <SmartReorderPanel
                supplierId={supplierId}
                onAdd={(suggested) => {
                  setItems((prev) => {
                    const existing = new Set(prev.map((x) => x.medicineName.toLowerCase()));
                    return [...prev, ...suggested.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
                  });
                  setShowSuggest(false);
                }}
                onClose={() => setShowSuggest(false)}
              />
            )}
            {importError && <ErrorBanner msg={importError} />}

            <FieldLabel>Search &amp; Add Medicine (one by one)</FieldLabel>
            <MedicineCombobox onSelect={addMedicine} onClearError={() => setError(null)} />
          </div>

          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Medicine", "Batch No.", "Expiry Date", "Qty", "Buy Rate ₹", "MRP ₹", "GST %", "Amount", ""].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const amt = item.purchaseRate * item.quantity * (1 + item.gstRate / 100);
                    return (
                      <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/20">
                        <td className="px-3 py-2 max-w-[140px]">
                          <p className="text-[12px] font-semibold text-slate-800 truncate">{item.medicineName}</p>
                        </td>
                        <td className="px-2 py-2 w-24">
                          <input value={item.batchNumber} onChange={(e) => upd(idx, "batchNumber", e.target.value)} placeholder="Batch"
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-32">
                          <input type="date" value={item.expiryDate} onChange={(e) => upd(idx, "expiryDate", e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-16">
                          <input type="number" value={item.quantity} min={1} onChange={(e) => upd(idx, "quantity", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] text-center focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-24">
                          <input type="number" value={item.purchaseRate || ""} placeholder="0.00" step="0.01" min={0}
                            onChange={(e) => upd(idx, "purchaseRate", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-24">
                          <input type="number" value={item.mrp || ""} placeholder="0.00" step="0.01" min={0}
                            onChange={(e) => upd(idx, "mrp", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-2 py-2 w-16">
                          <select value={item.gstRate} onChange={(e) => upd(idx, "gstRate", +e.target.value)}
                            className="w-full border border-slate-200 rounded-md px-1 py-1.5 text-[12px] bg-white focus:outline-none focus:border-blue-400">
                            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-[12px] font-semibold text-slate-700 tabular-nums whitespace-nowrap">{currency(amt)}</td>
                        <td className="px-2 py-2">
                          <button type="button" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                            className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center text-slate-300 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={7} className="px-3 py-2.5 text-right text-[12px] text-slate-500">
                      Subtotal <span className="font-semibold text-slate-700">{currency(totals.sub)}</span>
                      {"  ·  "}GST <span className="font-semibold text-slate-700">{currency(totals.gst)}</span>
                      {"  ·  "}Total
                    </td>
                    <td className="px-3 py-2.5 text-[14px] font-bold text-slate-900 tabular-nums">{currency(totals.sub + totals.gst)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {error && <ErrorBanner msg={error} />}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <span className="text-[12px] text-slate-400">{items.length} line item{items.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 font-medium">Cancel</button>
            <button type="submit" disabled={saving || items.length === 0}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create PO
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Create GRN Modal ─────────────────────────────────────────────────────────

function CreateGRNModal({ suppliers: initialSuppliers, onClose, onDone }: { suppliers: Supplier[]; onClose: () => void; onDone: (newSupplier?: FullSupplier) => void }) {
  const [suppliers,  setSuppliers]        = useState<Supplier[]>(initialSuppliers);
  const [supplierId, setSupplierId]       = useState("");
  const [invNo, setInvNo]                 = useState("");
  const [invDate, setInvDate]             = useState("");
  const [poId, setPoId]                   = useState("");
  const [notes, setNotes]                 = useState("");
  const [items, setItems]                 = useState<GRNLineItem[]>([]);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [showImport, setShowImport]       = useState(false);
  const [copyLoading, setCopyLoading]     = useState(false);
  const [poLoading, setPoLoading]         = useState(false);
  const [poOptions, setPoOptions]         = useState<{ id: string; orderNumber: string; itemCount: number }[]>([]);
  const [importError, setImportError]     = useState<string | null>(null);
  const lastAddedSupplier                 = useRef<FullSupplier | undefined>(undefined);

  // Fetch open POs for the selected supplier
  useEffect(() => {
    if (!supplierId) { setPoOptions([]); return; }
    api.get("/purchases/orders", { params: { supplierId, status: "PENDING", limit: 20 } })
      .then(({ data }) => {
        setPoOptions((data.data.items ?? []).map((po: any) => ({
          id:          po.id,
          orderNumber: po.orderNumber,
          itemCount:   po._count?.items ?? 0,
        })));
      }).catch(() => setPoOptions([]));
  }, [supplierId]);

  function addMed(m: Medicine) {
    setItems((p) => [...p, { medicineId: m.id, medicineName: m.name, batchNumber: "", expiryDate: "", orderedQty: 0, receivedQty: 1, freeQty: 0, purchaseRate: 0, mrp: 0, discount: 0, gstRate: m.gstRate }]);
  }

  async function loadFromPO() {
    if (!poId) return;
    setPoLoading(true);
    try {
      const { data } = await api.get(`/purchases/orders/${poId}`);
      const poItems: GRNLineItem[] = (data.data.items ?? []).map((i: any) => ({
        medicineId:   i.medicineId ?? "",
        medicineName: i.medicineName,
        batchNumber:  "",
        expiryDate:   "",
        orderedQty:   i.quantity,
        receivedQty:  i.quantity,
        freeQty:      0,
        purchaseRate: i.purchaseRate,
        mrp:          i.mrp,
        discount:     0,
        gstRate:      i.gstRate,
      }));
      setItems((p) => {
        const existing = new Set(p.map((x) => x.medicineName.toLowerCase()));
        return [...p, ...poItems.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
      });
    } catch { setError("Failed to load PO items"); }
    finally { setPoLoading(false); }
  }

  async function copyLastPurchase() {
    if (!supplierId) return;
    setCopyLoading(true);
    try {
      const { data } = await api.get("/purchases/grn", {
        params: { supplierId, status: "CONFIRMED", limit: 1 },
      });
      const last = data.data.items?.[0];
      if (!last) { setError("No previous purchases found for this distributor"); return; }
      const { data: grnData } = await api.get(`/purchases/grn/${last.id}`);
      const grnItems: GRNLineItem[] = (grnData.data.items ?? []).map((i: any) => ({
        medicineId:   i.medicineId ?? "",
        medicineName: i.medicineName,
        batchNumber:  "",
        expiryDate:   "",
        orderedQty:   i.receivedQty,
        receivedQty:  i.receivedQty,
        freeQty:      0,
        purchaseRate: i.purchaseRate,
        mrp:          i.mrp,
        discount:     i.discount,
        gstRate:      i.gstRate,
      }));
      setItems((p) => {
        const existing = new Set(p.map((x) => x.medicineName.toLowerCase()));
        return [...p, ...grnItems.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
      });
    } catch { setError("Failed to load previous purchase"); }
    finally { setCopyLoading(false); }
  }

  async function handleBarcodeScan(code: string) {
    try {
      const { data } = await api.get(`/medicines/barcode/${encodeURIComponent(code)}`);
      addMed(data.data);
    } catch { setError("No medicine found for this barcode"); }
  }

  function handleCSVImport(raw: string) {
    setImportError(null);
    const { items: parsed, errors } = csvToGRNItems(raw);
    if (errors.length > 0) { setImportError(errors.slice(0, 3).join(" · ")); return; }
    const toAdd: GRNLineItem[] = parsed.map((p) => ({
      medicineId:   "",
      medicineName: p.medicineName ?? "",
      batchNumber:  p.batchNumber  ?? "",
      expiryDate:   p.expiryDate   ?? "",
      orderedQty:   0,
      receivedQty:  p.receivedQty  ?? 1,
      freeQty:      p.freeQty      ?? 0,
      purchaseRate: p.purchaseRate ?? 0,
      mrp:          p.mrp          ?? 0,
      discount:     p.discount     ?? 0,
      gstRate:      p.gstRate      ?? 12,
    }));
    setItems((prev) => {
      const existing = new Set(prev.map((x) => x.medicineName.toLowerCase()));
      return [...prev, ...toAdd.filter((i) => !existing.has(i.medicineName.toLowerCase()))];
    });
    setShowImport(false);
  }

  function upd(idx: number, key: keyof GRNLineItem, val: string | number) {
    setItems((p) => { const n = [...p]; (n[idx] as any)[key] = val; return n; });
  }

  const totals = items.reduce((a, i) => {
    const sub = i.purchaseRate * i.receivedQty * (1 - i.discount / 100);
    return { sub: a.sub + sub, gst: a.gst + (sub * i.gstRate) / 100 };
  }, { sub: 0, gst: 0 });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Select a supplier"); return; }
    if (items.length === 0) { setError("Add at least one medicine"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/purchases/grn", {
        supplierId,
        supplierInvoiceNo:   invNo   || undefined,
        supplierInvoiceDate: invDate ? new Date(invDate).toISOString() : undefined,
        purchaseOrderId:     poId    || undefined,
        notes:               notes   || undefined,
        items: items.map((i) => ({ ...i, expiryDate: new Date(i.expiryDate).toISOString() })),
      });
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create GRN");
    } finally { setSaving(false); }
  }

  return (
    <ModalShell icon={<Truck className="w-4 h-4 text-emerald-600" />} iconBg="bg-emerald-50"
      title="Gate Inward — New GRN" desc="DRAFT — confirm later to update stock" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <FieldLabel>Distributor / Supplier *</FieldLabel>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <QuickAddHint suppliers={suppliers} onAdded={(s) => { lastAddedSupplier.current = s; setSuppliers((p) => [...p, s]); setSupplierId(s.id); }} />
            </div>
            <div>
              <FieldLabel>Supplier Invoice No.</FieldLabel>
              <FInput value={invNo} onChange={setInvNo} placeholder="e.g. INV-1234" />
            </div>
            <div>
              <FieldLabel>Invoice Date</FieldLabel>
              <FInput type="date" value={invDate} onChange={setInvDate} />
            </div>
          </div>
          {/* Smart-add shortcuts — PO selector + Copy last + Barcode + CSV */}
          <SmartAddBar
            type="grn"
            supplierId={supplierId}
            onImportCSV={() => setShowImport((v) => !v)}
            onCopyLast={copyLastPurchase}
            onLoadFromPO={loadFromPO}
            poOptions={poOptions}
            selectedPoId={poId}
            onPoChange={(id) => setPoId(id)}
            onScan={handleBarcodeScan}
            loadingCopy={copyLoading}
            loadingPO={poLoading}
          />
          {showImport && (
            <ImportPanel type="grn" onImport={handleCSVImport} onClose={() => setShowImport(false)} />
          )}
          {importError && <ErrorBanner msg={importError} />}

          <div>
            <FieldLabel>Search &amp; Add Medicine (one by one)</FieldLabel>
            <MedicineCombobox onSelect={addMed} onClearError={() => setError(null)} />
          </div>

          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Medicine","Batch","Expiry","Ord","Rcvd","Free","Buy Rate","MRP","Disc %","GST %","Amount",""].map((h) => (
                      <th key={h} className="px-2 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const sub = item.purchaseRate * item.receivedQty * (1 - item.discount / 100);
                    const amt = sub + (sub * item.gstRate) / 100;
                    return (
                      <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-emerald-50/20">
                        <td className="px-2 py-2 max-w-[110px]"><p className="text-[11px] font-semibold text-slate-800 truncate">{item.medicineName}</p></td>
                        <td className="px-1.5 py-2 w-20">
                          <input value={item.batchNumber} onChange={(e) => upd(idx, "batchNumber", e.target.value)} placeholder="Batch"
                            className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" />
                        </td>
                        <td className="px-1.5 py-2 w-28">
                          <input type="date" value={item.expiryDate} onChange={(e) => upd(idx, "expiryDate", e.target.value)}
                            className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" />
                        </td>
                        {[{k:"orderedQty",mn:0},{k:"receivedQty",mn:1},{k:"freeQty",mn:0}].map(({k,mn}) => (
                          <td key={k} className="px-1.5 py-2 w-12">
                            <input type="number" value={(item as any)[k]||""} min={mn} onChange={(e) => upd(idx, k as keyof GRNLineItem, +e.target.value)}
                              className="w-full border border-slate-200 rounded px-1 py-1.5 text-[11px] text-center focus:outline-none focus:border-blue-400" />
                          </td>
                        ))}
                        {[{k:"purchaseRate",step:"0.01"},{k:"mrp",step:"0.01"},{k:"discount",step:"0.5"}].map(({k,step}) => (
                          <td key={k} className="px-1.5 py-2 w-20">
                            <input type="number" value={(item as any)[k]||""} step={step} min={0} onChange={(e) => upd(idx, k as keyof GRNLineItem, +e.target.value)}
                              className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" />
                          </td>
                        ))}
                        <td className="px-1.5 py-2 w-14">
                          <select value={item.gstRate} onChange={(e) => upd(idx, "gstRate", +e.target.value)}
                            className="w-full border border-slate-200 rounded px-1 py-1.5 text-[11px] bg-white focus:outline-none focus:border-blue-400">
                            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-[11px] font-semibold text-slate-700 tabular-nums whitespace-nowrap">{currency(amt)}</td>
                        <td className="px-1.5 py-2">
                          <button type="button" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                            className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center text-slate-300 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={10} className="px-3 py-2.5 text-right text-[12px] text-slate-500">
                      Subtotal <span className="font-semibold text-slate-700">{currency(totals.sub)}</span>
                      {"  ·  "}GST <span className="font-semibold text-slate-700">{currency(totals.gst)}</span>
                      {"  ·  "}Total
                    </td>
                    <td className="px-2 py-2.5 text-[14px] font-bold text-slate-900 tabular-nums">{currency(totals.sub + totals.gst)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {error && <ErrorBanner msg={error} />}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <span className="text-[12px] text-slate-400">{items.length} line item{items.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 font-medium">Cancel</button>
            <button type="submit" disabled={saving || items.length === 0}
              className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Save GRN
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Create Return Modal ──────────────────────────────────────────────────────

function CreateReturnModal({ suppliers: initialSuppliers, onClose, onDone }: { suppliers: Supplier[]; onClose: () => void; onDone: (newSupplier?: FullSupplier) => void }) {
  const [suppliers,   setSuppliers]   = useState<Supplier[]>(initialSuppliers);
  const [supplierId,  setSupplierId]  = useState("");
  const [debitNoteNo, setDebitNoteNo] = useState("");
  const [notes,       setNotes]       = useState("");
  const [items,       setItems]       = useState<SRLineItem[]>([]);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [scanLoading,     setScanLoading]     = useState(false);
  const [copyLoading,     setCopyLoading]     = useState(false);
  const [showImport,      setShowImport]      = useState(false);
  const [showBatchPicker, setShowBatchPicker] = useState(false);
  const lastAddedSupplier                     = useRef<FullSupplier | undefined>(undefined);

  async function onScan(code: string) {
    setScanLoading(true);
    try {
      const { data } = await api.get(`/medicines/barcode/${encodeURIComponent(code)}`);
      setItems((p) => [...p, { inventoryId: "", medicineId: data.data.id, medicineName: data.data.name, batchNumber: "", expiryDate: "", quantity: 1, purchaseRate: 0, reason: "DAMAGED" }]);
    } catch { setError("No medicine found for this barcode"); } finally { setScanLoading(false); }
  }

  // Load from most recent confirmed GRN for this distributor
  async function copyFromLastPurchase() {
    if (!supplierId) return;
    setCopyLoading(true);
    try {
      const { data } = await api.get("/purchases/grn", { params: { supplierId, status: "CONFIRMED", limit: 1 } });
      const last = data.data.items?.[0];
      if (!last) { setError("No recent purchases found for this distributor"); return; }
      const { data: grnData } = await api.get(`/purchases/grn/${last.id}`);
      const newItems: SRLineItem[] = (grnData.data.items ?? []).map((i: any) => ({
        inventoryId:  i.inventoryId ?? "",
        medicineId:   i.medicineId  ?? "",
        medicineName: i.medicineName,
        batchNumber:  i.batchNumber ?? "",
        expiryDate:   i.expiryDate  ? new Date(i.expiryDate).toISOString().split("T")[0]! : "",
        quantity:     1,
        purchaseRate: i.purchaseRate,
        reason:       "DAMAGED" as const,
      }));
      setItems((p) => [...p, ...newItems.filter((n) =>
        !p.some((x) => x.medicineName.toLowerCase() === n.medicineName.toLowerCase())
      )]);
    } catch { setError("Failed to load previous purchase"); } finally { setCopyLoading(false); }
  }

  function handleCSVImport(raw: string) {
    const { items: parsed, errors } = csvToReturnItems(raw);
    if (errors.length > 0) { setError(errors.slice(0, 2).join(" · ")); return; }
    const toAdd: SRLineItem[] = parsed.map((p) => ({
      inventoryId:  "",
      medicineId:   "",
      medicineName: p.medicineName ?? "",
      batchNumber:  p.batchNumber  ?? "",
      expiryDate:   p.expiryDate   ?? "",
      quantity:     p.quantity     ?? 1,
      purchaseRate: p.purchaseRate ?? 0,
      reason:       "DAMAGED" as const,
    }));
    setItems((prev) => [...prev, ...toAdd.filter((i) =>
      !prev.some((x) => x.medicineName.toLowerCase() === i.medicineName.toLowerCase())
    )]);
    setShowImport(false);
  }

  function upd(idx: number, key: string, val: string | number) {
    setItems((p) => { const n = [...p]; (n[idx] as any)[key] = val; return n; });
  }

  const total = items.reduce((s, i) => s + i.purchaseRate * i.quantity, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Select a supplier"); return; }
    if (items.length === 0) { setError("Add at least one item"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/supplier-returns", {
        supplierId, debitNoteNo: debitNoteNo || undefined, notes: notes || undefined,
        items: items.map((i) => ({ ...i, expiryDate: new Date(i.expiryDate).toISOString() })),
      });
      onDone(lastAddedSupplier.current);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create return");
    } finally { setSaving(false); }
  }

  return (
    <ModalShell icon={<RotateCcw className="w-4 h-4 text-red-500" />} iconBg="bg-red-50"
      title="New Supplier Return" desc="DRAFT — confirm to deduct inventory stock" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>Distributor / Supplier *</FieldLabel>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
                <option value="">Select…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <QuickAddHint suppliers={suppliers} onAdded={(s) => { lastAddedSupplier.current = s; setSuppliers((p) => [...p, s]); setSupplierId(s.id); }} />
            </div>
            <div>
              <FieldLabel>Debit Note No.</FieldLabel>
              <FInput value={debitNoteNo} onChange={setDebitNoteNo} placeholder="Optional" />
            </div>
            <div>
              <FieldLabel>Scan Barcode</FieldLabel>
              <BarcodeInput onScan={onScan} loading={scanLoading} placeholder="Scan item barcode…" />
            </div>
          </div>

          {/* Smart shortcuts: select from inventory + copy from recent purchase + CSV import */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Add items via:</span>
            <button type="button" onClick={() => { setShowBatchPicker((v) => !v); setShowImport(false); }}
              className={cn("flex items-center gap-1.5 border text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors",
                showBatchPicker ? "bg-violet-100 border-violet-300 text-violet-700" : "border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700")}>
              <Package className="w-3.5 h-3.5" />Select from Inventory
            </button>
            <button type="button" onClick={copyFromLastPurchase} disabled={!supplierId || copyLoading}
              title={!supplierId ? "Select a distributor first" : ""}
              className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-semibold h-8 px-3 rounded-lg disabled:opacity-40 transition-colors">
              {copyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              From Last Purchase
            </button>
            <button type="button" onClick={() => { setShowImport((v) => !v); setShowBatchPicker(false); }}
              className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
              <FileSpreadsheet className="w-3.5 h-3.5" />Import CSV / Sheet
            </button>
          </div>
          {showBatchPicker && (
            <InventoryBatchPicker
              onAdd={(picked) => {
                setItems((prev) => {
                  const existing = new Set(prev.map((x) => x.batchNumber.toLowerCase()));
                  return [...prev, ...picked.filter((i) => !existing.has(i.batchNumber.toLowerCase()))];
                });
                setShowBatchPicker(false);
              }}
              onClose={() => setShowBatchPicker(false)}
            />
          )}
          {showImport && (
            <ImportPanel type="return" onImport={handleCSVImport} onClose={() => setShowImport(false)} />
          )}

          {items.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Medicine","Inventory ID","Batch","Expiry","Qty","Buy Rate","Reason","Amount",""].map((h) => (
                      <th key={h} className="px-2 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2 max-w-[110px]"><p className="text-[11px] font-semibold text-slate-800 truncate">{item.medicineName}</p></td>
                      <td className="px-1.5 py-2 w-28"><input value={item.inventoryId} onChange={(e) => upd(idx,"inventoryId",e.target.value)} placeholder="Inventory ID" className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-20"><input value={item.batchNumber} onChange={(e) => upd(idx,"batchNumber",e.target.value)} placeholder="Batch" className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-28"><input type="date" value={item.expiryDate} onChange={(e) => upd(idx,"expiryDate",e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-14"><input type="number" value={item.quantity} min={1} onChange={(e) => upd(idx,"quantity",+e.target.value)} className="w-full border border-slate-200 rounded px-1.5 py-1.5 text-[11px] text-center focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-20"><input type="number" value={item.purchaseRate||""} step="0.01" min={0} onChange={(e) => upd(idx,"purchaseRate",+e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-400" /></td>
                      <td className="px-1.5 py-2 w-32">
                        <select value={item.reason} onChange={(e) => upd(idx,"reason",e.target.value)} className="w-full border border-slate-200 rounded px-1 py-1.5 text-[11px] bg-white focus:outline-none focus:border-blue-400">
                          {SR_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2 text-[11px] font-semibold text-slate-700 tabular-nums">₹{(item.purchaseRate * item.quantity).toFixed(2)}</td>
                      <td className="px-1.5 py-2">
                        <button type="button" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center text-slate-300 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr><td colSpan={7} className="px-3 py-2.5 text-right text-[12px] text-slate-500">Total Return Value</td><td className="px-2 py-2.5 text-[14px] font-bold text-slate-900">₹{total.toFixed(2)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}

          {error && <ErrorBanner msg={error} />}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <span className="text-[12px] text-slate-400">{items.length} item{items.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50 font-medium">Cancel</button>
            <button type="submit" disabled={saving || items.length === 0}
              className="px-6 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create Return
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Shared Modal Shell ────────────────────────────────────────────────────────

function ModalShell({ icon, iconBg, title, desc, onClose, children }: {
  icon: React.ReactNode; iconBg: string; title: string; desc: string;
  onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", iconBg)}>{icon}</div>
            <div>
              <h2 className="text-[16px] font-bold text-slate-900 leading-tight">{title}</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[13px] text-red-600">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />{msg}
    </div>
  );
}

function ActionBtn({ onClick, disabled, icon: Icon, label, cls }: {
  onClick: () => void; disabled?: boolean; icon: React.ElementType;
  label: string; cls: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("flex items-center gap-1 text-[11px] font-semibold border rounded-md px-2 py-1 transition-colors disabled:opacity-50", cls)}>
      <Icon className="w-3 h-3" />{label}
    </button>
  );
}

// ─── Tab: Purchase (Confirmed GRNs / Invoices) ────────────────────────────────

function PurchaseTab({ suppliers }: { suppliers: Supplier[] }) {
  const [grns, setGRNs]           = useState<GRN[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [supplierId, setSupp]     = useState("");
  const [dateFrom, setFrom]       = useState("");
  const [dateTo, setTo]           = useState("");
  const [overdueOnly, setOverdue] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, any> = { page, limit: 20, status: "CONFIRMED" };
      if (search)      p.search     = search;
      if (supplierId)  p.supplierId = supplierId;
      if (dateFrom)    p.from       = new Date(dateFrom).toISOString();
      if (dateTo)      p.to         = new Date(dateTo + "T23:59:59").toISOString();
      if (overdueOnly) p.overdue    = true;
      const { data } = await api.get("/purchases/grn", { params: p });
      setGRNs(data.data.items); setTotal(data.data.total);
    } catch {/* */} finally { setLoading(false); }
  }, [page, search, supplierId, dateFrom, dateTo, overdueOnly]);

  useEffect(() => { const t = setTimeout(load, search ? 350 : 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="flex flex-col h-full">
      <FilterBar search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        supplierId={supplierId} onSupplier={(v) => { setSupp(v); setPage(1); }} suppliers={suppliers}
        dateFrom={dateFrom} dateTo={dateTo} onDateFrom={(v) => { setFrom(v); setPage(1); }} onDateTo={(v) => { setTo(v); setPage(1); }}
        statusValue={overdueOnly ? "overdue" : ""}
        onStatus={(v) => { setOverdue(v === "overdue"); setPage(1); }}
        statusOptions={[{ value: "overdue", label: "Overdue Payment" }]}
        rightSlot={
          <button onClick={load} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
        }
      />

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","GRN No.","Invoice No.","Entry Date","Bill Date","Distributor","Items","Bill Amt ₹","GST ₹","Payment Due",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-24 text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : grns.length === 0 ? (
              <tr><td colSpan={11}>
                <EmptyState icon={FileX} title="No purchase invoices found" desc="Confirmed GRNs will appear here" />
              </td></tr>
            ) : grns.map((grn, i) => {
              const overdue     = isOverdue(grn.paymentDueDate);
              const daysLeft    = daysUntil(grn.paymentDueDate);
              return (
                <tr key={grn.id} className={cn("border-b border-slate-100 hover:bg-blue-50/20 transition-colors", overdue && "bg-red-50/30")}>
                  <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                  <td className="px-4 py-3 text-[13px] font-bold text-emerald-700">{grn.grnNumber}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-600">{grn.supplierInvoiceNo ?? "—"}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(grn.createdAt)}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(grn.confirmedAt)}</td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">{grn.supplier.name}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{grn._count.items}</td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 tabular-nums">{currency(grn.totalAmount)}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{currency(grn.totalGst)}</td>
                  <td className="px-4 py-3">
                    {grn.paymentDueDate ? (
                      <div className={cn("text-[11px] font-semibold", overdue ? "text-red-600" : daysLeft !== null && daysLeft <= 7 ? "text-amber-600" : "text-slate-500")}>
                        {overdue ? <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Overdue {fmtDate(grn.paymentDueDate)}</span>
                          : <span>{fmtDate(grn.paymentDueDate)}{daysLeft !== null && <span className="text-slate-400 font-normal ml-1">({daysLeft}d)</span>}</span>}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button className="w-7 h-7 rounded-lg hover:bg-blue-50 flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />
    </div>
  );
}

// ─── Tab: Gate Inward (Draft GRNs) ────────────────────────────────────────────

function GateInwardTab({ suppliers }: { suppliers: Supplier[] }) {
  const [grns, setGRNs]       = useState<GRN[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(true);
  const [supplierId, setSupp] = useState("");
  const [actionId, setAction] = useState<string | null>(null);
  const [showCreate, setShow] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, any> = { page, limit: 20, status: "DRAFT" };
      if (supplierId) p.supplierId = supplierId;
      const { data } = await api.get("/purchases/grn", { params: p });
      setGRNs(data.data.items); setTotal(data.data.total);
    } catch {/* */} finally { setLoading(false); }
  }, [page, supplierId]);

  useEffect(() => { load(); }, [load]);

  async function confirm(id: string) {
    if (!window.confirm("Confirm this GRN? This will update inventory stock and cannot be undone.")) return;
    setAction(id);
    try { await api.patch(`/purchases/grn/${id}/confirm`); load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Failed to confirm GRN"); }
    finally { setAction(null); }
  }

  async function cancel(id: string) {
    if (!window.confirm("Cancel this GRN?")) return;
    setAction(id);
    try { await api.delete(`/purchases/grn/${id}`); load(); }
    catch {/* */} finally { setAction(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white flex-shrink-0">
        <select value={supplierId} onChange={(e) => { setSupp(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg bg-white h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none min-w-[160px]">
          <option value="">All Distributors</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => setShow(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New Gate Inward
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","GRN No.","Supplier Invoice","Against PO","Distributor","Items","Total ₹","Date","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-24 text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : grns.length === 0 ? (
              <tr><td colSpan={9}>
                <EmptyState icon={Truck} title="No pending gate inwards"
                  desc="Draft GRNs waiting to be confirmed appear here"
                  action="Create New GRN" onAction={() => setShow(true)} />
              </td></tr>
            ) : grns.map((grn, i) => (
              <tr key={grn.id} className="border-b border-slate-100 hover:bg-amber-50/20 transition-colors group">
                <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-amber-700">{grn.grnNumber}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{grn.supplierInvoiceNo ?? "—"}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{grn.purchaseOrder?.orderNumber ?? "—"}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">{grn.supplier.name}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{grn._count.items}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 tabular-nums">{currency(grn.totalAmount)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(grn.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ActionBtn onClick={() => confirm(grn.id)} disabled={actionId === grn.id}
                      icon={actionId === grn.id ? Loader2 : Check} label="Confirm"
                      cls="text-emerald-600 border-emerald-200 hover:bg-emerald-50" />
                    <ActionBtn onClick={() => cancel(grn.id)} disabled={actionId === grn.id}
                      icon={X} label="Cancel" cls="text-red-500 border-red-100 hover:bg-red-50" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {showCreate && <CreateGRNModal suppliers={suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Tab: Purchase Orders ─────────────────────────────────────────────────────

function POTab({ suppliers }: { suppliers: Supplier[] }) {
  const [orders, setOrders]       = useState<PurchaseOrder[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [supplierId, setSupp]     = useState("");
  const [status, setStatus]       = useState("");
  const [dateFrom, setFrom]       = useState("");
  const [dateTo, setTo]           = useState("");
  const [showCreate, setShow]     = useState(false);
  const [actionId, setAction]     = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, any> = { page, limit: 20 };
      if (search)     p.search     = search;
      if (supplierId) p.supplierId = supplierId;
      if (status)     p.status     = status;
      if (dateFrom)   p.from       = new Date(dateFrom).toISOString();
      if (dateTo)     p.to         = new Date(dateTo + "T23:59:59").toISOString();
      const { data } = await api.get("/purchases/orders", { params: p });
      setOrders(data.data.items); setTotal(data.data.total);
    } catch {/* */} finally { setLoading(false); }
  }, [page, search, supplierId, status, dateFrom, dateTo]);

  useEffect(() => { const t = setTimeout(load, search ? 350 : 0); return () => clearTimeout(t); }, [load]);

  async function sendPO(id: string) {
    setAction(id);
    try { await api.patch(`/purchases/orders/${id}/send`); load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Cannot send"); } finally { setAction(null); }
  }

  async function cancelPO(id: string) {
    if (!window.confirm("Cancel this purchase order?")) return;
    setAction(id);
    try { await api.delete(`/purchases/orders/${id}`); load(); }
    catch {/* */} finally { setAction(null); }
  }

  async function approvePO(id: string, approved: boolean) {
    setApproveId(id);
    try { await api.patch(`/purchases/orders/${id}/approve`, { approved }); load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Failed"); } finally { setApproveId(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <FilterBar search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        supplierId={supplierId} onSupplier={(v) => { setSupp(v); setPage(1); }} suppliers={suppliers}
        dateFrom={dateFrom} dateTo={dateTo} onDateFrom={(v) => { setFrom(v); setPage(1); }} onDateTo={(v) => { setTo(v); setPage(1); }}
        statusValue={status} onStatus={(v) => { setStatus(v); setPage(1); }}
        statusOptions={Object.entries(PO_STATUS).map(([v, c]) => ({ value: v, label: c.label }))}
        rightSlot={
          <>
            <button onClick={load} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100">
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </button>
            <button onClick={() => setShow(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New PO
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","PO Number","Distributor","Invoice No.","Status","Approval","Items","Total ₹","Expected","Date","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-24 text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={11}>
                <EmptyState icon={FileText} title="No purchase orders found"
                  desc="Create a PO to track what you've ordered from suppliers"
                  action="Create First PO" onAction={() => setShow(true)} />
              </td></tr>
            ) : orders.map((po, i) => (
              <tr key={po.id} className={cn("border-b border-slate-100 hover:bg-blue-50/20 transition-colors group",
                po.approvalStatus === "PENDING_APPROVAL" && "bg-orange-50/30")}>
                <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-blue-600">{po.orderNumber}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">{po.supplier.name}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{po.invoiceNo ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={po.status} cfg={PO_STATUS} /></td>
                <td className="px-4 py-3">
                  {po.approvalStatus !== "NOT_REQUIRED" && (
                    <span className={cn("inline-flex items-center text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap", APPROVAL_STATUS[po.approvalStatus]?.cls)}>
                      {APPROVAL_STATUS[po.approvalStatus]?.label}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{po._count.items}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 tabular-nums">{currency(po.totalAmount)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-400">{fmtDate(po.expectedDate)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(po.orderedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {po.approvalStatus === "PENDING_APPROVAL" && (
                      <>
                        <ActionBtn onClick={() => approvePO(po.id, true)} disabled={approveId === po.id}
                          icon={Check} label="Approve" cls="text-green-600 border-green-200 hover:bg-green-50" />
                        <ActionBtn onClick={() => approvePO(po.id, false)} disabled={approveId === po.id}
                          icon={X} label="Reject" cls="text-red-500 border-red-100 hover:bg-red-50" />
                      </>
                    )}
                    {po.status === "DRAFT" && po.approvalStatus !== "PENDING_APPROVAL" && po.approvalStatus !== "REJECTED" && (
                      <ActionBtn onClick={() => sendPO(po.id)} disabled={actionId === po.id}
                        icon={actionId === po.id ? Loader2 : Send} label="Send"
                        cls="text-amber-600 border-amber-200 hover:bg-amber-50" />
                    )}
                    {!["RECEIVED", "CANCELLED"].includes(po.status) && (
                      <ActionBtn onClick={() => cancelPO(po.id)} disabled={actionId === po.id}
                        icon={X} label="Cancel" cls="text-red-500 border-red-100 hover:bg-red-50" />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {showCreate && <CreatePOModal suppliers={suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Tab: Supplier Returns ────────────────────────────────────────────────────

function ReturnsTab({ suppliers }: { suppliers: Supplier[] }) {
  const [returns, setReturns]   = useState<SupplierReturn[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [supplierId, setSupp]   = useState("");
  const [status, setStatus]     = useState("");
  const [showCreate, setShow]   = useState(false);
  const [actionId, setAction]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, any> = { page, limit: 20 };
      if (supplierId) p.supplierId = supplierId;
      if (status)     p.status     = status;
      const { data } = await api.get("/supplier-returns", { params: p });
      setReturns(data.data.items); setTotal(data.data.total);
    } catch {/* */} finally { setLoading(false); }
  }, [page, supplierId, status]);

  useEffect(() => { load(); }, [load]);

  async function confirm(id: string) {
    if (!window.confirm("Confirm return? This will deduct inventory stock.")) return;
    setAction(id);
    try { await api.patch(`/supplier-returns/${id}/confirm`); load(); }
    catch (e: any) { alert(e?.response?.data?.error ?? "Failed"); } finally { setAction(null); }
  }

  async function cancel(id: string) {
    if (!window.confirm("Cancel this return?")) return;
    setAction(id);
    try { await api.delete(`/supplier-returns/${id}`); load(); }
    catch {/* */} finally { setAction(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white flex-shrink-0">
        <select value={supplierId} onChange={(e) => { setSupp(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg bg-white h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none min-w-[160px]">
          <option value="">All Distributors</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg bg-white h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none min-w-[110px]">
          <option value="">All Status</option>
          {Object.entries(SR_STATUS).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => setShow(true)}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New Return
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Sr No.","Return No.","Distributor","Debit Note No.","Status","Items","Return Value ₹","Date","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-24 text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : returns.length === 0 ? (
              <tr><td colSpan={9}>
                <EmptyState icon={RotateCcw} title="No supplier returns yet"
                  desc="Track damaged, expired, or incorrect goods returned to distributors" />
              </td></tr>
            ) : returns.map((sr, i) => (
              <tr key={sr.id} className="border-b border-slate-100 hover:bg-red-50/10 transition-colors group">
                <td className="px-4 py-3 text-[12px] text-slate-400 tabular-nums">{(page - 1) * 20 + i + 1}</td>
                <td className="px-4 py-3 text-[13px] font-bold text-red-600">{sr.returnNumber}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">{sr.supplier.name}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{sr.debitNoteNo ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={sr.status} cfg={SR_STATUS} /></td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{sr._count.items}</td>
                <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 tabular-nums">{currency(sr.totalAmount)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{fmtDate(sr.createdAt)}</td>
                <td className="px-4 py-3">
                  {sr.status === "DRAFT" && (
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ActionBtn onClick={() => confirm(sr.id)} disabled={actionId === sr.id}
                        icon={actionId === sr.id ? Loader2 : Check} label="Confirm"
                        cls="text-blue-600 border-blue-200 hover:bg-blue-50" />
                      <ActionBtn onClick={() => cancel(sr.id)} disabled={actionId === sr.id}
                        icon={X} label="Cancel" cls="text-red-500 border-red-100 hover:bg-red-50" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {showCreate && <CreateReturnModal suppliers={suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); load(); }} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Supplier Form (used in Distributors tab + inline quick-add) ──────────────

type SupplierFormState = {
  name: string; gstin: string; dlNumber: string; phone: string; email: string;
  address: string; city: string; state: string;
  creditLimit: string; creditDays: string; paymentTerms: string;
};

const SUPPLIER_BLANK: SupplierFormState = {
  name: "", gstin: "", dlNumber: "", phone: "", email: "",
  address: "", city: "", state: "", creditLimit: "0", creditDays: "30", paymentTerms: "",
};

type FullSupplier = Supplier & {
  gstin: string | null; dlNumber: string | null; email: string | null;
  address: string | null; city: string | null; state: string | null;
  creditLimit: number; creditDays: number; paymentTerms: string | null;
  isActive: boolean; _count: { purchaseOrders: number };
};

// Defined at module level — stable identity across renders, no focus-loss bug.
function SupplierField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors"
      />
    </div>
  );
}

function SupplierFormModal({ supplier, onClose, onSaved }: {
  supplier: FullSupplier | null;
  onClose: () => void;
  onSaved: (s: FullSupplier) => void;
}) {
  const [form,   setForm]   = useState<SupplierFormState>(supplier ? {
    name:         supplier.name,
    gstin:        supplier.gstin        ?? "",
    dlNumber:     supplier.dlNumber     ?? "",
    phone:        supplier.phone        ?? "",
    email:        supplier.email        ?? "",
    address:      supplier.address      ?? "",
    city:         supplier.city         ?? "",
    state:        supplier.state        ?? "",
    creditLimit:  String(supplier.creditLimit),
    creditDays:   String(supplier.creditDays),
    paymentTerms: supplier.paymentTerms ?? "",
  } : SUPPLIER_BLANK);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const set = (k: keyof SupplierFormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // prevent submit bubbling to outer PO/GRN form
    if (!form.name.trim()) { setError("Distributor name is required"); return; }
    setSaving(true); setError(null);
    try {
      const body = {
        name:         form.name.trim(),
        gstin:        form.gstin.trim()        || undefined,
        dlNumber:     form.dlNumber.trim()     || undefined,
        phone:        form.phone.trim()        || undefined,
        email:        form.email.trim()        || undefined,
        address:      form.address.trim()      || undefined,
        city:         form.city.trim()         || undefined,
        state:        form.state.trim()        || undefined,
        creditLimit:  Number(form.creditLimit) || 0,
        creditDays:   Number(form.creditDays)  || 30,
        paymentTerms: form.paymentTerms.trim() || undefined,
      };
      const { data } = supplier
        ? await api.patch(`/suppliers/${supplier.id}`, body)
        : await api.post("/suppliers", body);
      onSaved(data.data);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to save distributor");
    } finally { setSaving(false); }
  }

  // Portal: renders to document.body, outside any outer <form> DOM tree.
  // Fixes (1) nested-form submit bubbling and (2) Framer Motion transform stacking context.
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* ── Sticky header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-slate-900">
                {supplier ? "Edit Distributor" : "Add New Distributor"}
              </h2>
              <p className="text-[11px] text-slate-400">
                Fill in details to {supplier ? "update" : "register"} the distributor
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* ── Scrollable form body ── */}
        <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* Basic info */}
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Basic Information</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <SupplierField label="Distributor / Company Name *" value={form.name}     onChange={set("name")}     placeholder="e.g. Sun Pharma Distributors Pvt Ltd" />
                </div>
                <SupplierField label="GSTIN"        value={form.gstin}    onChange={set("gstin")}    placeholder="22AAAAA0000A1Z5" />
                <SupplierField label="Drug License" value={form.dlNumber} onChange={set("dlNumber")} placeholder="DL No." />
                <SupplierField label="Phone"        value={form.phone}    onChange={set("phone")}    placeholder="+91 98765 43210" />
                <SupplierField label="Email"        value={form.email}    onChange={set("email")}    placeholder="contact@distributor.com" type="email" />
              </div>
            </div>

            {/* Address */}
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Address</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-3">
                  <SupplierField label="Street Address" value={form.address} onChange={set("address")} placeholder="123, Industrial Area" />
                </div>
                <SupplierField label="City"  value={form.city}  onChange={set("city")}  placeholder="Mumbai" />
                <SupplierField label="State" value={form.state} onChange={set("state")} placeholder="Maharashtra" />
              </div>
            </div>

            {/* Credit terms */}
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" />Credit Terms
              </p>
              <div className="grid grid-cols-3 gap-4">
                <SupplierField label="Credit Limit (₹)" value={form.creditLimit}  onChange={set("creditLimit")}  placeholder="0"      type="number" />
                <SupplierField label="Credit Days"       value={form.creditDays}   onChange={set("creditDays")}   placeholder="30"     type="number" />
                <SupplierField label="Payment Terms"     value={form.paymentTerms} onChange={set("paymentTerms")} placeholder="Net 30" />
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Credit Days sets the payment due date automatically when a GRN is confirmed.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[13px] text-red-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
              </div>
            )}
          </div>

          {/* ── Sticky footer — always visible ── */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0 bg-white">
            <button type="button" onClick={onClose}
              className="px-5 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 font-medium hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {supplier ? "Save Changes" : "Add Distributor"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body   // portal target — outside any outer form DOM tree
  );
}

// ─── Distributors Tab ─────────────────────────────────────────────────────────

function DistributorsTab({ onSupplierAdded }: { onSupplierAdded: (s: FullSupplier) => void }) {
  const [suppliers,  setSuppliers]  = useState<FullSupplier[]>([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [modal,      setModal]      = useState<"add" | "edit" | null>(null);
  const [editing,    setEditing]    = useState<FullSupplier | null>(null);
  const [historyFor, setHistoryFor] = useState<FullSupplier | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, limit: 20 };
      if (search.trim()) params.search = search.trim();
      const { data } = await api.get("/suppliers", { params });
      setSuppliers(data.data.items);
      setTotal(data.data.total);
    } catch {/* */} finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { const t = setTimeout(load, search ? 350 : 0); return () => clearTimeout(t); }, [load]);

  function handleSaved(saved: FullSupplier) {
    setSuppliers((p) => {
      const idx = p.findIndex((s) => s.id === saved.id);
      if (idx >= 0) { const n = [...p]; n[idx] = saved; return n; }
      return [saved, ...p];
    });
    setModal(null); setEditing(null);
    if (!editing) onSupplierAdded(saved); // new supplier — refresh parent list
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white flex-shrink-0">
        <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden h-8 max-w-[280px] flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 flex-shrink-0" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search distributor name, city…"
            className="flex-1 px-2 text-[12px] placeholder-slate-400 focus:outline-none h-full bg-transparent" />
          {search && <button onClick={() => setSearch("")} className="mr-2 text-slate-300 hover:text-slate-500"><X className="w-3 h-3" /></button>}
        </div>
        <span className="text-[12px] text-slate-400 ml-1">{total} distributor{total !== 1 ? "s" : ""}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
          <button onClick={() => { setEditing(null); setModal("add"); }}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />Add Distributor
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {["Distributor Name","Contact","City / State","GSTIN","Drug Lic.","Credit Limit","Credit Days","Payment Terms","POs",""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="py-24 text-center"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></td></tr>
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={10}>
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                    <Building2 className="w-7 h-7 text-blue-300" />
                  </div>
                  <p className="text-[15px] font-semibold text-slate-700 mb-1">No distributors yet</p>
                  <p className="text-[13px] text-slate-400 mb-4 max-w-xs">Add your medicine distributors here first, then you can place purchase orders against them.</p>
                  <button onClick={() => { setEditing(null); setModal("add"); }}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors">
                    <Plus className="w-4 h-4" />Add First Distributor
                  </button>
                </div>
              </td></tr>
            ) : suppliers.map((s) => (
              <tr key={s.id} className="border-b border-slate-100 hover:bg-blue-50/20 transition-colors group">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-slate-800">{s.name}</p>
                      {!s.isActive && <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">Inactive</span>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-[12px] text-slate-500 space-y-0.5">
                    {s.phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3 text-slate-300" />{s.phone}</p>}
                    {s.email && <p className="flex items-center gap-1 max-w-[150px] truncate"><Mail className="w-3 h-3 text-slate-300 flex-shrink-0" />{s.email}</p>}
                    {!s.phone && !s.email && <span className="text-slate-300">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">
                  {(s.city || s.state)
                    ? <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-300" />{[s.city, s.state].filter(Boolean).join(", ")}</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-[11px] font-mono text-slate-500">{s.gstin ?? "—"}</td>
                <td className="px-4 py-3 text-[11px] text-slate-500">{s.dlNumber ?? "—"}</td>
                <td className="px-4 py-3 text-[12px] text-slate-700 tabular-nums">
                  {s.creditLimit > 0 ? `₹${s.creditLimit.toLocaleString("en-IN")}` : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {s.creditDays > 0
                    ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">{s.creditDays} days</span>
                    : <span className="text-slate-300 text-[12px]">—</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{s.paymentTerms ?? "—"}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{(s._count as any)?.purchaseOrders ?? 0}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditing(s); setModal("edit"); }}
                      className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-md px-2 py-1 transition-colors">
                      <Edit2 className="w-3 h-3" />Edit
                    </button>
                    <button onClick={() => setHistoryFor(s)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50 rounded-md px-2 py-1 transition-colors">
                      <History className="w-3 h-3" />History
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={Math.ceil(total / 20) || 1} total={total} limit={20} onChange={setPage} />

      <AnimatePresence>
        {(modal === "add" || modal === "edit") && (
          <SupplierFormModal supplier={modal === "edit" ? editing : null} onClose={() => { setModal(null); setEditing(null); }} onSaved={handleSaved} />
        )}
        {historyFor && <SupplierHistoryModal supplier={historyFor} onClose={() => setHistoryFor(null)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Supplier History Modal (lightweight) ─────────────────────────────────────

type HistoryData = {
  orders:     { items: { id: string; orderNumber: string; status: string; totalAmount: number; orderedAt: string; _count: { items: number } }[] };
  recentGRNs: { id: string; grnNumber: string; status: string; totalAmount: number; createdAt: string }[];
  summary:    { totalOrders: number; totalSpend: number };
};

function SupplierHistoryModal({ supplier, onClose }: { supplier: FullSupplier; onClose: () => void }) {
  const [data,    setData]    = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/suppliers/${supplier.id}/history`)
      .then(({ data }) => setData(data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.16 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[86vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">Purchase History</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">{supplier.name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center"><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
          ) : !data ? (
            <p className="text-center py-16 text-slate-400">No history found</p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide">Total Orders</p>
                  <p className="text-[26px] font-black text-blue-700 mt-1">{data.summary.totalOrders}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">Total Spend</p>
                  <p className="text-[22px] font-black text-emerald-700 mt-1">₹{data.summary.totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
              {(supplier.creditLimit > 0 || supplier.creditDays > 0) && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="text-[12px] font-bold text-amber-600 mb-2 flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />Credit Terms</p>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><p className="text-[10px] text-amber-500 font-semibold uppercase">Limit</p><p className="text-[15px] font-bold text-amber-800">₹{supplier.creditLimit.toLocaleString("en-IN")}</p></div>
                    <div><p className="text-[10px] text-amber-500 font-semibold uppercase">Days</p><p className="text-[15px] font-bold text-amber-800">{supplier.creditDays}d</p></div>
                    <div><p className="text-[10px] text-amber-500 font-semibold uppercase">Terms</p><p className="text-[13px] font-semibold text-amber-700">{supplier.paymentTerms || "—"}</p></div>
                  </div>
                </div>
              )}
              {data.recentGRNs.length > 0 && (
                <div>
                  <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-2">Recent Receipts (GRNs)</p>
                  <div className="space-y-1.5">
                    {data.recentGRNs.map((grn) => (
                      <div key={grn.id} className="flex items-center justify-between bg-emerald-50/50 border border-emerald-100 rounded-lg px-3 py-2.5">
                        <div><p className="text-[13px] font-bold text-emerald-700">{grn.grnNumber}</p><p className="text-[11px] text-slate-400">{fmtDate(grn.createdAt)}</p></div>
                        <div className="text-right"><p className="text-[13px] font-semibold text-slate-700">₹{grn.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p><p className={cn("text-[10px] font-bold", grn.status === "CONFIRMED" ? "text-emerald-600" : "text-amber-600")}>{grn.status}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Inline Quick-Add Distributor hint (shown under supplier selects) ─────────

function QuickAddHint({ suppliers, onAdded }: { suppliers: Supplier[]; onAdded: (s: FullSupplier) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hint / warning shown below the supplier <select> */}
      {suppliers.length > 0 ? (
        <p className="text-[11px] text-slate-400 mt-1">
          Not listed?{" "}
          <button type="button" onClick={() => setOpen(true)}
            className="text-blue-600 hover:underline font-semibold">
            + Add new distributor
          </button>
        </p>
      ) : (
        <div className="mt-1.5 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <span className="text-[12px] text-amber-700">No distributors added yet.</span>
          <button type="button" onClick={() => setOpen(true)}
            className="text-[12px] font-semibold text-blue-600 hover:underline ml-1">
            Add one now →
          </button>
        </div>
      )}

      {/* SupplierFormModal renders via portal — completely outside this form's DOM tree */}
      <AnimatePresence>
        {open && (
          <SupplierFormModal
            supplier={null}
            onClose={() => setOpen(false)}
            onSaved={(s) => { onAdded(s); setOpen(false); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Tab Config ────────────────────────────────────────────────────────────────

type Tab = "purchase" | "gate-inward" | "po" | "returns" | "distributors";

const TABS: { key: Tab; label: string; icon: React.ElementType; color: string }[] = [
  { key: "purchase",      label: "Purchase",      icon: FileText,   color: "emerald" },
  { key: "gate-inward",   label: "Gate Inward",   icon: Truck,      color: "amber"   },
  { key: "po",            label: "Purchase Order",icon: BarChart3,  color: "blue"    },
  { key: "returns",       label: "Returns",       icon: RotateCcw,  color: "red"     },
  { key: "distributors",  label: "Distributors",  icon: Building2,  color: "slate"   },
];

// ─── Slide-in Panel Shell ─────────────────────────────────────────────────────

function SlidePanel({ title, subtitle, onClose, children, width = "w-[420px]" }: {
  title: string; subtitle?: string; onClose: () => void;
  children: React.ReactNode; width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className={cn("relative bg-white shadow-2xl flex flex-col h-full overflow-hidden", width)}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </motion.div>
    </div>
  );
}

// ─── Panel: Auto Purchase Suggestions ────────────────────────────────────────

function AutoSuggestPanel({ onClose }: { onClose: () => void }) {
  const [items,    setItems]    = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [days,     setDays]     = useState(30);

  useEffect(() => {
    setLoading(true);
    api.get("/purchases/suggestions", { params: { daysThreshold: days } })
      .then(({ data }) => setItems(data.data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <SlidePanel title="Auto Purchase Suggestions" subtitle="Medicines running low based on sales trend" onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500">Show items that will run out in</span>
          <select value={days} onChange={(e) => setDays(+e.target.value)}
            className="border border-slate-200 rounded-md h-7 px-2 text-[12px] bg-white focus:outline-none">
            <option value={15}>15 days</option>
            <option value={30}>30 days</option>
            <option value={45}>45 days</option>
            <option value={60}>60 days</option>
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-300 mb-3" />
            <p className="text-[14px] font-semibold text-slate-700">All stocked up!</p>
            <p className="text-[12px] text-slate-400">No medicines are below the {days}-day threshold.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{items.length} items need reorder</p>
            {items.map((item, i) => (
              <div key={i} className={cn(
                "border rounded-xl p-3.5 transition-colors",
                item.daysOfStock < 7 ? "border-red-200 bg-red-50/40" :
                item.daysOfStock < 14 ? "border-amber-200 bg-amber-50/30" : "border-slate-200 bg-white"
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-slate-800 truncate">{item.medicineName}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[11px] text-slate-500">Stock: <span className="font-semibold text-slate-700">{item.currentStock}</span></span>
                      <span className="text-[11px] text-slate-500">Avg/day: <span className="font-semibold text-slate-700">{item.avgDailySales}</span></span>
                      <span className={cn("text-[11px] font-bold",
                        item.daysOfStock < 7 ? "text-red-600" : item.daysOfStock < 14 ? "text-amber-600" : "text-slate-600")}>
                        ~{item.daysOfStock} days left
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[11px] text-slate-400">Suggest order</p>
                    <p className="text-[15px] font-black text-blue-600">{item.suggestedQuantity}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SlidePanel>
  );
}

// ─── Panel: Overdue Bills ─────────────────────────────────────────────────────

function OverdueBillsPanel({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const [items,   setItems]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [payFor,  setPayFor]  = useState<any | null>(null);
  const [amount,  setAmount]  = useState("");
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    api.get("/purchases/grn", { params: { overdue: true, status: "CONFIRMED", limit: 50 } })
      .then(({ data }) => setItems(data.data.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  async function pay(grn: any) {
    if (!amount || isNaN(+amount) || +amount <= 0) return;
    setSaving(true);
    try {
      await api.post("/supplier-payments", {
        supplierId:  grn.supplier.id,
        grnId:       grn.id,
        amount:      +amount,
        paymentMode: "CASH",
      });
      setItems((p) => p.filter((i) => i.id !== grn.id));
      setPayFor(null); setAmount("");
    } catch {/* */} finally { setSaving(false); }
  }

  return (
    <SlidePanel title="Overdue Bills" subtitle="GRNs past their payment due date" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-300 mb-3" />
            <p className="text-[14px] font-semibold text-slate-700">No overdue payments</p>
            <p className="text-[12px] text-slate-400">All bills are within their credit period.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{items.length} overdue bill{items.length !== 1 ? "s" : ""}</p>
            {items.map((grn) => {
              const overdueDays = Math.abs(daysUntil(grn.paymentDueDate) ?? 0);
              return (
                <div key={grn.id} className="border border-red-200 bg-red-50/30 rounded-xl p-3.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-slate-800">{grn.supplier.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{grn.grnNumber} · {grn.supplierInvoiceNo ?? "No invoice no."}</p>
                      <p className="text-[11px] text-red-600 font-semibold mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />{overdueDays} days overdue · Due {fmtDate(grn.paymentDueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[15px] font-black text-slate-800">{currency(grn.totalAmount)}</p>
                    </div>
                  </div>
                  {payFor?.id === grn.id ? (
                    <div className="mt-3 flex items-center gap-2">
                      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                        placeholder="Amount ₹" className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-400" />
                      <button onClick={() => pay(grn)} disabled={saving}
                        className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Pay
                      </button>
                      <button onClick={() => setPayFor(null)} className="text-slate-400 hover:text-slate-600 p-1.5"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <button onClick={() => { setPayFor(grn); setAmount(String(grn.totalAmount.toFixed(2))); }}
                      className="mt-2.5 w-full flex items-center justify-center gap-1.5 border border-green-200 text-green-700 hover:bg-green-50 text-[12px] font-semibold rounded-lg py-1.5 transition-colors">
                      <Banknote className="w-3.5 h-3.5" />Record Payment
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </SlidePanel>
  );
}

// ─── Panel: Pending Approvals ─────────────────────────────────────────────────

function PendingApprovalsPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [items,    setItems]    = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/purchases/orders", { params: { approvalStatus: "PENDING_APPROVAL", limit: 50 } })
      .then(({ data }) => setItems(data.data.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(id: string, approved: boolean) {
    setActionId(id);
    try {
      await api.patch(`/purchases/orders/${id}/approve`, { approved });
      setItems((p) => p.filter((i) => i.id !== id));
      onDone();
    } catch {/* */} finally { setActionId(null); }
  }

  return (
    <SlidePanel title="Pending Approvals" subtitle="Purchase orders waiting for owner sign-off" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <ShieldCheck className="w-10 h-10 text-green-300 mb-3" />
            <p className="text-[14px] font-semibold text-slate-700">All caught up!</p>
            <p className="text-[12px] text-slate-400">No purchase orders are waiting for approval.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{items.length} PO{items.length !== 1 ? "s" : ""} waiting</p>
            {items.map((po) => (
              <div key={po.id} className="border border-orange-200 bg-orange-50/30 rounded-xl p-3.5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-[13px] font-bold text-blue-600">{po.orderNumber}</p>
                    <p className="text-[12px] font-semibold text-slate-700">{po.supplier.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{po._count.items} items · {fmtDate(po.orderedAt)}</p>
                  </div>
                  <p className="text-[15px] font-black text-slate-800">{currency(po.totalAmount)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => decide(po.id, true)} disabled={actionId === po.id}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-[12px] font-semibold py-1.5 rounded-lg disabled:opacity-60 transition-colors">
                    {actionId === po.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Approve
                  </button>
                  <button onClick={() => decide(po.id, false)} disabled={actionId === po.id}
                    className="flex-1 flex items-center justify-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 text-[12px] font-semibold py-1.5 rounded-lg disabled:opacity-60 transition-colors">
                    <X className="w-3 h-3" />Reject
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </SlidePanel>
  );
}

// ─── Panel: Record Quick Payment ──────────────────────────────────────────────

function QuickPaymentPanel({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const [supplierId,   setSupplierId]   = useState("");
  const [amount,       setAmount]       = useState("");
  const [paymentMode,  setPaymentMode]  = useState("CASH");
  const [reference,    setReference]    = useState("");
  const [saving,       setSaving]       = useState(false);
  const [success,      setSuccess]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || !amount) { setError("Select a supplier and enter amount"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/supplier-payments", {
        supplierId, amount: +amount, paymentMode,
        reference: reference || undefined,
      });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to record payment");
    } finally { setSaving(false); }
  }

  return (
    <SlidePanel title="Record Payment" subtitle="Log a payment made to a distributor" onClose={onClose}>
      <div className="px-5 py-4">
        {success ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <p className="text-[15px] font-bold text-slate-800">Payment Recorded!</p>
            <p className="text-[12px] text-slate-400 mt-1">Closing panel…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <FieldLabel>Distributor *</FieldLabel>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Amount (₹) *</FieldLabel>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" step="0.01" min={0}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            <div>
              <FieldLabel>Payment Mode</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {["CASH", "UPI", "CARD", "CREDIT", "WALLET", "CHEQUE"].map((mode) => (
                  <button key={mode} type="button" onClick={() => setPaymentMode(mode)}
                    className={cn("py-2 rounded-lg text-[12px] font-semibold border transition-colors",
                      paymentMode === mode ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>Reference / UTR No.</FieldLabel>
              <FInput value={reference} onChange={setReference} placeholder="Optional — cheque no., UTR, etc." />
            </div>
            {error && <ErrorBanner msg={error} />}
            <button type="submit" disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white text-[13px] font-semibold py-2.5 rounded-lg disabled:opacity-60 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
              Record Payment
            </button>
          </form>
        )}
      </div>
    </SlidePanel>
  );
}

// ─── Panel: Quick Credit Note ─────────────────────────────────────────────────

function QuickCreditNotePanel({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [amount,     setAmount]     = useState("");
  const [notes,      setNotes]      = useState("");
  const [saving,     setSaving]     = useState(false);
  const [success,    setSuccess]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || !amount) { setError("Select a supplier and enter amount"); return; }
    setSaving(true); setError(null);
    try {
      await api.post("/supplier-credit-notes", {
        supplierId, amount: +amount, notes: notes || undefined,
      });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Failed to create credit note");
    } finally { setSaving(false); }
  }

  return (
    <SlidePanel title="Raise Credit Note" subtitle="Track credit issued by a supplier" onClose={onClose}>
      <div className="px-5 py-4">
        {success ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-7 h-7 text-blue-600" />
            </div>
            <p className="text-[15px] font-bold text-slate-800">Credit Note Created!</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <FieldLabel>Distributor *</FieldLabel>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Credit Amount (₹) *</FieldLabel>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" step="0.01" min={0}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            <div>
              <FieldLabel>Notes</FieldLabel>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Reason for credit note…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
            {error && <ErrorBanner msg={error} />}
            <button type="submit" disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold py-2.5 rounded-lg disabled:opacity-60 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Create Credit Note
            </button>
          </form>
        )}
      </div>
    </SlidePanel>
  );
}

// ─── Quick Actions Dropdown ───────────────────────────────────────────────────

type PanelType =
  | "auto-suggest" | "overdue-bills" | "pending-approvals"
  | "quick-payment" | "credit-note" | null;

type QABtn = {
  icon:     React.ElementType;
  label:    string;
  sub:      string;
  action:   () => void;
  badge?:   number;
  divider?: boolean;
  danger?:  boolean;
};

function QuickActionsDropdown({ tab, onTabChange, onPanelOpen, pendingApprovals, overdueCount }: {
  tab:              Tab;
  onTabChange:      (t: Tab) => void;
  onPanelOpen:      (p: PanelType) => void;
  pendingApprovals: number;
  overdueCount:     number;
}) {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  const menus: Record<Tab, QABtn[]> = {
    purchase: [
      { icon: Banknote,       label: "Record Payment",    sub: "Log a payment to distributor",   action: () => onPanelOpen("quick-payment")   },
      { icon: FileText,       label: "Raise Credit Note", sub: "Track supplier-issued credit",    action: () => onPanelOpen("credit-note")     },
      { icon: AlertTriangle,  label: "Overdue Bills",     sub: "Bills past payment due date",     action: () => onPanelOpen("overdue-bills"),   badge: overdueCount,  danger: overdueCount > 0 },
      { icon: BarChart3,      label: "Purchase Analytics",sub: "Monthly spend & cost analysis",   action: () => {},                            divider: true },
    ],
    "gate-inward": [
      { icon: Lightbulb,      label: "Auto Suggest",      sub: "Reorder low-stock medicines",    action: () => onPanelOpen("auto-suggest")    },
      { icon: FileSpreadsheet,label: "Import CSV",        sub: "Bulk-add GRN items from Excel",  action: () => {}                             },
      { icon: ClipboardList,  label: "View POs",          sub: "Go to Purchase Orders tab",      action: () => onTabChange("po"),              divider: true },
      { icon: Banknote,       label: "Record Payment",    sub: "Log payment after GRN confirm",  action: () => onPanelOpen("quick-payment")   },
    ],
    po: [
      { icon: ShieldAlert,    label: "Pending Approvals", sub: "POs awaiting owner sign-off",    action: () => onPanelOpen("pending-approvals"), badge: pendingApprovals, danger: pendingApprovals > 0 },
      { icon: Lightbulb,      label: "Auto Suggest",      sub: "Reorder recommendations",        action: () => onPanelOpen("auto-suggest"),    divider: true },
      { icon: Truck,          label: "Go to Gate Inward", sub: "Receive goods against a PO",     action: () => onTabChange("gate-inward")     },
      { icon: Building2,      label: "Manage Distributors",sub:"Add or edit distributors",       action: () => onTabChange("distributors")    },
    ],
    returns: [
      { icon: FileText,       label: "Raise Credit Note", sub: "Track credit from this return",  action: () => onPanelOpen("credit-note")     },
      { icon: Banknote,       label: "Record Payment",    sub: "Settle outstanding balance",     action: () => onPanelOpen("quick-payment"),  divider: true },
      { icon: TrendingUp,     label: "View Purchases",    sub: "See all confirmed invoices",     action: () => onTabChange("purchase")       },
    ],
    distributors: [
      { icon: Zap,            label: "New Purchase Order",sub: "Place a PO with a distributor", action: () => onTabChange("po")              },
      { icon: Banknote,       label: "Record Payment",    sub: "Log a supplier payment",         action: () => onPanelOpen("quick-payment"),  divider: true },
      { icon: AlertTriangle,  label: "Overdue Bills",     sub: "Check outstanding dues",         action: () => onPanelOpen("overdue-bills"),  badge: overdueCount, danger: overdueCount > 0 },
      { icon: Download,       label: "Export List",       sub: "Download distributor CSV",       action: () => {}                            },
    ],
  };

  const items        = menus[tab] ?? [];
  const totalAlerts  = (pendingApprovals ?? 0) + (overdueCount ?? 0);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex items-center gap-1.5 border text-[13px] font-semibold h-8 px-3 rounded-lg transition-colors",
          open
            ? "bg-slate-100 border-slate-300 text-slate-700"
            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50",
        )}>
        <Zap className="w-3.5 h-3.5 text-amber-500" />
        Quick Actions
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform text-slate-400", open && "rotate-180")} />
        {totalAlerts > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
            {totalAlerts > 9 ? "9+" : totalAlerts}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1,    y: 0   }}
            exit={{    opacity: 0, scale: 0.95, y: -4  }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden py-1">
            {items.map((item, i) => (
              <div key={i}>
                {item.divider && <div className="my-1 border-t border-slate-100" />}
                <button
                  onClick={() => pick(item.action)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors",
                    item.danger && item.badge && item.badge > 0 ? "hover:bg-red-50" : "",
                  )}>
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
                    item.danger && item.badge && item.badge > 0 ? "bg-red-100" : "bg-slate-100",
                  )}>
                    <item.icon className={cn("w-3.5 h-3.5",
                      item.danger && item.badge && item.badge > 0 ? "text-red-600" : "text-slate-500")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[13px] font-semibold leading-tight",
                      item.danger && item.badge && item.badge > 0 ? "text-red-700" : "text-slate-800")}>
                      {item.label}
                    </p>
                    <p className="text-[11px] text-slate-400 leading-tight mt-0.5 truncate">{item.sub}</p>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={cn(
                      "ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                      item.danger ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700",
                    )}>
                      {item.badge}
                    </span>
                  )}
                  {!item.badge && <ArrowRight className="w-3 h-3 text-slate-300 ml-auto flex-shrink-0" />}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchasePage() {
  const [tab,              setTab]         = useState<Tab>("purchase");
  const [suppliers,        setSuppliers]   = useState<Supplier[]>([]);
  const [showCreate,       setShow]        = useState(false);
  const [activePanel,      setPanel]       = useState<PanelType>(null);
  const [pendingApprovals, setPending]     = useState(0);
  const [overdueCount,     setOverdue]     = useState(0);
  const prevTab                            = useRef<Tab>("purchase");

  // Always fetch the latest supplier list — called on mount, tab switch, and modal open.
  const refreshSuppliers = useCallback(() => {
    api.get("/suppliers/all")
      .then(({ data }) => setSuppliers(data.data ?? []))
      .catch(() => {});
  }, []);

  // Badge counts for Quick Actions
  const refreshBadges = useCallback(() => {
    Promise.all([
      api.get("/purchases/orders", { params: { approvalStatus: "PENDING_APPROVAL", limit: 1 } }),
      api.get("/purchases/grn",    { params: { overdue: true, status: "CONFIRMED",  limit: 1 } }),
    ]).then(([poRes, grnRes]) => {
      setPending(poRes.data.data.total  ?? 0);
      setOverdue(grnRes.data.data.total ?? 0);
    }).catch(() => {});
  }, []);

  // Initial load
  useEffect(() => {
    refreshSuppliers();
    refreshBadges();
  }, [refreshSuppliers, refreshBadges]);

  // Re-fetch suppliers whenever the user navigates away from the Distributors tab
  // (they may have just added or edited one).
  function handleTabChange(next: Tab) {
    if (prevTab.current === "distributors" && next !== "distributors") {
      refreshSuppliers();
    }
    prevTab.current = next;
    setTab(next);
  }

  // Re-fetch suppliers before opening any create modal so the dropdown is always fresh.
  function openCreateModal() {
    refreshSuppliers();
    setShow(true);
  }

  function handleSupplierAdded(s: FullSupplier) {
    // Optimistically add to list; refreshSuppliers will reconcile on next open.
    setSuppliers((p) => {
      if (p.some((x) => x.id === s.id)) return p; // already there
      return [...p, { id: s.id, name: s.name, phone: s.phone ?? undefined }];
    });
  }

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Page Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-bold text-slate-900">Purchase</h1>
          <span className="text-[11px] font-medium text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
            {activeTab.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <QuickActionsDropdown
            tab={tab}
            onTabChange={handleTabChange}
            onPanelOpen={setPanel}
            pendingApprovals={pendingApprovals}
            overdueCount={overdueCount}
          />
          <button onClick={openCreateModal}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold h-8 px-4 rounded-lg transition-colors shadow-sm">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />New
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <SummaryBar />

      {/* Tab Bar */}
      <div className="flex items-center border-b border-slate-200 bg-white flex-shrink-0 px-2 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => {
          const Icon     = t.icon;
          const isActive = tab === t.key;
          return (
            /* use handleTabChange so switching away from Distributors refreshes the list */
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={cn(
                "relative flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-all whitespace-nowrap flex-shrink-0",
                isActive ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50",
              )}>
              <Icon className="w-3.5 h-3.5" />{t.label}
              {/* Badge indicators */}
              {t.key === "po"      && pendingApprovals > 0 && (
                <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center">{pendingApprovals > 9 ? "9+" : pendingApprovals}</span>
              )}
              {t.key === "purchase" && overdueCount > 0 && (
                <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">{overdueCount > 9 ? "9+" : overdueCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {tab === "purchase"     && <PurchaseTab      suppliers={suppliers} />}
        {tab === "gate-inward"  && <GateInwardTab    suppliers={suppliers} />}
        {tab === "po"           && <POTab            suppliers={suppliers} />}
        {tab === "returns"      && <ReturnsTab       suppliers={suppliers} />}
        {tab === "distributors" && <DistributorsTab  onSupplierAdded={(s) => { handleSupplierAdded(s); refreshSuppliers(); }} />}
      </div>

      {/* Slide-in Panels */}
      <AnimatePresence>
        {activePanel === "auto-suggest"       && <AutoSuggestPanel       onClose={() => setPanel(null)} />}
        {activePanel === "overdue-bills"      && <OverdueBillsPanel      suppliers={suppliers} onClose={() => setPanel(null)} />}
        {activePanel === "pending-approvals"  && <PendingApprovalsPanel  onClose={() => setPanel(null)} onDone={() => { setPending((p) => Math.max(0, p - 1)); }} />}
        {activePanel === "quick-payment"      && <QuickPaymentPanel      suppliers={suppliers} onClose={() => setPanel(null)} />}
        {activePanel === "credit-note"        && <QuickCreditNotePanel   suppliers={suppliers} onClose={() => setPanel(null)} />}
      </AnimatePresence>

      {/* Global "+ New" modal */}
      <AnimatePresence>
        {showCreate && tab === "po"           && <CreatePOModal     suppliers={suppliers} onClose={() => setShow(false)} onDone={(newSupplier) => { if (newSupplier) handleSupplierAdded(newSupplier); setShow(false); }} />}
        {showCreate && tab === "gate-inward"  && <CreateGRNModal    suppliers={suppliers} onClose={() => setShow(false)} onDone={(newSupplier) => { if (newSupplier) handleSupplierAdded(newSupplier); setShow(false); }} />}
        {showCreate && tab === "purchase"     && <CreateGRNModal    suppliers={suppliers} onClose={() => setShow(false)} onDone={(newSupplier) => { if (newSupplier) handleSupplierAdded(newSupplier); setShow(false); }} />}
        {showCreate && tab === "returns"      && <CreateReturnModal suppliers={suppliers} onClose={() => setShow(false)} onDone={(newSupplier) => { if (newSupplier) handleSupplierAdded(newSupplier); setShow(false); }} />}
        {showCreate && tab === "distributors" && <SupplierFormModal supplier={null} onClose={() => setShow(false)} onSaved={(s) => { handleSupplierAdded(s); setShow(false); }} />}
      </AnimatePresence>
    </div>
  );
}
