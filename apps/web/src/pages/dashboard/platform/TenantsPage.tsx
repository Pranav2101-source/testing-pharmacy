import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  Building2, Users, Search, Filter,
  MoreVertical, RefreshCw, Upload, Download, Plus, ChevronLeft, ChevronRight, X, User, Loader2,
  Ban, CheckCircle2, Archive, Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TenantDrawer } from "./components/TenantDrawer";
import { NewPharmacyWizard } from "./components/NewPharmacyWizard";
import { ImportModal } from "./components/ImportModal";
import { ExportDropdown } from "./components/ExportDropdown";
import { motion, AnimatePresence } from "framer-motion";
import { ResponsiveContainer, AreaChart, Area } from "recharts";

type Tenant = {
  id: string;
  tenantCode: string | null;
  name: string;
  slug: string;
  logoUrl: string | null;
  state: string | null;
  city: string | null;
  isActive: boolean;
  tenantStatus: string;
  createdAt: string;
  doctorsCount: number;
  patientsCount: number;
  owner: { name: string; email: string } | null;
  subscription: { planName: string; status: string; validUntil: string } | null;
};

type TenantsResponse = {
  data: Tenant[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

const dummySparklineData = [
  { value: 400 }, { value: 300 }, { value: 550 }, { value: 450 }, { value: 700 }
];

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE: { bg: "bg-emerald-50 ring-emerald-600/20", text: "text-emerald-700", label: "Active" },
  TRIAL: { bg: "bg-blue-50 ring-blue-600/20", text: "text-blue-700", label: "Trial" },
  SUSPENDED: { bg: "bg-red-50 ring-red-600/20", text: "text-red-700", label: "Suspended" },
  ARCHIVED: { bg: "bg-slate-50 ring-slate-600/20", text: "text-slate-500", label: "Archived" },
  PENDING: { bg: "bg-amber-50 ring-amber-600/20", text: "text-amber-700", label: "Pending" },
  EXPIRED: { bg: "bg-orange-50 ring-orange-600/20", text: "text-orange-700", label: "Expired" },
};

const PLAN_BADGE: Record<string, string> = {
  Free: "bg-slate-100 text-slate-600",
  Standard: "bg-indigo-100 text-indigo-700",
  Professional: "bg-violet-100 text-violet-700",
};

export default function TenantsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [plan, setPlan] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals & Drawers
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(searchParams.get("id"));

  useEffect(() => {
    if (selectedTenantId) {
      setSearchParams({ id: selectedTenantId });
    } else {
      setSearchParams(new URLSearchParams());
    }
  }, [selectedTenantId, setSearchParams]);

  // Modal states
  const [showNewPharmacy, setShowNewPharmacy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Loading states
  const [isExporting, setIsExporting] = useState(false);

  const toast = useToast();
  const qc = useQueryClient();

  const { data: res, isLoading, isError, refetch } = useQuery<TenantsResponse>({
    queryKey: ["platform-tenants", page, search, status, plan, stateFilter],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit: 15, search, status };
      if (plan) params.plan = plan;
      if (stateFilter) params.state = stateFilter;
      const { data } = await api.get<{ data: Tenant[]; meta: any }>("/platform/tenants", { params });
      return data;
    },
  });

  // Bulk actions
  const bulkMutation = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: string }) => {
      const { data } = await api.post("/platform/tenants/bulk", { ids, action });
      return data;
    },
    onSuccess: (_, { action }) => {
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      setSelectedIds(new Set());
      toast.success(`Bulk ${action.toLowerCase()} completed`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Bulk action failed");
    },
  });

  const handleSelectAll = () => {
    if (!res) return;
    if (selectedIds.size === res.data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(res.data.map((t) => t.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 bg-slate-50 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Tenant Management</h1>
          <p className="text-slate-500 mt-1">Manage all pharmacies, subscriptions, and platform health.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => refetch()} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 shadow-sm transition-colors" title="Refresh">
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
          >
            <Upload className="w-4 h-4" /> Import
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          <button
            onClick={() => setShowNewPharmacy(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 rounded-lg text-sm font-semibold text-white shadow-sm hover:bg-brand-500 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Pharmacy
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard title="Total Pharmacies" value={res?.meta.total.toString() ?? "--"} isLoading={isLoading} icon={<Building2 />} color="indigo" />
        <KpiCard title="Active Pharmacies" value={res ? res.data.filter(t => t.isActive).length.toString() : "--"} isLoading={isLoading} icon={<CheckCircle2Icon />} color="emerald" />
        <KpiCard title="Total Doctors" value={res ? res.data.reduce((acc, t) => acc + t.doctorsCount, 0).toString() : "--"} isLoading={isLoading} icon={<Users />} color="blue" />
        <KpiCard title="Total Patients" value={res ? res.data.reduce((acc, t) => acc + t.patientsCount, 0).toString() : "--"} isLoading={isLoading} icon={<Users />} color="amber" />
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-4 bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ID, Name, Owner, GST..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all placeholder:text-slate-400"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <select
                value={status}
                onChange={e => { setStatus(e.target.value); setPage(1); }}
                className="bg-white border border-slate-300 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-700 font-medium"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="TRIAL">Trial</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="ARCHIVED">Archived</option>
                <option value="PENDING">Pending</option>
                <option value="EXPIRED">Expired</option>
              </select>
            </div>
            <select
              value={plan}
              onChange={e => { setPlan(e.target.value); setPage(1); }}
              className="bg-white border border-slate-300 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-700 font-medium hidden md:block"
            >
              <option value="">All Plans</option>
              <option value="Free">Free</option>
              <option value="Standard">Standard</option>
              <option value="Professional">Professional</option>
            </select>
            <select
              value={stateFilter}
              onChange={e => { setStateFilter(e.target.value); setPage(1); }}
              className="bg-white border border-slate-300 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 text-slate-700 font-medium hidden lg:block"
            >
              <option value="">All States</option>
              <option value="Maharashtra">Maharashtra</option>
              <option value="Karnataka">Karnataka</option>
              <option value="Delhi">Delhi</option>
              <option value="Tamil Nadu">Tamil Nadu</option>
            </select>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        <AnimatePresence>
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 py-3 bg-brand-50 border-b border-brand-100 flex items-center gap-3">
                <span className="text-sm font-semibold text-brand-700">{selectedIds.size} selected</span>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={() => bulkMutation.mutate({ ids: Array.from(selectedIds), action: "ACTIVATE" })}
                    disabled={bulkMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Activate
                  </button>
                  <button
                    onClick={() => bulkMutation.mutate({ ids: Array.from(selectedIds), action: "SUSPEND" })}
                    disabled={bulkMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" /> Suspend
                  </button>
                  <button
                    onClick={() => bulkMutation.mutate({ ids: Array.from(selectedIds), action: "ARCHIVE" })}
                    disabled={bulkMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-colors"
                  >
                    <Archive className="w-3.5 h-3.5" /> Archive
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table */}
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <th className="px-6 py-3 font-semibold w-12 text-center">
                  <input
                    type="checkbox"
                    checked={!!res && res.data.length > 0 && selectedIds.size === res.data.length}
                    onChange={handleSelectAll}
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-600/20"
                  />
                </th>
                <th className="px-6 py-3 font-semibold">Tenant</th>
                <th className="px-6 py-3 font-semibold">Subscription</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">Owner</th>
                <th className="px-6 py-3 font-semibold text-right">Doctors</th>
                <th className="px-6 py-3 font-semibold text-right">Patients</th>
                <th className="px-6 py-3 font-semibold">Storage</th>
                <th className="px-6 py-3 font-semibold w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-4 w-4 bg-slate-200 rounded mx-auto" /></td>
                    <td className="px-6 py-4 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-200" />
                      <div>
                        <div className="h-4 w-32 bg-slate-200 rounded mb-1" />
                        <div className="h-3 w-20 bg-slate-100 rounded" />
                      </div>
                    </td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-200 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-5 w-16 bg-slate-200 rounded-full" /></td>
                    <td className="px-6 py-4">
                      <div className="h-4 w-24 bg-slate-200 rounded mb-1" />
                      <div className="h-3 w-32 bg-slate-100 rounded" />
                    </td>
                    <td className="px-6 py-4 text-right"><div className="h-4 w-8 bg-slate-200 rounded ml-auto" /></td>
                    <td className="px-6 py-4 text-right"><div className="h-4 w-8 bg-slate-200 rounded ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-12 bg-slate-200 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-6 w-6 bg-slate-200 rounded mx-auto" /></td>
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-red-500">
                    Failed to load tenants. <button onClick={() => refetch()} className="underline font-medium hover:text-red-700">Retry</button>
                  </td>
                </tr>
              ) : res?.data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center">
                    <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
                      <Search className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-1">No tenants found</h3>
                    <p className="text-slate-500 max-w-sm mx-auto">We couldn't find any tenants matching your current filters. Try adjusting your search criteria.</p>
                    <button onClick={() => { setSearch(""); setStatus("ALL"); setPlan(""); setStateFilter(""); }} className="mt-4 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                      Clear Filters
                    </button>
                  </td>
                </tr>
              ) : (
                res?.data.map((t) => {
                  const statusBadge = STATUS_BADGE[t.tenantStatus] || STATUS_BADGE["ACTIVE"]!;
                  const planBadge = t.subscription ? PLAN_BADGE[t.subscription.planName] || PLAN_BADGE["Free"] : "";
                  return (
                    <tr key={t.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="px-6 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-600/20"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs ring-1 ring-indigo-200/50 shrink-0">
                            {t.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 leading-tight">{t.name}</div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">{t.tenantCode || t.id.split("-")[0]}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {t.subscription ? (
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide", planBadge)}>
                            {t.subscription.planName}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic text-xs">Not Configured</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase ring-1",
                          statusBadge.bg, statusBadge.text
                        )}>
                          {statusBadge.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {t.owner ? (
                          <div>
                            <div className="font-medium text-slate-900 leading-tight flex items-center gap-1.5">
                              <User className="w-3 h-3 text-slate-400" /> {t.owner.name}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{t.owner.email}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">--</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-slate-700 tabular-nums">{t.doctorsCount}</td>
                      <td className="px-6 py-4 text-right font-medium text-slate-700 tabular-nums">{t.patientsCount}</td>
                      <td className="px-6 py-4 text-slate-500 italic">--</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end">
                          <button onClick={() => setSelectedTenantId(t.id)} className="p-1.5 rounded-md text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
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
          <div className="text-sm text-slate-500">
            Showing <span className="font-medium text-slate-900">{res?.data.length ? ((page - 1) * 15) + 1 : 0}</span> to <span className="font-medium text-slate-900">{Math.min(res?.meta.total || 0, page * 15)}</span> of <span className="font-medium text-slate-900">{res?.meta.total || 0}</span> tenants
          </div>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="p-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, res?.meta.totalPages || 1) }).map((_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={cn(
                    "px-3 py-1.5 rounded text-sm font-medium transition-colors",
                    page === pageNum ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {pageNum}
                </button>
              )
            })}
            {res && res.meta.totalPages > 5 && <span className="px-2 text-slate-400">...</span>}
            <button
              disabled={!res || page >= res.meta.totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modals & Drawers */}
      <TenantDrawer
        tenantId={selectedTenantId}
        onClose={() => setSelectedTenantId(null)}
      />
      <NewPharmacyWizard
        open={showNewPharmacy}
        onClose={() => setShowNewPharmacy(false)}
      />
      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
      />
      <ExportDropdown
        open={showExport}
        onClose={() => setShowExport(false)}
        filters={{ search, status, plan, state: stateFilter }}
        selectedIds={Array.from(selectedIds)}
      />
    </div>
  );
}

// ─── Extracted KPI Card Component to avoid duplication ────────────────────
function KpiCard({ title, value, isLoading, icon, color }: any) {
  const colorMap = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    blue: "bg-blue-50 text-blue-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-50 text-slate-600",
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col relative overflow-hidden group">
      <div className="flex justify-between items-start mb-4">
        <div className={cn("p-3 rounded-xl", colorMap[color as keyof typeof colorMap])}>
          {icon}
        </div>
      </div>
      <h3 className="text-slate-500 font-medium text-sm">{title}</h3>
      {isLoading ? (
        <div className="h-9 w-24 bg-slate-200 animate-pulse rounded mt-1" />
      ) : (
        <p className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">{value}</p>
      )}

      {/* Sparkline decorative background */}
      <div className="absolute bottom-0 left-0 right-0 h-16 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dummySparklineData}>
            <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#6366f1" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
// ─── Simple CheckCircle2 icon ────────────────────────────────────────────
function CheckCircle2Icon(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check-circle-2" {...props}><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
}
