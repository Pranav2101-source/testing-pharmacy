import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  TicketCheck, Plus, Search, X, Loader2, AlertTriangle,
  ChevronLeft, ChevronRight, RefreshCw, Clock, CheckCircle2,
  Users, Inbox, TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isSupportStaff } from "@/lib/auth";
import { useToast } from "@/hooks/useToast";
import { useSupportStream } from "@/hooks/useSupportStream";
import { TicketStatusBadge, type TicketStatus } from "@/components/support/TicketStatusBadge";
import { NewTicketModal } from "@/components/support/NewTicketModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type Ticket = {
  id: string; ticketNumber: string; status: TicketStatus; language: string;
  description: string; mobile: string; createdAt: string;
  category: { id: string; name: string };
  raisedBy: { id: string; name: string; role: string };
  assignedAgent?: { id: string; user: { id: string; name: string } } | null;
  pharmacy: { id: string; name: string; city: string | null };
};

type ListResponse = {
  items: Ticket[]; total: number; page: number; limit: number; totalPages: number;
};

type Stats = { total: number; open: number; inProgress: number; resolved: number };

const STATUS_FILTERS: { value: TicketStatus | ""; label: string }[] = [
  { value: "",             label: "All"         },
  { value: "OPEN",         label: "Open"        },
  { value: "ASSIGNED",     label: "Assigned"    },
  { value: "IN_PROGRESS",  label: "In Progress" },
  { value: "PENDING_USER", label: "Pending"     },
  { value: "RESOLVED",     label: "Resolved"    },
  { value: "CLOSED",       label: "Closed"      },
];

