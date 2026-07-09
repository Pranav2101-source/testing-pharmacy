import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  X, Building2, Calendar, MapPin, CheckCircle2, AlertTriangle, CreditCard, HardDrive,
  Zap, Clock, Users, User, Stethoscope, Shield, Ban, Archive, Activity, Settings, BarChart3,
  FileText, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TenantDrawerProps = {
  tenantId: string | null;
  onClose: () => void;
};

const TABS = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "subscription", label: "Subscription", icon: CreditCard },
  { key: "health", label: "Health", icon: Zap },
  { key: "features", label: "Features", icon: Settings },
  { key: "activity", label: "Activity", icon: Activity },
] as const;

const STATUS_ACTIONS: Record<string, Array<{ label: string; status: string; color: string; icon: any }>> = {
  ACTIVE: [
    { label: "Suspend", status: "SUSPENDED", color: "red", icon: Ban },
    { label: "Archive", status: "ARCHIVED", color: "slate", icon: Archive },
  ],
  TRIAL: [
    { label: "Activate", status: "ACTIVE", color: "emerald", icon: CheckCircle2 },
    { label: "Suspend", status: "SUSPENDED", color: "red", icon: Ban },
  ],
  SUSPENDED: [
    { label: "Reactivate", status: "ACTIVE", color: "emerald", icon: CheckCircle2 },
    { label: "Archive", status: "ARCHIVED", color: "slate", icon: Archive },
  ],
  ARCHIVED: [
    { label: "Reactivate", status: "ACTIVE", color: "emerald", icon: CheckCircle2 },
  ],
  PENDING: [
    { label: "Activate", status: "ACTIVE", color: "emerald", icon: CheckCircle2 },
  ],
  EXPIRED: [
    { label: "Reactivate", status: "ACTIVE", color: "emerald", icon: CheckCircle2 },
    { label: "Archive", status: "ARCHIVED", color: "slate", icon: Archive },
  ],
};

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Active" },
  TRIAL: { bg: "bg-blue-100", text: "text-blue-700", label: "Trial" },
  SUSPENDED: { bg: "bg-red-100", text: "text-red-700", label: "Suspended" },
  ARCHIVED: { bg: "bg-slate-100", text: "text-slate-500", label: "Archived" },
  PENDING: { bg: "bg-amber-100", text: "text-amber-700", label: "Pending" },
  EXPIRED: { bg: "bg-orange-100", text: "text-orange-700", label: "Expired" },
};

