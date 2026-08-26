import { useEffect, useState } from "react";
import { Eye, Loader2, AlertTriangle, Phone, FileText, Paperclip } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ModalShell, ErrorBanner } from "./shared";
import { fmtDate, currency, isOverdue, daysUntil, viewSourceUpload } from "../utils";

type GRNDetailItem = {
  id: string;
  medicineName: string;
  batchNumber: string;
  expiryDate: string;
  receivedQty: number;
  freeQty: number;
  purchaseRate: number;
  mrp: number;
  discount: number;
  gstRate: number;
  amount: number;
};

type GRNDetail = {
  id: string;
  grnNumber: string;
  supplierInvoiceNo: string | null;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  subtotal: number;
  totalGst: number;
  totalAmount: number;
  createdAt: string;
  confirmedAt: string | null;
  paymentDueDate: string | null;
  sourceUploadId: string | null;
  supplier: { id: string; name: string; phone: string | null };
  purchaseOrder: { id: string; orderNumber: string } | null;
  items: GRNDetailItem[];
  createdBy: { id: string; name: string } | null;
  confirmedBy: { id: string; name: string } | null;
};

const STATUS_BADGE: Record<GRNDetail["status"], string> = {
  DRAFT:     "bg-slate-100 text-slate-600",
  CONFIRMED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-red-100 text-red-600",
};

export function GRNViewModal({ grnId, onClose }: { grnId: string; onClose: () => void }) {
  const [grn,     setGrn]     = useState<GRNDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<{ data: GRNDetail }>(`/purchases/grn/${grnId}`)
      .then(({ data }) => { if (!cancelled) setGrn(data.data); })
      .catch(() => { if (!cancelled) setError("Failed to load GRN details. Please try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [grnId]);

  const overdue  = isOverdue(grn?.paymentDueDate);
  const daysLeft = daysUntil(grn?.paymentDueDate);

  return (
    <ModalShell
      icon={<Eye className="w-4 h-4 text-white" />}
      iconBg="bg-blue-600"
      title={grn ? grn.grnNumber : "GRN Details"}
      desc={grn ? `${grn.supplier.name} · Goods Receipt Note` : "Loading…"}
      onClose={onClose}
    >
      <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 text-blue-400 animate-spin" />
          </div>
        )}

        {!loading && error && <ErrorBanner msg={error} />}

        {!loading && grn && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-50 rounded-xl px-3.5 py-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Status</p>
                <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", STATUS_BADGE[grn.status])}>
                  {grn.status}
                </span>
              </div>
              <div className="bg-slate-50 rounded-xl px-3.5 py-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Distributor</p>
                <p className="text-[13px] font-bold text-slate-800 truncate">{grn.supplier.name}</p>
                {grn.supplier.phone && (
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" />{grn.supplier.phone}
                  </p>
                )}
              </div>
              <div className="bg-slate-50 rounded-xl px-3.5 py-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Invoice No.</p>
                <p className="text-[13px] font-bold text-slate-800">{grn.supplierInvoiceNo ?? "—"}</p>
                {grn.purchaseOrder && (
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                    <FileText className="w-3 h-3" />{grn.purchaseOrder.orderNumber}
                  </p>
                )}
              </div>
              <div className={cn("rounded-xl px-3.5 py-3", overdue ? "bg-red-50" : "bg-slate-50")}>
                <p className={cn("text-[10px] font-bold uppercase tracking-wide mb-1", overdue ? "text-red-500" : "text-slate-400")}>
                  Payment Due
                </p>
                {grn.paymentDueDate ? (
                  <p className={cn("text-[13px] font-bold flex items-center gap-1", overdue ? "text-red-600" : "text-slate-800")}>
                    {overdue && <AlertTriangle className="w-3.5 h-3.5" />}
                    {fmtDate(grn.paymentDueDate)}
                    {daysLeft !== null && <span className="text-[11px] font-normal text-slate-400">({daysLeft}d)</span>}
                  </p>
                ) : (
                  <p className="text-[13px] font-bold text-slate-800">—</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 text-[12px] text-slate-500">
              <span>
                Entry: <strong className="text-slate-700">{fmtDate(grn.createdAt)}</strong>
                {grn.createdBy && <> by <strong className="text-slate-700">{grn.createdBy.name}</strong></>}
              </span>
              {grn.confirmedAt && (
                <span>
                  Confirmed: <strong className="text-slate-700">{fmtDate(grn.confirmedAt)}</strong>
                  {grn.confirmedBy && <> by <strong className="text-slate-700">{grn.confirmedBy.name}</strong></>}
                </span>
              )}
              {grn.sourceUploadId && (
                <button type="button" onClick={() => viewSourceUpload(grn.sourceUploadId!)}
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium">
                  <Paperclip className="w-3 h-3" />View original PDF
                </button>
              )}
            </div>

            {/* Line items */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Medicine", "Batch", "Expiry", "Recd. Qty", "Free", "Rate ₹", "MRP ₹", "Disc %", "GST %", "Amount ₹"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grn.items.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/20">
                      <td className="px-3 py-2.5 font-semibold text-slate-800 max-w-[200px] truncate">{item.medicineName}</td>
                      <td className="px-3 py-2.5 text-slate-500 font-mono text-[11px]">{item.batchNumber}</td>
                      <td className="px-3 py-2.5 text-slate-500">{fmtDate(item.expiryDate)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-700">{item.receivedQty}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-400">{item.freeQty || "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-600">{item.purchaseRate.toFixed(2)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-600">{item.mrp.toFixed(2)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-500">{item.discount || "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-500">{item.gstRate}%</td>
                      <td className="px-3 py-2.5 tabular-nums font-bold text-slate-800">{item.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-full max-w-xs space-y-1.5 bg-slate-50 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between text-[12px] text-slate-500">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{currency(grn.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] text-slate-500">
                  <span>GST</span>
                  <span className="tabular-nums">{currency(grn.totalGst)}</span>
                </div>
                <div className="flex items-center justify-between text-[14px] font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>Total</span>
                  <span className="tabular-nums">{currency(grn.totalAmount)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
