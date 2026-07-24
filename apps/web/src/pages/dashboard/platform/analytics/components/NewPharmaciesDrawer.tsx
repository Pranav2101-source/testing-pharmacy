import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "../analytics.api";
import { getDownloadErrorMessage } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow, isToday, format } from "date-fns";
import {
  X, Search, Download, Building2, MoreVertical, Copy, Eye, CreditCard,
  Loader2, Filter, ChevronLeft, ChevronRight, AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";

type NewPharmaciesDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  days: number;
  onTenantClick: (tenantId: string) => void;
};

export function NewPharmaciesDrawer({ isOpen, onClose, days, onTenantClick }: NewPharmaciesDrawerProps) {
  const navigate = useNavigate();
  const toast = useToast();
  
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [plan, setPlan] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [sort, setSort] = useState<string>("newest");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Search debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset page on search
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [plan, status, sort, limit]);

  useEffect(() => {
    if (!isOpen) return;
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = originalStyle; };
  }, [isOpen]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["newPharmacies", days, page, limit, debouncedSearch, plan, status, sort],
    queryFn: () => analyticsApi.getNewPharmacies({
      days,
      page,
      limit,
      search: debouncedSearch || undefined,
      plan: plan || undefined,
      status: status || undefined,
      sort
    }),
    enabled: isOpen,
    staleTime: 60000,
  });

  const handleExport = async () => {
    try {
      await analyticsApi.exportNewPharmacies({
        days,
        search: debouncedSearch || undefined,
        plan: plan || undefined,
        status: status || undefined,
        sort
      });
      toast.success("Export downloaded.");
    } catch (e) {
      // Downloads come back as blobs, so a JSON error body is unreadable to the plain
      // extractor — this reads it back and surfaces the server's actual reason.
      toast.error(await getDownloadErrorMessage(e, "Couldn't export the list. Please try again."));
    }
  };

  const clearFilters = () => {
    setSearch("");
    setPlan("");
    setStatus("");
    setSort("newest");
    setPage(1);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
    setOpenDropdownId(null);
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[60]" // z-[60] so it stacks nicely
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-[60] flex flex-col border-l border-slate-200 overflow-hidden"
          >
            {/* Header */}
            <div className="bg-white border-b border-slate-100 p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">New Pharmacies</h2>
                  <p className="text-sm text-slate-500">Last {days} Days</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleExport} className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                    <Download className="w-4 h-4" /> Export CSV
                  </button>
                  <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Summary Stats */}
              {data && (
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                    <p className="text-xs text-slate-500 font-medium">Total</p>
                    <p className="text-lg font-bold text-slate-900">{data.summary.total}</p>
                  </div>
                  <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100 text-center">
                    <p className="text-xs text-emerald-600 font-medium">Active</p>
                    <p className="text-lg font-bold text-emerald-700">{data.summary.active}</p>
                  </div>
                  <div className="p-3 bg-red-50/50 rounded-xl border border-red-100 text-center">
                    <p className="text-xs text-red-600 font-medium">Suspended</p>
                    <p className="text-lg font-bold text-red-700">{data.summary.suspended}</p>
                  </div>
                  <div className="p-3 bg-slate-100/50 rounded-xl border border-slate-200 text-center">
                    <p className="text-xs text-slate-500 font-medium">Archived</p>
                    <p className="text-lg font-bold text-slate-700">{data.summary.archived}</p>
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="flex items-center gap-2 pt-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by name, code, owner..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  />
                </div>
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">All Plans</option>
                  <option value="Free">Free</option>
                  <option value="Standard">Standard</option>
                  <option value="Professional">Professional</option>
                  <option value="Enterprise">Enterprise</option>
                </select>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">All Statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="TRIAL">Trial</option>
                  <option value="PENDING">Pending</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="alphabetical">Alphabetical</option>
                </select>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto bg-slate-50/50 p-6 relative">
              {isError ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
                  <p className="text-sm font-medium text-slate-800 mb-1">Unable to load new pharmacies.</p>
                  <p className="text-xs text-slate-500 mb-4">There was an error fetching the data from the server.</p>
                  <button onClick={() => refetch()} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors">
                    Retry
                  </button>
                </div>
              ) : isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-24 bg-white border border-slate-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : data?.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Building2 className="w-12 h-12 text-slate-200 mb-4" />
                  {search || plan || status ? (
                    <>
                      <h3 className="text-sm font-medium text-slate-900 mb-1">No pharmacies match your filters.</h3>
                      <button onClick={clearFilters} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
                        Clear Filters
                      </button>
                    </>
                  ) : (
                    <h3 className="text-sm font-medium text-slate-900 mb-1">No new pharmacies were created during the last {days} days.</h3>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {data?.items.map((item) => {
                    const isNewToday = isToday(new Date(item.createdAt));
                    
                    return (
                      <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 hover:border-brand-200 transition-colors relative group">
                        <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                          {item.logoUrl ? (
                            <img src={item.logoUrl} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-lg font-bold text-slate-400">{item.name.slice(0, 2).toUpperCase()}</span>
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-900 truncate cursor-pointer hover:text-brand-600" onClick={() => onTenantClick(item.id)}>
                                {item.name}
                              </h3>
                              {isNewToday && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-700">NEW</span>
                              )}
                            </div>
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-xs font-bold",
                              item.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" :
                              item.status === "SUSPENDED" ? "bg-red-100 text-red-700" :
                              item.status === "TRIAL" ? "bg-blue-100 text-blue-700" :
                              "bg-slate-100 text-slate-600"
                            )}>
                              {item.status}
                            </span>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span>Code: <span className="font-medium text-slate-700">{item.tenantCode || "--"}</span></span>
                            <span>Owner: <span className="font-medium text-slate-700">{item.ownerName}</span></span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded font-medium",
                              `bg-${item.plan.color}-50 text-${item.plan.color}-700`
                            )}>
                              {item.plan.name}
                            </span>
                            <div className="flex flex-col ml-auto text-right">
                              <span className="font-medium text-slate-700">
                                {format(new Date(item.createdAt), "MMM d, yyyy • h:mm a")}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                Created {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Row Actions Menu */}
                        <div className="relative">
                          <button
                            onClick={() => setOpenDropdownId(openDropdownId === item.id ? null : item.id)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          
                          {openDropdownId === item.id && (
                            <>
                              <div className="fixed inset-0 z-[65]" onClick={() => setOpenDropdownId(null)} />
                              <div className="absolute right-0 top-8 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-[70] py-1">
                                <button
                                  onClick={() => {
                                    setOpenDropdownId(null);
                                    onTenantClick(item.id);
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <Eye className="w-4 h-4" /> View Tenant
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenDropdownId(null);
                                    navigate(`/dashboard/subscriptions?tenantId=${item.id}`);
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <CreditCard className="w-4 h-4" /> View Subscription
                                </button>
                                <div className="h-px bg-slate-100 my-1" />
                                <button
                                  onClick={() => copyToClipboard(item.tenantCode || "", "Tenant Code")}
                                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <Copy className="w-4 h-4" /> Copy Tenant ID
                                </button>
                                <button
                                  onClick={() => copyToClipboard(item.ownerEmail, "Owner Email")}
                                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <Copy className="w-4 h-4" /> Copy Owner Email
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pagination & Limit */}
            <div className="bg-white border-t border-slate-100 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span>Rows per page:</span>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  disabled={isLoading || isError}
                  className="border border-slate-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
                {data && (
                  <span className="ml-2">
                    Showing {(page - 1) * limit + 1} - {Math.min(page * limit, data.pagination.total)} of {data.pagination.total}
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1 || isLoading || isError}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={!data || page >= data.pagination.totalPages || isLoading || isError}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