const PAGE_LIMIT = 20;

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar() {
  const { data } = useQuery<Stats>({
    queryKey: ["support-stats"],
    queryFn:  async () => (await api.get<{ data: Stats }>("/support/stats")).data.data,
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const cards = [
    { label: "Total Tickets", value: data.total,      icon: TicketCheck,   color: "text-blue-600",    bg: "bg-blue-50",    border: "border-blue-100"    },
    { label: "Open",          value: data.open,        icon: Clock,         color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-100"   },
    { label: "In Progress",   value: data.inProgress,  icon: TrendingUp,    color: "text-violet-600",  bg: "bg-violet-50",  border: "border-violet-100"  },
    { label: "Resolved",      value: data.resolved,    icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100" },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 px-6 py-3">
      {cards.map(({ label, value, icon: Icon, color, bg, border }) => (
        <div key={label} className={cn(
          "rounded-xl border p-3.5 flex items-center gap-3 bg-white",
          border,
        )}>
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", bg)}>
            <Icon className={cn("w-4.5 h-4.5", color)} />
          </div>
          <div>
            <p className="text-[20px] font-bold text-slate-900 leading-none">{value}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 font-medium">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SupportTicketsPage() {
  const navigate = useNavigate();
  const toast    = useToast();
  // Computed at render time so hot-reloads and session changes are reflected correctly.
  const isAgent  = isSupportStaff();

  // Live updates via SSE — invalidates react-query cache on ticket events
  useSupportStream();

  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [page,         setPage]         = useState(1);
  const [showCreate,   setShowCreate]   = useState(false);

  const queryKey = ["support-tickets", search, statusFilter, page];

  const { data, isLoading, isFetching, error } = useQuery<ListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page), limit: String(PAGE_LIMIT),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(statusFilter  ? { status: statusFilter }  : {}),
      });
      return (await api.get<{ data: ListResponse }>(`/support/tickets?${params}`)).data.data;
    },
    placeholderData: (prev) => prev,
  });

  const list       = data?.items      ?? [];
  const total      = data?.total      ?? 0;
  const totalPages = data?.totalPages ?? 1;

  function handleSearch(v: string) { setSearch(v); setPage(1); }
  function handleStatus(v: TicketStatus | "") { setStatusFilter(v); setPage(1); }

  return (
    <div className="flex flex-col h-full bg-[#f5f7fa] overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
            <TicketCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-[16px] font-bold text-slate-900">
              {isAgent ? "All Support Tickets" : "My Support Tickets"}
            </h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isLoading ? "Loading…" : `${total.toLocaleString()} ticket${total !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isFetching && !isLoading && (
            <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          )}
          {!isAgent && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Raise Ticket
            </button>
          )}
        </div>
      </div>

      {/* Stats — agents only */}
      {isAgent && (
        <div className="bg-white border-b border-slate-200">
          <StatsBar />
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-slate-200 flex-shrink-0 flex-wrap">
        {/* Search */}
        <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-white flex-1 min-w-[200px] max-w-xs focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-50 transition-all">
          <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search tickets…"
            className="flex-1 text-[13px] text-slate-700 placeholder-slate-400 bg-transparent focus:outline-none"
          />
          {search && (
            <button onClick={() => handleSearch("")} className="text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleStatus(value)}
              className={cn(
                "px-3 py-1.5 text-[12px] font-semibold rounded-lg border transition-all",
                statusFilter === value
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-600">Failed to load tickets</p>
            <p className="text-[12px] text-slate-400">Please check your connection and try again.</p>
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Inbox className="w-8 h-8 text-slate-300" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-semibold text-slate-700">No tickets found</p>
              <p className="text-[12px] text-slate-400 mt-1">
                {search || statusFilter ? "Try clearing your filters." : "No support tickets yet."}
              </p>
            </div>
            {!isAgent && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-[13px] font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Raise Your First Ticket
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <th className="text-left px-5 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Ticket</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Category</th>
                {isAgent && <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Pharmacy</th>}
                {isAgent && <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Raised By</th>}
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Agent</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 text-[11px] uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((t, i) => (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/dashboard/support/${t.id}`)}
                  className={cn(
                    "group cursor-pointer hover:bg-white transition-colors",
                    i % 2 === 0 ? "bg-white" : "bg-slate-50/50",
                  )}
                >
                  {/* Ticket # + description */}
                  <td className="px-5 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-[12px] font-extrabold text-blue-600 tracking-tight">
                        {t.ticketNumber}
                      </span>
                      <span className="text-[12px] text-slate-500 line-clamp-1 max-w-[260px]">
                        {t.description}
                      </span>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3.5">
                    <TicketStatusBadge status={t.status} />
                  </td>

                  {/* Category */}
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold">
                      {t.category.name}
                    </span>
                  </td>

                  {/* Pharmacy (agents only) */}
                  {isAgent && (
                    <td className="px-4 py-3.5">
                      <div>
                        <p className="text-[12px] font-semibold text-slate-800">{t.pharmacy.name}</p>
                        {t.pharmacy.city && (
                          <p className="text-[10px] text-slate-400">{t.pharmacy.city}</p>
                        )}
                      </div>
                    </td>
                  )}

                  {/* Raised by (agents only) */}
                  {isAgent && (
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                          {t.raisedBy.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-[12px] font-medium text-slate-700">{t.raisedBy.name}</p>
                          <p className="text-[10px] text-slate-400">{t.mobile}</p>
                        </div>
                      </div>
                    </td>
                  )}

                  {/* Agent */}
                  <td className="px-4 py-3.5">
                    {t.assignedAgent ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0">
                          {t.assignedAgent.user.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-[12px] text-slate-700 font-medium">{t.assignedAgent.user.name}</span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        Unassigned
                      </span>
                    )}
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3.5 text-slate-500 text-[12px] whitespace-nowrap">
                    {new Date(t.createdAt).toLocaleDateString("en-IN", {
                      day: "2-digit", month: "short", year: "numeric",
                    })}
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
            Showing <span className="font-semibold text-slate-700">
              {(page - 1) * PAGE_LIMIT + 1}–{Math.min(page * PAGE_LIMIT, total)}
            </span> of <span className="font-semibold text-slate-700">{total.toLocaleString()}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 h-8 flex items-center text-[13px] font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Create modal ── */}
      <AnimatePresence>
        {showCreate && (
          <NewTicketModal
            onClose={() => setShowCreate(false)}
            onSaved={(ticketNumber) => {
              setShowCreate(false);
              toast.success(`Ticket ${ticketNumber} submitted successfully`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
