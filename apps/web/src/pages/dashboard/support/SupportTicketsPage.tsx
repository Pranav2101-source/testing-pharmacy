import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TicketCheck, Plus, Search, X, Loader2, AlertTriangle,
  ChevronLeft, ChevronRight, RefreshCw, Clock, CheckCircle2,
  Users, Inbox, TrendingUp, Headset, MessageSquareText,
  Download, ChevronDown, FileSpreadsheet, FileText,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isSupportStaff, isPlatformAdmin } from "@/lib/auth";
import { useToast } from "@/hooks/useToast";
import { useSupportStream } from "@/hooks/useSupportStream";
import { TicketStatusBadge, type TicketStatus } from "@/components/support/TicketStatusBadge";
import { NewTicketModal } from "@/components/support/NewTicketModal";
import { AdminTicketModal } from "@/components/support/AdminTicketModal";

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

// ── Export helpers ────────────────────────────────────────────────────────────

const EXPORT_COLUMNS = [
  "Ticket ID", "Pharmacy", "City", "Category",
  "Status", "Assigned Agent", "Raised By", "Mobile", "Description", "Created Date",
] as const;

function ticketToRow(t: Ticket): string[] {
  return [
    t.ticketNumber,
    t.pharmacy.name,
    t.pharmacy.city ?? "",
    t.category.name,
    t.status,
    t.assignedAgent?.user.name ?? "Unassigned",
    t.raisedBy.name,
    t.mobile,
    t.description.replace(/[\r\n]+/g, " "),
    new Date(t.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
  ];
}

function escapeCsvField(field: string): string {
  if (/[,"\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

function buildCsv(tickets: Ticket[]): string {
  const header = EXPORT_COLUMNS.map(escapeCsvField).join(",");
  const rows = tickets.map((t) => ticketToRow(t).map(escapeCsvField).join(","));
  return [header, ...rows].join("\n");
}

// Tab-separated values with .xls extension — opens natively in Excel without any library
function buildXls(tickets: Ticket[]): string {
  const header = EXPORT_COLUMNS.join("\t");
  const rows = tickets.map((t) => ticketToRow(t).join("\t"));
  return [header, ...rows].join("\n");
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Export dropdown ───────────────────────────────────────────────────────────

function ExportDropdown({ tickets, disabled }: { tickets: Ticket[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleExport(format: "csv" | "xlsx") {
    setOpen(false);
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      if (format === "csv") {
        triggerDownload(buildCsv(tickets), `support-tickets-${timestamp}.csv`, "text/csv");
      } else {
        triggerDownload(buildXls(tickets), `support-tickets-${timestamp}.xls`, "application/vnd.ms-excel");
      }
      toast.success(`Exported ${tickets.length} ticket${tickets.length !== 1 ? "s" : ""} as ${format.toUpperCase()}`);
    } catch {
      toast.error("Export failed. Please try again.");
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-1.5 h-9 px-3 rounded-xl border text-[13px] font-semibold transition-all",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          open
            ? "bg-slate-100 border-slate-300 text-slate-700"
            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300",
        )}
      >
        <Download className="w-3.5 h-3.5" />
        Export
        <ChevronDown className={cn("w-3.5 h-3.5 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden py-1"
          >
            <button
              onClick={() => handleExport("csv")}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800">Export CSV</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Comma-separated values</p>
              </div>
            </button>
            <button
              onClick={() => handleExport("xlsx")}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800">Export Excel</p>
                <p className="text-[11px] text-slate-400 mt-0.5">.xls spreadsheet</p>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

type StatsBarProps = {
  activeFilter: TicketStatus | "";
  onFilterChange: (filter: TicketStatus | "") => void;
};

function StatsBar({ activeFilter, onFilterChange }: StatsBarProps) {
  const { data } = useQuery<Stats>({
    queryKey: ["support-stats"],
    queryFn:  async () => (await api.get<{ data: Stats }>("/support/stats")).data.data,
    refetchInterval: 30_000,
  });

  if (!data) return null;

  const cards = [
    { label: "Total Tickets", value: data.total,      icon: TicketCheck,   color: "text-blue-600",    bg: "bg-blue-50",    border: "border-blue-100",    ring: "ring-blue-400",    filterValue: "" as TicketStatus | ""           },
    { label: "Open",          value: data.open,        icon: Clock,         color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-100",   ring: "ring-amber-400",   filterValue: "OPEN" as TicketStatus | ""       },
    { label: "In Progress",   value: data.inProgress,  icon: TrendingUp,    color: "text-violet-600",  bg: "bg-violet-50",  border: "border-violet-100",  ring: "ring-violet-400",  filterValue: "IN_PROGRESS" as TicketStatus | "" },
    { label: "Resolved",      value: data.resolved,    icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100", ring: "ring-emerald-400", filterValue: "RESOLVED" as TicketStatus | ""    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4 px-6 py-4">
      {cards.map(({ label, value, icon: Icon, color, bg, border, ring, filterValue }) => {
        const isActive = activeFilter === filterValue;
        return (
          <motion.button
            key={label}
            type="button"
            onClick={() => onFilterChange(filterValue)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            className={cn(
              "rounded-xl border p-4 flex items-center gap-4 bg-white text-left",
              "cursor-pointer select-none outline-none",
              "transition-shadow duration-200 ease-in-out",
              "hover:shadow-md hover:shadow-slate-200/60",
              border,
              isActive && `ring-2 ${ring} shadow-md`,
            )}
          >
            <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0", bg)}>
              <Icon className={cn("w-5 h-5", color)} />
            </div>
            <div className="min-w-0">
              <p className="text-[28px] font-extrabold text-slate-900 leading-none tracking-tight">{value}</p>
              <p className="text-[12px] text-slate-500 mt-1 font-medium truncate">{label}</p>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SupportTicketsPage() {
  const navigate = useNavigate();
  const toast    = useToast();
  const qc       = useQueryClient();
  // Computed at render time so hot-reloads and session changes are reflected correctly.
  const isAgent  = isSupportStaff();
  const isAdmin  = isPlatformAdmin();

  // Live updates via SSE — invalidates react-query cache on ticket events
  useSupportStream();

  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [page,         setPage]         = useState(1);
  const [showCreate,   setShowCreate]   = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshGuard = useRef(false);

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

  const handleRefresh = useCallback(async () => {
    if (refreshGuard.current) return;
    refreshGuard.current = true;
    setIsRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["support-tickets"] }),
        qc.invalidateQueries({ queryKey: ["support-stats"] }),
      ]);
      toast.success("Dashboard refreshed");
    } catch {
      toast.error("Refresh failed. Please try again.");
    } finally {
      setIsRefreshing(false);
      refreshGuard.current = false;
    }
  }, [qc, toast]);

  return (
    <div className="flex flex-col h-full bg-[#f5f7fa] overflow-hidden">

      {/* ── Header with Quick Actions ── */}
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

        {/* ── Quick Actions Toolbar ── */}
        <div className="flex items-center gap-2">
          {/* Background fetch indicator */}
          {isFetching && !isLoading && !isRefreshing && (
            <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          )}

          {/* Refresh */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh tickets & stats"
            className={cn(
              "flex items-center gap-1.5 h-9 px-3 rounded-xl border text-[13px] font-semibold transition-all",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300",
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Export */}
          <ExportDropdown tickets={list} disabled={isLoading} />

          {/* Create Ticket — visible for platform admin, hidden for support agents */}
          {(!isAgent || isAdmin) && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-xl transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Create Ticket</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats — agents only */}
      {isAgent && (
        <div className="bg-white border-b border-slate-200">
          <StatsBar activeFilter={statusFilter} onFilterChange={handleStatus} />
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
          <div className="flex flex-col items-center justify-center min-h-[420px] h-full px-6 py-12">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="flex flex-col items-center gap-6 max-w-md text-center"
            >
              {/* ── Large illustration ── */}
              <div className="relative w-32 h-32">
                {/* Outer decorative ring */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-50 via-slate-50 to-violet-50 animate-pulse" style={{ animationDuration: '3s' }} />
                {/* Inner circle with icon */}
                <div className="absolute inset-3 rounded-full bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center shadow-inner">
                  <Headset className="w-12 h-12 text-blue-500" strokeWidth={1.5} />
                </div>
                {/* Floating accent — message bubble */}
                <motion.div
                  animate={{ y: [-2, 2, -2] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -top-1 -right-1 w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-md flex items-center justify-center"
                >
                  <MessageSquareText className="w-5 h-5 text-violet-500" />
                </motion.div>
                {/* Floating accent — ticket badge */}
                <motion.div
                  animate={{ y: [2, -2, 2] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -bottom-1 -left-1 w-9 h-9 rounded-lg bg-white border border-slate-200 shadow-md flex items-center justify-center"
                >
                  <TicketCheck className="w-4.5 h-4.5 text-blue-500" />
                </motion.div>
                {/* Small decorative dots */}
                <div className="absolute top-0 left-4 w-2 h-2 rounded-full bg-amber-300 opacity-70" />
                <div className="absolute bottom-3 right-0 w-1.5 h-1.5 rounded-full bg-emerald-400 opacity-60" />
              </div>

              {/* ── Text ── */}
              {search || statusFilter ? (
                <div>
                  <h2 className="text-[18px] font-bold text-slate-800">No tickets found</h2>
                  <p className="text-[14px] text-slate-500 mt-2 leading-relaxed">
                    No tickets match your current filters.<br />
                    Try clearing your search or status filter.
                  </p>
                  <button
                    onClick={() => { handleSearch(""); handleStatus(""); }}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Clear All Filters
                  </button>
                </div>
              ) : (
                <div>
                  <h2 className="text-[18px] font-bold text-slate-800">No support tickets yet</h2>
                  <p className="text-[14px] text-slate-500 mt-2 leading-relaxed">
                    Support requests submitted by pharmacies will appear here.
                  </p>
                </div>
              )}

              {/* ── CTA — only non-agent (pharmacy users) can create tickets ── */}
              {(!isAgent || isAdmin) && !search && !statusFilter && (
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-semibold rounded-xl transition-colors shadow-sm shadow-blue-200"
                >
                  <Plus className="w-4.5 h-4.5" />
                  Create Ticket
                </motion.button>
              )}
            </motion.div>
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
          isPlatformAdmin() ? (
            <AdminTicketModal
              onClose={() => setShowCreate(false)}
              onSaved={(num) => {
                setShowCreate(false);
                toast.success(`Ticket ${num} created successfully.`);
                qc.invalidateQueries({ queryKey: ["support-tickets"] });
                qc.invalidateQueries({ queryKey: ["support-stats"] });
              }}
            />
          ) : (
            <NewTicketModal
              onClose={() => setShowCreate(false)}
              onSaved={(num) => {
                setShowCreate(false);
                toast.success(`Ticket ${num} created successfully. Our team will contact you soon.`);
                qc.invalidateQueries({ queryKey: ["support-tickets"] });
              }}
            />
          )
        )}
      </AnimatePresence>
    </div>
  );
}
