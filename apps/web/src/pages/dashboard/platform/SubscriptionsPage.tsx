import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  CreditCard, TrendingUp, Users, AlertTriangle, Calendar, RefreshCw,
  Search, Filter, Download, Plus, ChevronLeft, ChevronRight, X,
  MoreVertical, CheckCircle2, Ban, Pause, Play, Mail, FileText,
  ArrowUpCircle, ArrowDownCircle, BarChart3, PieChart,
  DollarSign, Clock, Percent, Target, Loader2, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, PieChart as RPieChart, Pie, Cell, BarChart, Bar, CartesianGrid, Legend, LineChart, Line } from "recharts";
import { SubscriptionDrawer } from "./components/SubscriptionDrawer";
import { SubscriptionExportModal } from "./components/SubscriptionExportModal";
import { ChangePlanModal } from "./components/ChangePlanModal";

// ── Types ────────────────────────────────────────────────────────────────────

type SubRow = {
  id: string;
  pharmacyId: string;
  tenant: { name: string; tenantCode: string | null };
  owner: { name: string; email: string } | null;
  planName: string;
  mrr: number;
  billingCycle: string;
  amount: number | null;
  status: string;
  validUntil: string;
  autoRenew: boolean;
  paymentStatus: string;
  usagePercent: number;
  health: string;
  createdAt: string;
};

type Stats = {
  mrr: number; arr: number; todaysRevenue: number; monthlyRevenue: number;
  renewalsThisMonth: number; outstanding: number; collectionRate: number; arpt: number;
  activeSubs: number; trialSubs: number; expiringSoon: number; expiredSubs: number; churnRate: number;
};

type ChartData = {
  planDistribution: { name: string; count: number }[];
  statusDistribution: { name: string; count: number }[];
  mrrTrend: { month: string; revenue: number }[];
  renewalTrend: { month: string; renewals: number }[];
  churnTrend: { month: string; churn: number }[];
};

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE:    { bg: "bg-emerald-50 ring-emerald-600/20", text: "text-emerald-700", label: "Active" },
  TRIAL:     { bg: "bg-blue-50 ring-blue-600/20",      text: "text-blue-700",    label: "Trial" },
  PAUSED:    { bg: "bg-amber-50 ring-amber-600/20",    text: "text-amber-700",   label: "Paused" },
  EXPIRED:   { bg: "bg-red-50 ring-red-600/20",        text: "text-red-700",     label: "Expired" },
  CANCELLED: { bg: "bg-slate-50 ring-slate-600/20",    text: "text-slate-500",   label: "Cancelled" },
};

const PLAN_BADGE: Record<string, string> = {
  Free:         "bg-slate-100 text-slate-600",
  Standard:     "bg-indigo-100 text-indigo-700",
  Professional: "bg-violet-100 text-violet-700",
  Enterprise:   "bg-amber-100 text-amber-800",
};

const HEALTH_BADGE: Record<string, { dot: string; label: string }> = {
  HEALTHY:        { dot: "bg-emerald-500", label: "Healthy" },
  EXPIRING_SOON:  { dot: "bg-amber-500",   label: "Expiring" },
  PAYMENT_FAILED: { dot: "bg-red-500",     label: "Failed" },
  SUSPENDED:      { dot: "bg-red-500",     label: "Suspended" },
  PAUSED:         { dot: "bg-amber-500",   label: "Paused" },
};

