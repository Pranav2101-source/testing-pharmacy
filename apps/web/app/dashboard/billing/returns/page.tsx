"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, Search, Calendar, ChevronDown, Loader2,
  ArrowUpDown, ArrowUp, ArrowDown, FileX, AlertCircle, RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReturnRow = {
  id:           string;
  returnNumber: string;
  createdAt:    string;
  totalAmount:  number;
  reason:       string | null;
  invoice:      { id: string; invoiceNumber: string };
  customer:     { name: string; phone: string | null } | null;
  user:         { name: string };
  items:        { quantity: number; amount: number }[];
};

type SortCol = "returnNumber" | "createdAt" | "totalAmount" | "customerName";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function fmtCurrency(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCurrentFY() {
  const now   = new Date();
  const yr    = now.getFullYear();
  const start = now.getMonth() >= 3 ? yr : yr - 1;
  return {
    from:  `${start}-04-01`,
    to:    `${start + 1}-03-31`,
    label: `01/04/${start} - 31/03/${start + 1}`,
  };
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-blue-400 transition-colors" />;
  return dir === "asc"
    ? <ArrowUp   className="w-3 h-3 text-blue-600" />
    : <ArrowDown className="w-3 h-3 text-blue-600" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReturnsPage() {
  const router = useRouter();
  const fy     = getCurrentFY();

  const [rows,       setRows]       = useState<ReturnRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const [search,         setSearch]         = useState("");
  const [dateFrom,       setDateFrom]       = useState(fy.from);
  const [dateTo,         setDateTo]         = useState(fy.to);
  const [dateLabel,      setDateLabel]      = useState(fy.label);
  const [draftFrom,      setDraftFrom]      = useState(fy.from);
  const [draftTo,        setDraftTo]        = useState(fy.to);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const dateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setShowDatePicker(false);
    };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/billing/returns", {
        params: { page, limit: 20, search: search || undefined, from: dateFrom, to: dateTo },
      });
      setRows(data.data.items);
      setTotal(data.data.total);
      setTotalPages(data.data.totalPages);
    } catch {
      setError("Failed to load returns.");
    } finally {
      setLoading(false);
    }
  }, [page, search, dateFrom, dateTo]);

  useEffect(() => {
    const delay = search ? 380 : 0;
    const t = setTimeout(fetchReturns, delay);
    return () => clearTimeout(t);
  }, [fetchReturns]);

  const displayed = useMemo(() => {
    return [...rows].sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      switch (sortCol) {
        case "returnNumber":  va = a.returnNumber; vb = b.returnNumber; break;
        case "createdAt":     va = a.createdAt;    vb = b.createdAt;    break;
        case "customerName":  va = a.customer?.name ?? ""; vb = b.customer?.name ?? ""; break;
        case "totalAmount":   va = a.totalAmount;  vb = b.totalAmount;  break;
        default: return 0;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [rows, sortCol, sortDir]);

  function handleSort(col: SortCol) {
    setSortDir((d) => col === sortCol ? (d === "asc" ? "desc" : "asc") : "desc");
    setSortCol(col);
  }

  function applyDateRange() {
    const fmt = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    };
    setDateFrom(draftFrom); setDateTo(draftTo);
    setDateLabel(`${fmt(draftFrom)} - ${fmt(draftTo)}`);
    setPage(1); setShowDatePicker(false);
  }

  function ColHdr({ col, label, sortable = true, className }: { col?: SortCol; label: string; sortable?: boolean; className?: string }) {
    if (!sortable || !col) {
      return <th className={cn("px-4 py-3 text-left text-[12px] font-semibold text-blue-600 whitespace-nowrap", className)}>{label}</th>;
    }
    return (
      <th className={cn("px-4 py-3 text-left whitespace-nowrap", className)}>
        <button onClick={() => handleSort(col)} className="flex items-center gap-1 text-[12px] font-semibold text-blue-600 group hover:text-blue-700">
          {label}
          <SortIcon active={sortCol === col} dir={sortDir} />
        </button>
      </th>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/billing" className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-[13px] transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Sales
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-[17px] font-bold text-slate-900">Sales Returns</h1>
        </div>
        <button onClick={fetchReturns} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-[12px] transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-[#f7f9fc] flex-shrink-0 flex-wrap">

        {/* Search */}
        <div className="flex items-center border border-slate-200 rounded-md bg-white overflow-hidden h-[30px] text-[13px] shadow-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Return No. / Invoice No. / Customer"
            className="px-2.5 bg-transparent text-slate-700 placeholder-slate-400 focus:outline-none w-52 h-full"
          />
          <span className="px-2 text-slate-400 flex items-center h-full">
            <Search className="w-3.5 h-3.5" />
          </span>
        </div>

        {/* Date range */}
        <div ref={dateRef} className="relative">
          <button
            onClick={() => { setDraftFrom(dateFrom); setDraftTo(dateTo); setShowDatePicker((v) => !v); }}
            className={cn(
              "flex items-center gap-1.5 border rounded-md bg-white px-3 h-[30px] text-[13px] text-slate-700 font-medium hover:border-slate-300 transition-colors whitespace-nowrap shadow-sm",
              showDatePicker ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"
            )}
          >
            <span>{dateLabel}</span>
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
          </button>

          <AnimatePresence>
            {showDatePicker && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0,  scale: 1    }}
                exit={{   opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-20 p-4 w-[280px]"
              >
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3">Date Range</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium mb-1 block">From</label>
                    <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium mb-1 block">To</label>
                    <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end pt-1 border-t border-slate-100">
                  <button onClick={() => { setDraftFrom(fy.from); setDraftTo(fy.to); setDateFrom(fy.from); setDateTo(fy.to); setDateLabel(fy.label); setPage(1); setShowDatePicker(false); }}
                    className="text-[12px] text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
                    Reset to FY
                  </button>
                  <button onClick={applyDateRange}
                    className="text-[12px] bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-1.5 rounded-lg transition-colors">
                    Apply
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              <ColHdr col="returnNumber" label="Return No."    />
              <ColHdr col="createdAt"    label="Date"          />
              <ColHdr                    label="Invoice No." sortable={false} />
              <ColHdr col="customerName" label="Patient"       />
              <ColHdr                    label="Mobile"      sortable={false} />
              <ColHdr                    label="Items"       sortable={false} />
              <ColHdr col="totalAmount"  label="Return Amt."   />
              <ColHdr                    label="Reason"      sortable={false} />
              <ColHdr                    label="Entry By"    sortable={false} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="py-24 text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-blue-400 mx-auto" />
                  <p className="text-slate-400 text-[13px] mt-3">Loading returns…</p>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={9} className="py-24 text-center">
                  <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-3" />
                  <p className="text-red-500 text-[13px] font-medium">{error}</p>
                  <button onClick={fetchReturns} className="mt-3 text-blue-600 text-[12px] hover:underline">Try again</button>
                </td>
              </tr>
            ) : displayed.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-24 text-center">
                  <FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 text-[14px] font-medium">No returns found</p>
                  <p className="text-slate-400 text-[12px] mt-1">Returns will appear here when you process them from a bill</p>
                </td>
              </tr>
            ) : (
              displayed.map((row) => {
                const totalItems = row.items.reduce((s, it) => s + it.quantity, 0);
                return (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/dashboard/billing/${row.invoice.id}`)}
                    className="border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3 text-[13px] font-semibold text-rose-600 whitespace-nowrap">
                      {row.returnNumber}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{fmtDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-[13px] font-medium text-blue-600 whitespace-nowrap">
                      <Link
                        href={`/dashboard/billing/${row.invoice.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline"
                      >
                        {row.invoice.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-700 max-w-[140px] truncate">
                      {row.customer?.name ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">
                      {row.customer?.phone ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 tabular-nums text-center">{totalItems}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-rose-600 whitespace-nowrap tabular-nums">
                      − {fmtCurrency(row.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-slate-500 max-w-[160px] truncate italic">
                      {row.reason ?? <span className="text-slate-300 not-italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{row.user.name}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex-shrink-0"
        >
            <span className="text-[12px] text-slate-500">
              Showing <span className="font-semibold text-slate-700">{Math.min((page - 1) * 20 + 1, total)}–{Math.min(page * 20, total)}</span>{" "}
              of <span className="font-semibold text-slate-700">{total}</span> returns
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                ‹ Prev
              </button>
              <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">
                {page} / {totalPages}
              </span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] text-slate-600 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                Next ›
              </button>
            </div>
        </div>
      )}
    </div>
  );
}