export function TenantDrawer({ tenantId, onClose }: TenantDrawerProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>("overview");
  const toast = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (!tenantId) return undefined;
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = originalStyle; };
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) setActiveTab("overview");
  }, [tenantId]);

  const { data: tenant, isLoading } = useQuery({
    queryKey: ["platform-tenant", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data } = await api.get<{ data: any }>(`/platform/tenants/${tenantId}`);
      return data.data;
    },
    enabled: !!tenantId,
  });

  const { data: activity } = useQuery({
    queryKey: ["platform-tenant-activity", tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data } = await api.get<{ data: any }>(`/platform/tenants/${tenantId}/activity`);
      return data.data;
    },
    enabled: !!tenantId && activeTab === "activity",
  });

  const { data: health } = useQuery({
    queryKey: ["platform-tenant-health", tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data } = await api.get<{ data: any }>(`/platform/tenants/${tenantId}/health`);
      return data.data;
    },
    enabled: !!tenantId && activeTab === "health",
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data } = await api.patch(`/platform/tenants/${id}/status`, { status });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-tenant", tenantId] });
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      toast.success("Tenant status updated");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Status update failed");
    },
  });

  return (
    <>
      <AnimatePresence>
        {tenantId && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-50"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {tenantId && (
          <motion.div
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 overflow-hidden"
          >
            {isLoading ? (
              <div className="flex-1 p-8 space-y-6">
                <div className="h-16 bg-slate-100 animate-pulse rounded-2xl" />
                <div className="h-40 bg-slate-100 animate-pulse rounded-2xl" />
                <div className="space-y-3">
                  <div className="h-4 w-1/3 bg-slate-100 animate-pulse rounded" />
                  <div className="h-4 w-1/2 bg-slate-100 animate-pulse rounded" />
                </div>
              </div>
            ) : tenant ? (
              <>
                {/* Header Profile */}
                <div className="bg-slate-50 border-b border-slate-100 p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-2xl rounded-2xl ring-4 ring-white shadow-sm shrink-0">
                        {tenant.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900">{tenant.name}</h2>
                        <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                          <span className="flex items-center gap-1 font-mono text-xs bg-slate-200/50 px-1.5 py-0.5 rounded text-slate-600">
                            {tenant.tenantCode || tenant.id.split("-")[0]}
                          </span>
                          {tenant.city && tenant.state && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5" /> {tenant.city}, {tenant.state}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" /> {format(new Date(tenant.createdAt), "MMM d, yyyy • h:mm a")}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Action Bar */}
                  <div className="flex items-center gap-2 mt-6 flex-wrap">
                    {(() => {
                      const badge = STATUS_BADGE[tenant.tenantStatus] || STATUS_BADGE["ACTIVE"]!;
                      return (
                        <span className={cn("px-2.5 py-1 rounded-full text-xs font-bold tracking-wide uppercase", badge.bg, badge.text)}>
                          {badge.label}
                        </span>
                      );
                    })()}
                    {tenant.subscription && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
                        {tenant.subscription.planName}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      {(STATUS_ACTIONS[tenant.tenantStatus] || []).map((action) => {
                        const Icon = action.icon;
                        const colorClasses = {
                          emerald: "bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100",
                          red: "bg-red-50 text-red-600 border-red-100 hover:bg-red-100",
                          slate: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100",
                        };
                        return (
                          <button
                            key={action.status}
                            onClick={() => statusMutation.mutate({ id: tenant.id, status: action.status })}
                            disabled={statusMutation.isPending}
                            className={cn(
                              "px-3 py-1.5 border rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5",
                              colorClasses[action.color as keyof typeof colorClasses] || colorClasses.slate
                            )}
                          >
                            {statusMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                            {action.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 px-6 py-2 border-b border-slate-100 bg-white overflow-x-auto scrollbar-hide">
                  {TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                          activeTab === tab.key ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" /> {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-white">
                  {activeTab === "overview" && <OverviewTab tenant={tenant} />}
                  {activeTab === "subscription" && <SubscriptionTab tenant={tenant} navigate={navigate} />}
                  {activeTab === "health" && <HealthTab health={health} />}
                  {activeTab === "features" && <FeaturesTab settings={tenant.tenantSettings} />}
                  {activeTab === "activity" && <ActivityTab activity={activity} />}
                  <div className="h-8" />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center relative">
                <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-5 h-5" />
                </button>
                <AlertTriangle className="w-12 h-12 mb-4 text-slate-200" />
                <h3 className="text-lg font-semibold text-slate-900">Failed to load tenant</h3>
                <p className="text-sm mb-6">The tenant may have been deleted or there is a connection issue.</p>
                <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors">
                  Close Drawer
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Tab Components ──────────────────────────────────────────────────────────────

function OverviewTab({ tenant }: { tenant: any }) {
  return (
    <>
      <section>
        <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Owner" value={tenant.owner?.name || "--"} icon={<User className="w-4 h-4" />} />
          <StatCard label="Doctors" value={tenant.doctorsCount} icon={<Stethoscope className="w-4 h-4" />} />
          <StatCard label="Patients" value={tenant.patientsCount} icon={<Users className="w-4 h-4" />} />
          <StatCard label="Tickets" value={tenant.ticketsCount} icon={<FileText className="w-4 h-4" />} />
        </div>
      </section>

      {tenant.owner && (
        <section>
          <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Owner Details</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50">
              <p className="text-xs font-medium text-slate-500 mb-1">Name</p>
              <p className="font-semibold text-slate-900">{tenant.owner.name}</p>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50">
              <p className="text-xs font-medium text-slate-500 mb-1">Email</p>
              <p className="font-semibold text-slate-900">{tenant.owner.email}</p>
            </div>
            {tenant.owner.phone && (
              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50">
                <p className="text-xs font-medium text-slate-500 mb-1">Phone</p>
                <p className="font-semibold text-slate-900">{tenant.owner.phone}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function SubscriptionTab({ tenant, navigate }: { tenant: any; navigate: any }) {
  const sub = tenant.subscription;
  return (
    <section className="space-y-6">
      <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Current Plan</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{sub?.planName || "Not Configured"}</p>
          </div>
          {sub && (
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold",
              sub.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            )}>
              {sub.status}
            </span>
          )}
        </div>
        <div className="space-y-2 mt-4">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Valid Until</span>
            <span className="font-medium text-slate-900">{sub?.validUntil ? format(new Date(sub.validUntil), "MMM d, yyyy • h:mm a") : "--"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Billing Cycle</span>
            <span className="font-medium text-slate-900 capitalize">{sub?.billingCycle?.toLowerCase() || "--"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Price</span>
            <span className="font-medium text-slate-900">{sub?.amount != null ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(sub.amount) : "--"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Auto Renew</span>
            <span className="font-medium text-slate-900">{sub?.autoRenew ? "Enabled" : "Disabled"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Created</span>
            <span className="font-medium text-slate-900">{sub?.createdAt ? format(new Date(sub.createdAt), "MMM d, yyyy • h:mm a") : "--"}</span>
          </div>
        </div>
        {sub?.id && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
            <button
              onClick={() => navigate(`/dashboard/subscriptions?id=${sub.id}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-semibold transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5" /> Manage Subscription
            </button>
          </div>
        )}
      </div>

      {/* Storage */}
      <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h4 className="text-xs font-bold text-slate-400 uppercase mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4" /> Storage
        </h4>
        <div className="flex justify-between items-end mb-2">
          <p className="text-xs font-bold text-slate-400 uppercase">Usage</p>
          <p className="text-sm font-semibold text-slate-900">-- / {tenant.tenantSettings?.storageLimit || "--"} MB</p>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden w-full mb-4">
          <div className="h-full bg-slate-300 w-0" />
        </div>
      </div>
    </section>
  );
}

function HealthTab({ health }: { health: any }) {
  const services = health ? Object.entries(health) : [];
  return (
    <section>
      <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider flex items-center gap-2">
        <Zap className="w-4 h-4 text-slate-400" /> System Health
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {services.map(([key, val]: [string, any]) => {
          const isHealthy = val.status === "HEALTHY";
          return (
            <div key={key} className="p-3 border border-slate-100 rounded-xl bg-emerald-50/30 flex items-center gap-3">
              <span className={cn("flex w-2 h-2 rounded-full ring-2", isHealthy ? "bg-emerald-500 ring-emerald-500/20" : "bg-amber-500 ring-amber-500/20 animate-pulse")} />
              <div>
                <p className="text-xs font-semibold text-slate-700 capitalize">{key}</p>
                <p className={cn("text-[10px]", isHealthy ? "text-emerald-600" : "text-amber-600")}>{val.value}</p>
                <p className="text-[10px] text-slate-500">{val.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FeaturesTab({ settings }: { settings: any }) {
  if (!settings) {
    return <p className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">No settings configured for this tenant.</p>;
  }

  const limits = [
    { label: "Doctor Limit", value: settings.doctorLimit },
    { label: "Staff Limit", value: settings.staffLimit },
    { label: "Patient Limit", value: settings.patientLimit },
    { label: "Storage Limit", value: `${settings.storageLimit} MB` },
  ];

  const flags = [
    { label: "Billing", enabled: settings.enableBilling },
    { label: "Inventory", enabled: settings.enableInventory },
    { label: "EMR", enabled: settings.enableEmr },
    { label: "CRM", enabled: settings.enableCrm },
    { label: "WhatsApp", enabled: settings.enableWhatsapp },
    { label: "SMS", enabled: settings.enableSms },
    { label: "API Access", enabled: settings.enableApiAccess },
    { label: "Online Booking", enabled: settings.enableOnlineBooking },
  ];

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Limits</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {limits.map((l) => (
            <div key={l.label} className="p-4 rounded-xl border border-slate-100 bg-slate-50 text-center">
              <p className="text-xs font-medium text-slate-500 mb-1">{l.label}</p>
              <p className="text-xl font-bold text-slate-900">{l.value}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Feature Flags</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {flags.map((f) => (
            <div key={f.label} className={cn("px-3 py-2.5 rounded-lg text-xs font-medium text-center", f.enabled ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-50 text-slate-400 ring-1 ring-slate-100")}>
              {f.enabled ? "✓" : "✗"} {f.label}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivityTab({ activity }: { activity: any }) {
  if (!activity || activity.length === 0) {
    return <p className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">No recent activity logged.</p>;
  }

  return (
    <section>
      <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider flex items-center gap-2">
        <Clock className="w-4 h-4 text-slate-400" /> Activity Timeline
      </h3>
      <div className="space-y-4">
        {activity.map((act: any, idx: number) => (
          <div key={act.id || idx} className="flex gap-4 relative">
            <div className="w-2 h-2 rounded-full bg-brand-400 mt-1.5 shrink-0 relative z-10 ring-4 ring-white">
              {idx < activity.length - 1 && <div className="absolute top-2 left-1/2 -translate-x-1/2 w-px h-8 bg-slate-100" />}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">
                {act.action} {act.entity}
              </p>
              <p className="text-xs text-slate-500">
                {format(new Date(act.createdAt), "MMM d, yyyy • h:mm a")} by {act.user?.name || "System"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatCard({ label, value, icon }: { label: string; value: any; icon: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
        {icon} {label}
      </div>
      <p className="font-semibold text-slate-900 truncate">{value}</p>
    </div>
  );
}