const PAYMENT_BADGE: Record<string, { bg: string; text: string }> = {
  PAID:      { bg: "bg-emerald-50", text: "text-emerald-700" },
  PENDING:   { bg: "bg-amber-50",   text: "text-amber-700" },
  OVERDUE:   { bg: "bg-red-50",     text: "text-red-700" },
  CANCELLED: { bg: "bg-slate-50",   text: "text-slate-500" },
};

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#f59e0b", "#ef4444", "#10b981"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function daysUntil(dateStr: string) {
  const d = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Today";
  return `in ${d}d`;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<"subscriptions" | "analytics">("subscriptions");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [renewalFilter, setRenewalFilter] = useState("ALL");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSubId, setSelectedSubId] = useState<string | null>(searchParams.get("id"));

  useEffect(() => {
    if (selectedSubId) {
      setSearchParams({ id: selectedSubId });
    } else {
      setSearchParams(new URLSearchParams());
    }
  }, [selectedSubId, setSearchParams]);
  const [showExport, setShowExport] = useState(false);
  const [showChangePlan, setShowChangePlan] = useState<{ id: string; currentPlan: string } | null>(null);

  const toast = useToast();
  const qc = useQueryClient();

  // Stats
  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ["sub-stats"],
    queryFn: async () => { const { data } = await api.get<{ data: Stats }>("/platform/subscriptions/stats"); return data.data; },
  });

  // List
  const { data: listRes, isLoading: listLoading, refetch } = useQuery({
    queryKey: ["sub-list", page, search, planFilter, statusFilter, renewalFilter],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit: 20, search, status: statusFilter };
      if (planFilter) params.plan = planFilter;
      if (renewalFilter !== "ALL") params.renewalWindow = renewalFilter;
      const { data } = await api.get<{ data: SubRow[]; meta: any }>("/platform/subscriptions", { params });
      return data;
    },
  });

  // Charts
  const { data: charts } = useQuery<ChartData>({
    queryKey: ["sub-charts"],
    queryFn: async () => { const { data } = await api.get<{ data: ChartData }>("/platform/subscriptions/charts"); return data.data; },
    enabled: tab === "analytics",
  });

  // Bulk mutation
  const bulkMutation = useMutation({
    mutationFn: async (payload: { ids: string[]; action: string; planName?: string }) => {
      const { data } = await api.post("/platform/subscriptions/bulk", payload);
      return data;
    },
    onSuccess: (_, { action }) => {
      qc.invalidateQueries({ queryKey: ["sub-list"] });
      qc.invalidateQueries({ queryKey: ["sub-stats"] });
      setSelectedIds(new Set());
      toast.success(`Bulk ${action.toLowerCase().replace("_", " ")} completed`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Bulk action failed"),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const handleSelectAll = () => {
    if (!listRes) return;
    setSelectedIds(selectedIds.size === listRes.data.length ? new Set() : new Set(listRes.data.map((s) => s.id)));
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 bg-slate-50 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Subscription Management</h1>
          <p className="text-slate-500 mt-1">Manage plans, billing, and revenue across all tenants.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-white border border-slate-200 rounded-lg p-0.5 flex shadow-sm">
            <button onClick={() => setTab("subscriptions")} className={cn("px-4 py-2 rounded-md text-sm font-semibold transition-all", tab === "subscriptions" ? "bg-brand-600 text-white shadow" : "text-slate-600 hover:text-slate-900")}>
              <CreditCard className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Subscriptions
            </button>
            <button onClick={() => setTab("analytics")} className={cn("px-4 py-2 rounded-md text-sm font-semibold transition-all", tab === "analytics" ? "bg-brand-600 text-white shadow" : "text-slate-600 hover:text-slate-900")}>
              <BarChart3 className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Analytics
            </button>
          </div>
        </div>
      </div>

      {tab === "subscriptions" ? (
        <>
          {/* KPI Cards (8) */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <KpiCard label="MRR" value={stats ? formatCurrency(stats.mrr) : "--"} loading={statsLoading} color="indigo" icon={<DollarSign className="w-4 h-4" />} />
            <KpiCard label="ARR" value={stats ? formatCurrency(stats.arr) : "--"} loading={statsLoading} color="blue" icon={<TrendingUp className="w-4 h-4" />} />
            <KpiCard label="Today" value={stats ? formatCurrency(stats.todaysRevenue) : "--"} loading={statsLoading} color="emerald" icon={<DollarSign className="w-4 h-4" />} />
            <KpiCard label="Monthly" value={stats ? formatCurrency(stats.monthlyRevenue) : "--"} loading={statsLoading} color="violet" icon={<Calendar className="w-4 h-4" />} />
            <KpiCard label="Renewals" value={stats?.renewalsThisMonth?.toString() ?? "--"} loading={statsLoading} color="amber" icon={<RefreshCw className="w-4 h-4" />} />
            <KpiCard label="Outstanding" value={stats ? formatCurrency(stats.outstanding) : "--"} loading={statsLoading} color="red" icon={<AlertTriangle className="w-4 h-4" />} />
            <KpiCard label="Collection" value={stats ? `${stats.collectionRate}%` : "--"} loading={statsLoading} color="teal" icon={<Percent className="w-4 h-4" />} />
            <KpiCard label="ARPT" value={stats ? formatCurrency(stats.arpt) : "--"} loading={statsLoading} color="slate" icon={<Target className="w-4 h-4" />} />
          </div>

          {/* Table Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-4 bg-slate-50/50">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="Search by tenant, code, owner..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 placeholder:text-slate-400" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); setPage(1); }}
                  className="bg-white border border-slate-300 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/20 text-slate-700 font-medium">
                  <option value="">All Plans</option>
                  <option value="Free">Free</option>
                  <option value="Standard">Standard</option>
                  <option value="Professional">Professional</option>
                  <option value="Enterprise">Enterprise</option>
                </select>
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  className="bg-white border border-slate-300 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/20 text-slate-700 font-medium">
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="TRIAL">Trial</option>
                  <option value="PAUSED">Paused</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
                <select value={renewalFilter} onChange={(e) => { setRenewalFilter(e.target.value); setPage(1); }}
                  className="bg-white border border-slate-300 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/20 text-slate-700 font-medium hidden md:block">
                  <option value="ALL">Renewal</option>
                  <option value="7_DAYS">7 Days</option>
                  <option value="30_DAYS">30 Days</option>
                  <option value="90_DAYS">90 Days</option>
                  <option value="OVERDUE">Overdue</option>
                </select>
                <button onClick={() => refetch()} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 shadow-sm"><RefreshCw className={cn("w-4 h-4", listLoading && "animate-spin")} /></button>
                <button onClick={() => setShowExport(true)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                  <Download className="w-4 h-4" /> Export
                </button>
              </div>
            </div>

            {/* Bulk Actions Bar */}
            <AnimatePresence>
              {selectedIds.size > 0 && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="px-4 py-3 bg-brand-50 border-b border-brand-100 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-brand-700 mr-2">{selectedIds.size} selected</span>
                    {[
                      { action: "UPGRADE", label: "Upgrade", icon: ArrowUpCircle, color: "indigo" },
                      { action: "DOWNGRADE", label: "Downgrade", icon: ArrowDownCircle, color: "slate" },
                      { action: "RENEW", label: "Renew", icon: RefreshCw, color: "emerald" },
                      { action: "PAUSE", label: "Pause", icon: Pause, color: "amber" },
                      { action: "RESUME", label: "Resume", icon: Play, color: "blue" },
                      { action: "SUSPEND", label: "Suspend", icon: Ban, color: "red" },
                      { action: "EMAIL_REMINDER", label: "Remind", icon: Mail, color: "indigo" },
                      { action: "GENERATE_INVOICE", label: "Invoice", icon: FileText, color: "emerald" },
                    ].map((b) => {
                      const Icon = b.icon;
                      return (
                        <button key={b.action} onClick={() => bulkMutation.mutate({ ids: Array.from(selectedIds), action: b.action })} disabled={bulkMutation.isPending}
                          className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
                            `bg-${b.color}-50 text-${b.color}-700 border-${b.color}-200 hover:bg-${b.color}-100`)}>
                          <Icon className="w-3.5 h-3.5" /> {b.label}
                        </button>
                      );
                    })}
                    <button onClick={() => setSelectedIds(new Set())} className="ml-auto p-1.5 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Table */}
            <div className="overflow-x-auto min-h-[400px]">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="px-4 py-3 w-10 text-center">
                      <input type="checkbox" checked={!!listRes && listRes.data.length > 0 && selectedIds.size === listRes.data.length} onChange={handleSelectAll}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-600/20" />
                    </th>
                    <th className="px-4 py-3 font-semibold">Tenant</th>
                    <th className="px-4 py-3 font-semibold">Owner</th>
                    <th className="px-4 py-3 font-semibold">Plan</th>
                    <th className="px-4 py-3 font-semibold text-right">MRR</th>
                    <th className="px-4 py-3 font-semibold">Cycle</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Renewal</th>
                    <th className="px-4 py-3 font-semibold text-center">Auto</th>
                    <th className="px-4 py-3 font-semibold">Payment</th>
                    <th className="px-4 py-3 font-semibold">Usage</th>
                    <th className="px-4 py-3 font-semibold">Health</th>
                    <th className="px-4 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {listLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {Array.from({ length: 13 }).map((__, j) => (
                          <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-full max-w-[80px]" /></td>
                        ))}
                      </tr>
                    ))
                  ) : !listRes || listRes.data.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-4 py-16 text-center">
                        <CreditCard className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-slate-900 mb-1">No subscriptions found</h3>
                        <p className="text-slate-500 text-sm">Try adjusting your filters.</p>
                      </td>
                    </tr>
                  ) : (
                    listRes.data.map((s) => {
                      const sb = STATUS_BADGE[s.status] || STATUS_BADGE["ACTIVE"]!;
                      const pb = PLAN_BADGE[s.planName] || PLAN_BADGE["Free"]!;
                      const hb = HEALTH_BADGE[s.health] || HEALTH_BADGE["HEALTHY"]!;
                      const pmb = PAYMENT_BADGE[s.paymentStatus] || PAYMENT_BADGE["PAID"]!;
                      return (
                        <tr key={s.id} className="hover:bg-slate-50/80 transition-colors group">
                          <td className="px-4 py-3 text-center">
                            <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-600/20" />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold shrink-0">{s.tenant.name.slice(0, 2).toUpperCase()}</div>
                              <div>
                                <p className="font-bold text-slate-900 text-xs leading-tight">{s.tenant.name}</p>
                                <p className="text-[10px] text-slate-500 font-mono">{s.tenant.tenantCode || "--"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {s.owner ? (
                              <div>
                                <p className="text-xs font-medium text-slate-900">{s.owner.name}</p>
                                <p className="text-[10px] text-slate-500">{s.owner.email}</p>
                              </div>
                            ) : <span className="text-slate-400 text-xs">--</span>}
                          </td>
                          <td className="px-4 py-3"><span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide", pb)}>{s.planName}</span></td>
                          <td className="px-4 py-3 text-right font-medium text-slate-900 tabular-nums text-xs">{formatCurrency(s.mrr)}</td>
                          <td className="px-4 py-3 text-xs text-slate-600 capitalize">{s.billingCycle.toLowerCase()}</td>
                          <td className="px-4 py-3"><span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ring-1", sb.bg, sb.text)}>{sb.label}</span></td>
                          <td className="px-4 py-3">
                            <p className="text-xs text-slate-900">{new Date(s.validUntil).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</p>
                            <p className="text-[10px] text-slate-500">{daysUntil(s.validUntil)}</p>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn("w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px]", s.autoRenew ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")}>
                              {s.autoRenew ? "✓" : "✗"}
                            </span>
                          </td>
                          <td className="px-4 py-3"><span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold", pmb.bg, pmb.text)}>{s.paymentStatus}</span></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className={cn("h-full rounded-full", s.usagePercent > 80 ? "bg-red-500" : s.usagePercent > 50 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(s.usagePercent, 100)}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-500 tabular-nums">{s.usagePercent}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1.5 text-xs">
                              <span className={cn("w-2 h-2 rounded-full shrink-0", hb.dot)} />
                              <span className="text-slate-600 font-medium">{hb.label}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => setSelectedSubId(s.id)} className="p-1.5 rounded-md text-slate-400 hover:text-brand-600 hover:bg-brand-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all">
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-white">
              <p className="text-sm text-slate-500">
                Showing <span className="font-medium text-slate-900">{listRes?.data.length ? (page - 1) * 20 + 1 : 0}</span>–<span className="font-medium text-slate-900">{Math.min(listRes?.meta.total || 0, page * 20)}</span> of <span className="font-medium text-slate-900">{listRes?.meta.total || 0}</span>
              </p>
              <div className="flex items-center gap-1">
                <button disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"><ChevronLeft className="w-4 h-4" /></button>
                {Array.from({ length: Math.min(5, listRes?.meta.totalPages || 1) }).map((_, i) => (
                  <button key={i + 1} onClick={() => setPage(i + 1)} className={cn("px-3 py-1.5 rounded text-sm font-medium", page === i + 1 ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50")}>{i + 1}</button>
                ))}
                <button disabled={!listRes || page >= listRes.meta.totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Analytics Tab */
        <AnalyticsView charts={charts} />
      )}

      {/* Modals & Drawers */}
      <SubscriptionDrawer subscriptionId={selectedSubId} onClose={() => setSelectedSubId(null)} onChangePlan={(id: string, plan: string) => { setSelectedSubId(null); setShowChangePlan({ id, currentPlan: plan }); }} />
      <SubscriptionExportModal open={showExport} onClose={() => setShowExport(false)} filters={{ search, plan: planFilter, status: statusFilter }} selectedIds={Array.from(selectedIds)} />
      {showChangePlan && <ChangePlanModal subscriptionId={showChangePlan.id} currentPlan={showChangePlan.currentPlan} onClose={() => setShowChangePlan(null)} />}
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, loading, color, icon }: { label: string; value: string; loading: boolean; color: string; icon: React.ReactNode }) {
  const colors: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-600", blue: "bg-blue-50 text-blue-600", emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600", amber: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600",
    teal: "bg-teal-50 text-teal-600", slate: "bg-slate-50 text-slate-600",
  };
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col gap-2">
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", colors[color])}>{icon}</div>
      <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
      {loading ? <div className="h-6 w-20 bg-slate-200 animate-pulse rounded" /> : <p className="text-xl font-extrabold text-slate-900 tracking-tight leading-none">{value}</p>}
    </div>
  );
}

// ── Analytics View ───────────────────────────────────────────────────────────

function AnalyticsView({ charts }: { charts: ChartData | undefined }) {
  if (!charts) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-80 bg-white border border-slate-200 rounded-2xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* MRR Trend */}
      <ChartCard title="MRR Trend" subtitle="Monthly recurring revenue over time">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={charts.mrrTrend}>
            <defs><linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
            <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="url(#mrrGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Plan Distribution */}
      <ChartCard title="Plan Distribution" subtitle="Active subscriptions by plan">
        <ResponsiveContainer width="100%" height={260}>
          <RPieChart>
            <Pie data={charts.planDistribution} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
              {charts.planDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </RPieChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Renewal Trend */}
      <ChartCard title="Renewal Trend" subtitle="Renewals per month">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={charts.renewalTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <Tooltip />
            <Bar dataKey="renewals" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Churn Trend */}
      <ChartCard title="Churn Trend" subtitle="Cancellations & expirations per month">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={charts.churnTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <Tooltip />
            <Line type="monotone" dataKey="churn" stroke="#ef4444" strokeWidth={2} dot={{ fill: "#ef4444", r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Status Distribution */}
      <ChartCard title="Status Distribution" subtitle="All subscriptions by status">
        <ResponsiveContainer width="100%" height={260}>
          <RPieChart>
            <Pie data={charts.statusDistribution} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
              {charts.statusDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </RPieChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Revenue Growth (reuse MRR trend as line) */}
      <ChartCard title="Revenue Growth" subtitle="Cumulative revenue progression">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={charts.mrrTrend}>
            <defs><linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} /><stop offset="95%" stopColor="#06b6d4" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
            <Area type="monotone" dataKey="revenue" stroke="#06b6d4" fill="url(#revGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-5 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
