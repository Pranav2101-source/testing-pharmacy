

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookmarkCheck,
  Trash2,
  Play,
  FileText,
  Clock,
  Package,
  IndianRupee,
  X,
  AlertCircle,
} from "lucide-react";
import { listDrafts, deleteDraft, clearAllDrafts } from "@/lib/draftStorage";
import { useBillingStore } from "@/components/billing/useBillingStore";
import type { DraftBill } from "@/lib/draftStorage";
import { cn } from "@/lib/utils";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function draftTotal(draft: DraftBill) {
  return draft.items.reduce((s, i) => s + i.amount, 0);
}

export default function DraftBillsPage() {
  const [drafts, setDrafts]     = useState<DraftBill[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const navigate                = useNavigate();
  const { loadDraft }           = useBillingStore();

  useEffect(() => {
    setDrafts(listDrafts());
  }, []);

  function handleResume(draft: DraftBill) {
    loadDraft(draft.items, draft.meta);
    navigate(`/dashboard/billing/new?draft=${draft.id}`);
  }

  function handleDelete(id: string) {
    deleteDraft(id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setDeleting(null);
  }

  function handleClearAll() {
    clearAllDrafts();
    setDrafts([]);
    setClearing(false);
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="flex items-center gap-3">
          <h1 className="text-[18px] font-bold text-slate-900 leading-none">Draft Bills</h1>
          <span className="text-[12px] text-slate-400 font-medium">{drafts.length} draft{drafts.length !== 1 ? "s" : ""}</span>
        </div>
        {drafts.length > 0 && (
          <button
            onClick={() => setClearing(true)}
            className="flex items-center gap-1.5 text-[12px] text-red-400 hover:text-red-600 border border-red-100 hover:border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear All
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 pb-20">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
              <BookmarkCheck className="w-8 h-8 text-amber-300" strokeWidth={1.4} />
            </div>
            <p className="text-[15px] font-semibold text-slate-500">No draft bills</p>
            <p className="text-[13px] text-slate-400 mt-1 text-center max-w-[260px]">
              In the New Bill screen, click the arrow next to Save and choose &quot;Save as Draft&quot; to hold a bill for later.
            </p>
            <button
              onClick={() => navigate("/dashboard/billing/new")}
              className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              New Bill
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-5 py-4 space-y-2">
            <AnimatePresence initial={false}>
              {drafts.map((draft) => {
                const total    = draftTotal(draft);
                const itemQty  = draft.items.reduce((s, i) => s + i.quantity, 0);

                return (
                  <motion.div
                    key={draft.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 60, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.18 }}
                    className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-slate-300 transition-all overflow-hidden"
                  >
                    <div className="flex items-center gap-4 px-5 py-4">

                      {/* Icon */}
                      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                        <BookmarkCheck className="w-5 h-5 text-amber-500" strokeWidth={1.8} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-slate-800 truncate">{draft.label}</p>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Clock className="w-3 h-3" />
                            {timeAgo(draft.savedAt)} · {fmtDate(draft.savedAt)}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Package className="w-3 h-3" />
                            {draft.items.length} medicine{draft.items.length !== 1 ? "s" : ""} · {itemQty} units
                          </span>
                          {draft.meta.customerName && (
                            <span className="text-[11px] text-blue-500 font-medium">
                              {draft.meta.customerName}
                              {draft.meta.customerPhone ? ` · ${draft.meta.customerPhone}` : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Total */}
                      <div className="text-right flex-shrink-0">
                        <div className="flex items-center gap-0.5 text-[16px] font-black text-slate-800">
                          <IndianRupee className="w-3.5 h-3.5 text-slate-500" strokeWidth={2.5} />
                          {total.toFixed(2)}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">
                          {draft.meta.paymentMode}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <button
                          onClick={() => handleResume(draft)}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.97] text-white text-[13px] font-bold transition-all duration-75"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Resume
                        </button>
                        <button
                          onClick={() => setDeleting(draft.id)}
                          className="w-8 h-8 rounded-xl border border-slate-200 hover:border-red-200 hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
                          title="Delete draft"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Item preview */}
                    {draft.items.length > 0 && (
                      <div className="px-5 pb-3 flex flex-wrap gap-1.5">
                        {draft.items.slice(0, 5).map((item) => (
                          <span
                            key={item.inventoryId}
                            className="inline-flex items-center gap-1 text-[11px] bg-slate-50 border border-slate-100 text-slate-600 px-2 py-0.5 rounded-full"
                          >
                            <FileText className="w-3 h-3 text-slate-400" />
                            {item.medicineName}
                            <span className="text-slate-400">×{item.quantity}</span>
                          </span>
                        ))}
                        {draft.items.length > 5 && (
                          <span className="text-[11px] text-slate-400 px-2 py-0.5">
                            +{draft.items.length - 5} more
                          </span>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Delete single confirm */}
      <AnimatePresence>
        {deleting && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setDeleting(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" strokeWidth={1.6} />
              </div>
              <h3 className="text-[15px] font-bold text-slate-800 mb-1">Delete Draft?</h3>
              <p className="text-[13px] text-slate-500 mb-5">This draft will be permanently removed.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleting(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleting)}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-[13px] font-bold transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clear all confirm */}
      <AnimatePresence>
        {clearing && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setClearing(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-500" strokeWidth={1.6} />
              </div>
              <h3 className="text-[15px] font-bold text-slate-800 mb-1">Clear All Drafts?</h3>
              <p className="text-[13px] text-slate-500 mb-5">All {drafts.length} draft{drafts.length !== 1 ? "s" : ""} will be permanently deleted.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setClearing(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearAll}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-[13px] font-bold transition-colors"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom close button */}
      <button
        onClick={() => navigate("/dashboard/billing")}
        className="absolute top-3 right-3 w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
        aria-label="Back to billing"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
