

import { useState, useEffect, Suspense, lazy } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, Printer, XCircle, Loader2, AlertCircle, Scissors,
  User, Phone, Stethoscope, CreditCard, Calendar, RefreshCcw, MapPin,
} from "lucide-react";
import { baseUnitShort } from "@pharmacy/utils";
import { api } from "@/lib/api-client";
import { ListSkeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { useInvoicePrintConfig } from "@/lib/useInvoicePrintConfig";
import { invoiceRendererFor } from "@/lib/invoiceRenderer";
import type { PrintInvoiceData } from "@/components/billing/InvoicePrintView";
import { LooseLabelModal } from "@/components/LooseLabelModal";

const InvoicePrintView  = lazy(() => import("@/components/billing/InvoicePrintView").then(m => ({ default: m.InvoicePrintView })));
const ThermalReceiptView = lazy(() => import("@/components/billing/ThermalReceiptView").then(m => ({ default: m.ThermalReceiptView })));
const TaxWholesaleInvoiceView = lazy(() => import("@/components/billing/TaxWholesaleInvoiceView").then(m => ({ default: m.TaxWholesaleInvoiceView })));
const A5LandscapeInvoiceView = lazy(() => import("@/components/billing/A5LandscapeInvoiceView").then(m => ({ default: m.A5LandscapeInvoiceView })));

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceItem = {
  id: string;
  medicineName: string;
  hsnCode: string | null;
  batchNumber: string;
  expiryDate: string;
  location: string | null;
  quantity: number;
  /** Scheme quantity given free — not charged, but dispensed. */
  freeQty?: number;
  /** "LOOSE" — quantity is individual pieces cut from a strip; mrp/rate are per-piece. */
  saleUnit?: string;
  baseUnit?: string | null;
  /** false — a pharmacist hand-picked this batch instead of the dispensing engine's choice. */
  batchAutoSelected?: boolean;
  mrp: number;
  rate: number;
  discount: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxableAmount: number;
  amount: number;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  paymentMode: string;
  paymentStatus: string;
  isInterstate: boolean;
  /** Batch-selection strategy in force when this bill was made — "LILA_FEFO" | "LIFA" | null (pre-dates the setting). */
  dispensingStrategy?: string | null;
  prescriptionId: string | null;
  prescription: { id: string; prescriptionNumber: string; doctorName: string; patientName: string; status: string } | null;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  totalAmount: number;
  extraCharges: number;
  adjustmentAmount: number;
  roundOff: number;
  /**
   * Money actually received against this bill, newest last — the tenders taken when it
   * was raised, then anything collected since. A bill settled a single way still has one
   * row here; bills predating split tender have none.
   */
  payments?: { id: string; amount: number; paymentMode: string; reference: string | null; paidAt: string }[];
  /** Received against this bill, and what is still owed on it. */
  amountPaid: number;
  balanceDue: number;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  doctorName: string | null;
  doctorRegNo: string | null;
  notes: string | null;
  customer: { name: string; phone: string | null; email: string | null } | null;
  // Set only when the bill has no linked Customer record — a patient name/phone captured
  // free-text (an EMR-sourced prescription, or a walk-in typed by hand). `customer` above
  // wins when both exist; this is the fallback, not a duplicate to ignore.
  customerName: string | null;
  customerPhone: string | null;
  user: { name: string };
  items: InvoiceItem[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; cls: string }> = {
  PAID:      { label: "Paid",      cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  PENDING:   { label: "Pending",   cls: "bg-amber-50   text-amber-700   border-amber-200"   },
  PARTIAL:   { label: "Partial",   cls: "bg-orange-50  text-orange-700  border-orange-200"  },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50     text-red-600     border-red-200"     },
};

function StatusBadge({ isCancelled, status }: { isCancelled: boolean; status: string }) {
  const key = isCancelled ? "CANCELLED" : status;
  const { label, cls } = STATUS[key] ?? { label: status, cls: "bg-slate-50 text-slate-600 border-slate-200" };
  return (
    <span className={cn("text-[12px] font-semibold border rounded-full px-2.5 py-0.5", cls)}>
      {label}
    </span>
  );
}

// ─── Bill detail page ─────────────────────────────────────────────────────────

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [labelModalOpen, setLabelModalOpen] = useState(false);

  const { config: printConfig, pharmacy: printPharmacy } = useInvoicePrintConfig();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/billing/${id}`)
      .then(({ data }) => setInvoice(data.data))
      .catch(() => setError("Invoice not found or you don't have access."))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleCancel() {
    if (!id || !cancelReason.trim()) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const { data } = await api.patch(`/billing/${id}/cancel`, { reason: cancelReason });
      setInvoice(data.data);
      setCancelOpen(false);
      setCancelReason("");
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCancelError(msg ?? "Failed to cancel. Try again.");
    } finally {
      setCancelling(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────
  if (loading) {
    return <ListSkeleton rows={8} />;
  }

  // ── Error ──────────────────────────────────────────────────
  if (error || !invoice) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-white gap-3">
        <AlertCircle className="w-10 h-10 text-red-300" />
        <p className="text-slate-600 text-[14px] font-medium">{error ?? "Invoice not found"}</p>
        <Link to="/dashboard/billing" className="text-blue-600 text-[13px] hover:underline flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Sales
        </Link>
      </div>
    );
  }

  // Cut-strip lines on this bill — each needs its own small adhesive label for the pouch
  // it goes out in, separate from the full invoice print. Absent for the common bill with
  // no loose lines at all, so the button below only ever appears when there is something to print.
  const looseItems = invoice.items.filter((i) => i.saleUnit === "LOOSE");

  // ─── Map invoice to PrintInvoiceData for the print view ──────
  const rendererKind = invoiceRendererFor(printConfig);
  const printData: PrintInvoiceData = invoice ? {
    invoiceNumber:   invoice.invoiceNumber,
    createdAt:       invoice.createdAt,
    customerName:    invoice.customer?.name    || invoice.customerName  || undefined,
    customerPhone:   invoice.customer?.phone   || invoice.customerPhone || undefined,
    prescriptionNo:  invoice.prescription?.prescriptionNumber || undefined,
    doctorName:      invoice.doctorName        || undefined,
    doctorRegNo:     invoice.doctorRegNo       || undefined,
    cashierName:     invoice.user.name         || undefined,
    paymentMode:     invoice.paymentMode,
    paymentStatus:   invoice.paymentStatus,
    // A reprint has to say the same thing the original did. Only a genuine split is
    // passed through — one leg is an ordinary bill, and listing it would turn "Cash"
    // into "Cash ₹450.00" on every receipt.
    tenders:         (invoice.payments?.length ?? 0) > 1
      ? invoice.payments!.map((p) => ({ mode: p.paymentMode, amount: p.amount }))
      : undefined,
    isInterstate:    invoice.isInterstate,
    placeOfSupply:   printPharmacy?.state || undefined,
    items: invoice.items.map(i => ({
      medicineName:  i.medicineName,
      hsnCode:       i.hsnCode,
      batchNumber:   i.batchNumber,
      expiryDate:    i.expiryDate,
      mrp:           i.mrp,
      quantity:      i.quantity,
      freeQty:       i.freeQty,
      saleUnit:      i.saleUnit,
      baseUnit:      i.baseUnit,
      discount:      i.discount,
      gstRate:       i.gstRate,
      rate:          i.rate,
      taxableAmount: i.taxableAmount,
      cgst:          i.cgst,
      sgst:          i.sgst,
      igst:          i.igst,
      amount:        i.amount,
    })),
    subtotal:       invoice.subtotal,
    discountAmount: invoice.discountAmount,
    taxableAmount:  invoice.taxableAmount,
    cgst:           invoice.cgst,
    sgst:           invoice.sgst,
    igst:           invoice.igst,
    totalGst:       invoice.totalGst,
    totalAmount:    invoice.totalAmount,
    extraCharges:     invoice.extraCharges,
    adjustmentAmount: invoice.adjustmentAmount,
    roundOff:         invoice.roundOff,
  } : {} as PrintInvoiceData;

  // ─────────────────────────────────────────────────────────────
  return (
    <>
    {/* ── Print-only view — hidden on screen, shown when window.print() fires ── */}
    {invoice && (
      <div className="hidden print:block">
        <Suspense fallback={null}>
          {rendererKind === "thermal"
            ? <ThermalReceiptView invoice={printData} config={printConfig} pharmacy={printPharmacy} />
            : rendererKind === "a5landscape"
            ? <A5LandscapeInvoiceView invoice={printData} config={printConfig} pharmacy={printPharmacy} />
            : rendererKind === "wholesale"
            ? <TaxWholesaleInvoiceView invoice={printData} config={printConfig} pharmacy={printPharmacy} />
            : <InvoicePrintView  invoice={printData} config={printConfig} pharmacy={printPharmacy} />
          }
        </Suspense>
      </div>
    )}

    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col h-full bg-[#f7f9fc] overflow-auto print:hidden"
    >
      {/* ── Sub-nav ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 h-[52px] bg-white border-b border-slate-200 flex-shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Link
            to="/dashboard/billing"
            className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Sales
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-[13px] font-semibold text-slate-700">{invoice.invoiceNumber}</span>
          <StatusBadge isCancelled={invoice.isCancelled} status={invoice.paymentStatus} />
        </div>

        <div className="flex items-center gap-2">
          {!invoice.isCancelled && (
            <>
              <Link
                to={`/dashboard/billing/${invoice.id}/return`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-rose-600 hover:bg-rose-50 border border-rose-200 text-[12px] font-medium rounded-lg transition-colors"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
                Process Return
              </Link>
              <button
                onClick={() => setCancelOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-red-600 hover:bg-red-50 border border-red-200 text-[12px] font-medium rounded-lg transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel Invoice
              </button>
            </>
          )}
          {looseItems.length > 0 && (
            <button
              onClick={() => setLabelModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-amber-700 hover:bg-amber-50 border border-amber-200 text-[12px] font-medium rounded-lg transition-colors"
            >
              <Scissors className="w-3.5 h-3.5" />
              Print Label{looseItems.length !== 1 ? "s" : ""}
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold rounded-lg transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>
      </div>

      {labelModalOpen && (
        <LooseLabelModal
          items={looseItems.map((i) => ({
            medicineName: i.medicineName,
            quantity: i.quantity,
            baseUnit: i.baseUnit,
            batchNumber: i.batchNumber,
            expiryDate: i.expiryDate,
          }))}
          pharmacy={printPharmacy && { name: printPharmacy.name, drugLicense: printPharmacy.drugLicense, phone: printPharmacy.phone }}
          onClose={() => setLabelModalOpen(false)}
        />
      )}

      {/* ── Cancel confirmation bar ───────────────────────────── */}
      {cancelOpen && (
        <div className="bg-red-50 border-b border-red-100 px-5 py-3 flex items-center gap-3 flex-shrink-0">
          <p className="text-[13px] text-red-700 font-medium whitespace-nowrap">Reason for cancellation:</p>
          <input
            type="text"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCancel(); if (e.key === "Escape") { setCancelOpen(false); setCancelReason(""); } }}
            placeholder="Enter reason..."
            className="flex-1 border border-red-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-red-200 max-w-xs"
            autoFocus
          />
          {cancelError && <p className="text-red-600 text-[12px]">{cancelError}</p>}
          <button
            onClick={handleCancel}
            disabled={!cancelReason.trim() || cancelling}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-[12px] font-semibold rounded-lg transition-colors"
          >
            {cancelling && <Loader2 className="w-3 h-3 animate-spin" />}
            Confirm Cancel
          </button>
          <button
            onClick={() => { setCancelOpen(false); setCancelReason(""); setCancelError(null); }}
            className="text-[12px] text-slate-500 hover:text-slate-700 px-2 py-1.5 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Cancelled notice ─────────────────────────────────── */}
      {invoice.isCancelled && (
        <div className="bg-red-50 border-b border-red-100 px-5 py-2.5 flex items-center gap-2 text-[13px] text-red-700">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            This invoice was cancelled on{" "}
            <span className="font-semibold">{fmtDate(invoice.cancelledAt!)}</span>.
          </span>
          {invoice.cancelReason && (
            <span className="text-red-500 italic ml-1">Reason: {invoice.cancelReason}</span>
          )}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="flex-1 p-5 max-w-5xl mx-auto w-full">

        {/* Info cards row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Date</span>
            </div>
            <p className="text-[13px] font-semibold text-slate-800">
              {new Date(invoice.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Payment</span>
            </div>
            {/* A bill settled more than one way has no single true "mode", so the legs
                are listed instead of a label that would name only the largest of them. */}
            {(invoice.payments?.length ?? 0) > 1 ? (
              <>
                <p className="text-[13px] font-semibold text-slate-800 capitalize mb-1">
                  Split · {invoice.paymentStatus.toLowerCase()}
                </p>
                <div className="space-y-0.5">
                  {invoice.payments!.map((p) => (
                    <p key={p.id} className="text-[12px] text-slate-600 flex items-baseline gap-1.5">
                      <span className="capitalize font-medium">{p.paymentMode.toLowerCase()}</span>
                      <span className="tabular-nums">₹{p.amount.toFixed(2)}</span>
                      {p.reference && <span className="text-slate-400 truncate">{p.reference}</span>}
                    </p>
                  ))}
                  {invoice.balanceDue > 0 && (
                    <p className="text-[12px] font-semibold text-amber-700">
                      On account ₹{invoice.balanceDue.toFixed(2)}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[13px] font-semibold text-slate-800 capitalize">
                {invoice.paymentMode.toLowerCase()} · {invoice.paymentStatus.toLowerCase()}
              </p>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Patient</span>
            </div>
            <p className="text-[13px] font-semibold text-slate-800 truncate">
              {invoice.customer?.name ?? invoice.customerName ?? <span className="text-slate-400 font-normal">Walk-in customer</span>}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Mobile</span>
            </div>
            <p className="text-[13px] font-semibold text-slate-800">
              {invoice.customer?.phone ?? invoice.customerPhone ?? <span className="text-slate-400 font-normal">—</span>}
            </p>
          </div>
        </div>

        {/* Doctor / Notes row */}
        {(invoice.doctorName || invoice.notes) && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            {invoice.doctorName && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Stethoscope className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Doctor</span>
                </div>
                <p className="text-[13px] font-semibold text-slate-800">{invoice.doctorName}</p>
                {invoice.doctorRegNo && (
                  <p className="text-[11px] text-slate-500 mt-0.5">Reg: {invoice.doctorRegNo}</p>
                )}
              </div>
            )}
            {invoice.notes && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Notes</p>
                <p className="text-[13px] text-slate-700">{invoice.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Items table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-bold text-slate-700">
              Line Items <span className="text-slate-400 font-normal ml-1">({invoice.items.length})</span>
            </h2>
            {invoice.dispensingStrategy && (
              <span
                title="The batch-selection strategy this bill was made under. Later changes to the pharmacy setting do not affect it."
                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-wide"
              >
                Batches: {invoice.dispensingStrategy === "LIFA" ? "LIFA (newest first)" : "LILA / FEFO"}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Medicine</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Batch</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Expiry</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Qty</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600">MRP</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Disc %</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600">GST %</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {invoice.items.map((item, i) => {
                  const isLoose = item.saleUnit === "LOOSE";
                  const unit    = baseUnitShort(item.baseUnit);
                  return (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {item.medicineName}
                      {isLoose && <span className="ml-1.5 text-[10px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700">LOOSE</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-slate-600 font-mono text-[11px]">
                        {item.batchNumber}
                        {item.batchAutoSelected === false && (
                          <span
                            title="A pharmacist hand-picked this batch instead of the dispensing engine's choice"
                            className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded bg-slate-100 text-slate-500 uppercase tracking-wide"
                          >
                            Manual
                          </span>
                        )}
                      </p>
                      {item.location && (
                        <div className="flex items-center gap-0.5 mt-0.5">
                          <MapPin className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />
                          <p className="text-[10px] text-blue-500 font-semibold">{item.location}</p>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {new Date(item.expiryDate).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">
                      {item.quantity}{isLoose && item.baseUnit ? ` ${unit}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                      {fmt(item.mrp)}
                      {isLoose && (
                        <span className="block text-[10px] text-amber-600 font-semibold">{fmt(item.rate)}/{unit}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{item.discount > 0 ? `${item.discount}%` : "—"}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{item.gstRate}%</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums">{fmt(item.amount)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals breakdown */}
        <div className="flex justify-end">
          <div className="bg-white border border-slate-200 rounded-xl p-5 w-full max-w-xs space-y-2 text-[13px]">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmt(invoice.subtotal)}</span>
            </div>
            {invoice.discountAmount > 0 && (
              <div className="flex justify-between text-orange-600">
                <span>Discount</span>
                <span className="tabular-nums">− {fmt(invoice.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <span>Taxable Amount</span>
              <span className="tabular-nums">{fmt(invoice.taxableAmount)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>CGST</span>
              <span className="tabular-nums">{fmt(invoice.cgst)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>SGST</span>
              <span className="tabular-nums">{fmt(invoice.sgst)}</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-slate-900 text-[15px]">
              <span>Total</span>
              <span className="tabular-nums">{fmt(Math.round(invoice.totalAmount))}</span>
            </div>
          </div>
        </div>

      </div>
    </motion.div>
    </>
  );
}
