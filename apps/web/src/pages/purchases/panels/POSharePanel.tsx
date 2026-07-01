import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Loader2, FileText, MessageCircle, CheckCircle2,
  Phone, Mail, Package, Calendar, AlertTriangle, Send,
  Building2, ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { openPOPrintWindow, openPOWhatsApp } from "../utils/poPrint";
import type { PrintPharmacy, PrintPO } from "../utils/poPrint";
import { currency, fmtDate } from "../utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type FullPOItem = {
  medicineName: string; batchNumber: string; expiryDate: string;
  quantity: number; purchaseRate: number; mrp: number; gstRate: number; amount: number;
};

type FullPO = {
  id: string; orderNumber: string; invoiceNo: string | null;
  status: string; approvalStatus: string;
  subtotal: number; totalGst: number; totalAmount: number;
  notes: string | null; orderedAt: string; expectedDate: string | null;
  supplier: { id: string; name: string; phone: string | null; email: string | null };
  items: FullPOItem[];
};

// ─── Component ────────────────────────────────────────────────────────────────

export function POSharePanel({
  poId,
  onClose,
  onSent,
}: {
  poId: string;
  onClose: () => void;
  onSent:  () => void;
}) {
  const toast = useToast();

  const [po,       setPO]       = useState<FullPO | null>(null);
  const [pharmacy, setPharmacy] = useState<PrintPharmacy | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [sending,  setSending]  = useState(false);
  const [done,     setDone]     = useState(false);

  useEffect(() => {
    setLoading(true); setError(null);
    Promise.all([
      api.get(`/purchases/orders/${poId}`),
      api.get("/pharmacy"),
    ])
      .then(([poRes, phRes]) => {
        setPO(poRes.data.data);
        setPharmacy(phRes.data.data);
      })
      .catch(() => setError("Could not load PO details. Please try again."))
      .finally(() => setLoading(false));
  }, [poId]);

  async function markPending(): Promise<boolean> {
    if (po?.status !== "DRAFT") return true; // already sent
    setSending(true);
    try {
      await api.patch(`/purchases/orders/${poId}/send`);
      setPO((p) => p ? { ...p, status: "PENDING" } : p);
      return true;
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? "Could not send PO. Please try again.");
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handlePDF() {
    if (!po || !pharmacy) return;
    const ok = await markPending();
    if (!ok) return;
    const printPO: PrintPO = {
      orderNumber: po.orderNumber, orderedAt: po.orderedAt, status: "PENDING",
      expectedDate: po.expectedDate, invoiceNo: po.invoiceNo, notes: po.notes,
      subtotal: po.subtotal, totalGst: po.totalGst, totalAmount: po.totalAmount,
      supplier: po.supplier,
      items: po.items,
    };
    openPOPrintWindow(printPO, pharmacy);
    setDone(true);
    onSent();
  }

  async function handleWhatsApp() {
    if (!po || !pharmacy) return;
    if (!po.supplier.phone) {
      toast.error("No phone number on file for this supplier. Add it from Distributors.");
      return;
    }
    const ok = await markPending();
    if (!ok) return;
    const printPO: PrintPO = {
      orderNumber: po.orderNumber, orderedAt: po.orderedAt,
      expectedDate: po.expectedDate, invoiceNo: po.invoiceNo, notes: po.notes,
      subtotal: po.subtotal, totalGst: po.totalGst, totalAmount: po.totalAmount,
      supplier: po.supplier,
      items: po.items,
    };
    openPOWhatsApp(printPO, pharmacy);
    setDone(true);
    onSent();
  }

  async function handleMarkSent() {
    const ok = await markPending();
    if (!ok) return;
    setDone(true);
    onSent();
    toast.success("PO marked as sent.");
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="relative w-full sm:w-[440px] bg-white shadow-2xl flex flex-col h-full overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #0a1a52 0%, #162870 100%)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
              <Send className="w-4 h-4 text-white" strokeWidth={1.8} />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-white leading-none">Send to Supplier</h3>
              <p className="text-[11px] text-white/50 mt-1 leading-none">Download PDF or share via WhatsApp</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-3.5 h-3.5 text-white/70" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-64 gap-3"
              >
                <Loader2 className="w-7 h-7 animate-spin text-blue-400" />
                <p className="text-[13px] text-slate-400">Loading PO details…</p>
              </motion.div>
            ) : error ? (
              <motion.div
                key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-64 gap-3 px-6 text-center"
              >
                <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <p className="text-[14px] font-semibold text-slate-700">Something went wrong</p>
                <p className="text-[12px] text-slate-400">{error}</p>
              </motion.div>
            ) : done ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-64 gap-3 px-6 text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                </div>
                <p className="text-[15px] font-bold text-slate-800">PO Sent!</p>
                <p className="text-[12px] text-slate-400">Status updated to <span className="font-semibold text-amber-600">Pending</span>.</p>
                <button onClick={onClose} className="mt-2 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
                  Close
                </button>
              </motion.div>
            ) : po ? (
              <motion.div
                key="content"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="p-5 space-y-4"
              >
                {/* PO Summary Card */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-blue-600">{po.orderNumber}</span>
                      <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5">
                        Draft
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Items</p>
                      <div className="flex items-center gap-1.5">
                        <Package className="w-3 h-3 text-slate-400" />
                        <span className="text-[13px] font-bold text-slate-800">{po.items.length}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Total</p>
                      <span className="text-[13px] font-bold text-slate-800">{po.totalAmount > 0 ? currency(po.totalAmount) : <span className="text-slate-300 font-normal">—</span>}</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Expected</p>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        <span className="text-[12px] text-slate-600">{fmtDate(po.expectedDate)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Supplier Card */}
                <div className="rounded-xl border border-slate-200 px-4 py-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Sending To</p>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-purple-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-slate-800 leading-snug">{po.supplier.name}</p>
                      {po.supplier.phone && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span className="text-[11px] text-slate-500">{po.supplier.phone}</span>
                        </div>
                      )}
                      {po.supplier.email && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Mail className="w-3 h-3 text-slate-400" />
                          <span className="text-[11px] text-slate-500 truncate">{po.supplier.email}</span>
                        </div>
                      )}
                      {!po.supplier.phone && !po.supplier.email && (
                        <p className="text-[11px] text-slate-400 mt-1">No contact info on file</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Cards */}
                <div className="space-y-2.5">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">How do you want to share?</p>

                  {/* PDF Button */}
                  <button
                    onClick={handlePDF}
                    disabled={sending}
                    className={cn(
                      "w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all duration-150",
                      "border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-300 active:scale-[0.98]",
                      "disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100",
                    )}
                  >
                    <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-blue-200">
                      {sending ? (
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      ) : (
                        <FileText className="w-5 h-5 text-white" strokeWidth={1.8} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold text-blue-800 leading-snug">Download PDF</p>
                      <p className="text-[11.5px] text-blue-500 mt-0.5">Opens a print-ready document — save as PDF and email it yourself</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  </button>

                  {/* WhatsApp Button */}
                  <button
                    onClick={handleWhatsApp}
                    disabled={sending || !po.supplier.phone}
                    className={cn(
                      "w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all duration-150",
                      po.supplier.phone
                        ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 active:scale-[0.98]"
                        : "border-slate-100 bg-slate-50 cursor-not-allowed",
                      "disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100",
                    )}
                  >
                    <div className={cn(
                      "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm",
                      po.supplier.phone ? "bg-[#25D366] shadow-emerald-200" : "bg-slate-200",
                    )}>
                      <MessageCircle className="w-5 h-5 text-white" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-[14px] font-bold leading-snug", po.supplier.phone ? "text-emerald-800" : "text-slate-400")}>
                        Share on WhatsApp
                      </p>
                      <p className={cn("text-[11.5px] mt-0.5", po.supplier.phone ? "text-emerald-600" : "text-slate-400")}>
                        {po.supplier.phone
                          ? `Opens WhatsApp for ${po.supplier.phone}`
                          : "No phone number on file for this supplier"}
                      </p>
                    </div>
                    {po.supplier.phone && <ChevronRight className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
                  </button>
                </div>

                {/* Divider + Mark as sent */}
                <div className="flex items-center gap-3 pt-1">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[11px] text-slate-400">or</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>

                <button
                  onClick={handleMarkSent}
                  disabled={sending}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[12.5px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-200 transition-colors disabled:opacity-60"
                >
                  {sending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle2 className="w-3.5 h-3.5" />
                  }
                  Mark as Sent (skip sharing)
                </button>

                {/* Info note */}
                <p className="text-center text-[11px] text-slate-400 leading-relaxed px-2">
                  Clicking any option above will mark this PO as <span className="font-semibold">Sent</span> and lock it from further edits.
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
