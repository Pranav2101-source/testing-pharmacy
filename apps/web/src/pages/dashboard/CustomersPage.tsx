"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, UserPlus, Users, Phone, Mail, Trash2, Pencil,
  CreditCard, ChevronLeft, ChevronRight, Loader2, RefreshCw,
  BadgeCheck, X, AlertTriangle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { CustomerModal } from "@/components/customers/CustomerModal";
import type { CustomerRecord } from "@/components/customers/CustomerModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerRow = CustomerRecord & {
  _count?: { invoices: number };
};

type ListResponse = {
  items:      CustomerRow[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
};

type CustomerType = "WALK_IN" | "REGISTERED" | "CORPORATE" | "CREDIT";

const TYPE_LABELS: Record<CustomerType, string> = {
  WALK_IN:    "Walk-in",
  REGISTERED: "Registered",
  CORPORATE:  "Corporate",
  CREDIT:     "Credit",
};

const TYPE_COLORS: Record<CustomerType, string> = {
  WALK_IN:    "bg-slate-100 text-slate-600",
  REGISTERED: "bg-blue-100 text-blue-700",
  CORPORATE:  "bg-violet-100 text-violet-700",
  CREDIT:     "bg-amber-100 text-amber-700",
};

const PAGE_LIMIT = 20;

// ── Delete confirmation ───────────────────────────────────────────────────────

function DeleteConfirm({
  name,
  onConfirm,
  onCancel,
  loading,
}: {
  name:      string;
  onConfirm: () => void;
  onCancel:  () => void;
  loading:   boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1,    opacity: 1 }}
        exit={{   scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">Remove Customer?</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">
              &ldquo;{name}&rdquo; will be soft-deleted and hidden from all lists.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] text-slate-600 hover:text-slate-800 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-1.5 px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Remove
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const qc = useQueryClient();

  const [search,       setSearch]       = useState("");
  const [typeFilter,   setTypeFilter]   = useState<CustomerType | "">("");
  const [page,         setPage]         = useState(1);
  const [showCreate,   setShowCreate]   = useState(false);
  const [editTarget,   setEditTarget]   = useState<CustomerRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerRow | null>(null);
  const [toast,        setToast]        = useState<{ text: string; type: "success" | "error" } | null>(null);

  function showToast(text: string, type: "success" | "error" = "success") {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const queryKey = ["customers", search, typeFilter, page];
  const { data, isLoading, isFetching, error: fetchError } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page:  String(page),
        limit: String(PAGE_LIMIT),
        ...(search.trim()  ? { search: search.trim() }     : {}),
        ...(typeFilter     ? { customerType: typeFilter }   : {}),
      });
      const res = await api.get<{ data: ListResponse }>(`/customers?${params}`);
      return res.data.data;
    },
    placeholderData: (prev) => prev,
  });

  const list       = data?.items      ?? [];
  const total      = data?.total      ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // ── Delete mutation ───────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setDeleteTarget(null);
      showToast("Customer removed successfully");
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string; error?: string } } };
      showToast(e?.response?.data?.message ?? "Failed to remove customer", "error");
      setDeleteTarget(null);
    },
  });

  // ── After create/edit ─────────────────────────────────────────────────────
  const handleSaved = useCallback((saved: CustomerRecord, isEdit: boolean) => {
    qc.invalidateQueries({ queryKey: ["customers"] });
    setShowCreate(false);
    setEditTarget(null);
    showToast(isEdit ? `${saved.name} updated` : `${saved.name} added`);
  }, [qc]);

  // ── Search with reset page ────────────────────────────────────────────────
  function handleSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  function handleTypeFilter(v: CustomerType | "") {
    setTypeFilter(v);
    setPage(1);
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-slate-900">Customers</h1>
            {!isLoading && (
              <p className="text-[12px] text-slate-400">
                {total.toLocaleString()} customer{total !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      {/* ── Filters bar ── */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-slate-200 flex-shrink-0">
        {/* Search */}
        <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-white flex-1 max-w-md focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, mobile, ABHA, card…"
            className="flex-1 text-[13px] text-slate-700 placeholder-slate-400 bg-transparent focus:outline-none"
          />
          {search && (
            <button onClick={() => handleSearch("")} className="text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1.5">
          {(["", "REGISTERED", "WALK_IN", "CORPORATE", "CREDIT"] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleTypeFilter(t as CustomerType | "")}
              className={cn(
                "px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors",
                typeFilter === t
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              {t === "" ? "All" : TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {isFetching && !isLoading && (
          <RefreshCw className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : fetchError ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className="text-[14px]">Failed to load customers</p>
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
            <Users className="w-10 h-10 text-slate-200" />
            <p className="text-[14px] font-medium text-slate-500">No customers found</p>
            {(search || typeFilter) && (
              <button
                onClick={() => { handleSearch(""); handleTypeFilter(""); }}
                className="text-[12px] text-blue-500 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="text-left px-5 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[11px]">Customer</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[11px]">Mobile</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[11px]">ABHA / Card</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[11px]">Type</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[11px]">Discount</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[11px]">Credit</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[11px]">Bills</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                  {/* Name + email */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-[12px] flex-shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">{c.name}</p>
                        {c.email && (
                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <Mail className="w-2.5 h-2.5" />{c.email}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Mobile */}
                  <td className="px-4 py-3.5">
                    {c.phone ? (
                      <span className="flex items-center gap-1 text-slate-700">
                        <Phone className="w-3 h-3 text-slate-400" />{c.phone}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>

                  {/* ABHA / Card */}
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      {c.abhaNumber && (
                        <span className="flex items-center gap-1 text-[11px] text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded-md w-fit">
                          <BadgeCheck className="w-3 h-3" />{c.abhaNumber}
                        </span>
                      )}
                      {c.cardNumber && (
                        <span className="flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-md w-fit">
                          <CreditCard className="w-3 h-3" />{c.cardNumber}
                        </span>
                      )}
                      {!c.abhaNumber && !c.cardNumber && (
                        <span className="text-slate-300">—</span>
                      )}
                    </div>
                  </td>

                  {/* Type */}
                  <td className="px-4 py-3.5">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold",
                      TYPE_COLORS[c.customerType as CustomerType] ?? "bg-slate-100 text-slate-600",
                    )}>
                      {TYPE_LABELS[c.customerType as CustomerType] ?? c.customerType}
                    </span>
                  </td>

                  {/* Discount */}
                  <td className="px-4 py-3.5 text-right">
                    {c.defaultDiscount > 0 ? (
                      <span className="text-green-700 font-semibold">{c.defaultDiscount}%</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>

                  {/* Credit */}
                  <td className="px-4 py-3.5 text-right">
                    {c.creditLimit > 0 ? (
                      <div>
                        <p className="font-semibold text-slate-800">₹{c.creditLimit.toLocaleString()}</p>
                        {c.creditUsed > 0 && (
                          <p className="text-[11px] text-amber-600">₹{c.creditUsed.toLocaleString()} used</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>

                  {/* Bills count */}
                  <td className="px-4 py-3.5 text-right text-slate-500">
                    {c._count?.invoices ?? 0}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                      <button
                        onClick={() => setEditTarget(c)}
                        title="Edit customer"
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-400 hover:text-blue-600 flex items-center justify-center transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(c)}
                        title="Remove customer"
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 text-slate-400 hover:text-red-600 flex items-center justify-center transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 bg-white border-t border-slate-200 flex-shrink-0">
          <p className="text-[12px] text-slate-500">
            Showing {(page - 1) * PAGE_LIMIT + 1}–{Math.min(page * PAGE_LIMIT, total)} of {total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[13px] font-medium text-slate-700">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      <AnimatePresence>
        {showCreate && (
          <CustomerModal
            onClose={() => setShowCreate(false)}
            onSaved={(saved) => handleSaved(saved, false)}
          />
        )}
        {editTarget && (
          <CustomerModal
            customer={editTarget}
            onClose={() => setEditTarget(null)}
            onSaved={(saved) => handleSaved(saved, true)}
          />
        )}
        {deleteTarget && (
          <DeleteConfirm
            name={deleteTarget.name}
            loading={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0  }}
            exit={{   opacity: 0, y: 12 }}
            className={cn(
              "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-xl text-[13px] font-semibold",
              toast.type === "success"
                ? "bg-emerald-600 text-white"
                : "bg-red-600 text-white",
            )}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
