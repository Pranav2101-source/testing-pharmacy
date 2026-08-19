import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import {
  X, CreditCard, ArrowUpCircle, ArrowDownCircle, RefreshCw, Ban,
  XCircle, Mail, FileText, BarChart3, Settings, Clock, Receipt,
  Wallet, Activity, Zap, Calendar, Building2, User, CheckCircle2,
  AlertTriangle, Download, Loader2, Stethoscope, Users, HardDrive,
  FileBarChart, Globe, Pill,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

type Props = {
  subscriptionId: string | null;
  onClose: () => void;
  onChangePlan: (id: string, currentPlan: string) => void;
};

const TABS = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "billing", label: "Billing", icon: Receipt },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "payment", label: "Payment", icon: Wallet },
  { key: "features", label: "Features", icon: Settings },
  { key: "usage", label: "Usage", icon: Activity },
  { key: "audit", label: "Audit", icon: Clock },
] as const;

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function SubscriptionDrawer({ subscriptionId, onClose, onChangePlan }: Props) {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => { if (subscriptionId) setActiveTab("overview"); }, [subscriptionId]);
  useEffect(() => {
    if (!subscriptionId) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = orig; };
  }, [subscriptionId]);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["sub-detail", subscriptionId],
    queryFn: async () => { const { data } = await api.get<{ data: any }>(`/platform/subscriptions/${subscriptionId}`); return data.data; },
    enabled: !!subscriptionId,
  });

  const { data: invoices } = useQuery({
    queryKey: ["sub-invoices", subscriptionId],
    queryFn: async () => { const { data } = await api.get<{ data: any[] }>(`/platform/subscriptions/${subscriptionId}/invoices`); return data.data; },
    enabled: !!subscriptionId && (activeTab === "invoices" || activeTab === "billing"),
  });

  const { data: usageData } = useQuery({
    queryKey: ["sub-usage", subscriptionId],
    queryFn: async () => { const { data } = await api.get<{ data: any }>(`/platform/subscriptions/${subscriptionId}/usage`); return data.data; },
    enabled: !!subscriptionId && activeTab === "usage",
  });

  const { data: auditData } = useQuery({
    queryKey: ["sub-audit", subscriptionId],
    queryFn: async () => { const { data } = await api.get<{ data: any[] }>(`/platform/subscriptions/${subscriptionId}/audit`); return data.data; },
    enabled: !!subscriptionId && activeTab === "audit",
  });

  const actionMutation = useMutation({
    mutationFn: async ({ endpoint }: { endpoint: string }) => {
      const { data } = await api.post(`/platform/subscriptions/${subscriptionId}/${endpoint}`);
      return data;
    },
    onSuccess: (_, { endpoint }) => {
      qc.invalidateQueries({ queryKey: ["sub-detail", subscriptionId] });
      qc.invalidateQueries({ queryKey: ["sub-list"] });
      qc.invalidateQueries({ queryKey: ["sub-stats"] });
      toast.success(`Action "${endpoint}" completed`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Action failed"),
  });

  return (
    <>
      <AnimatePresence>{subscriptionId && <motion.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-50" />}</AnimatePresence>
      <AnimatePresence>
        {subscriptionId && (
          <motion.div key="drawer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 overflow-hidden">
            {isLoading ? (
              <div className="flex-1 p-8 space-y-6">
                <div className="h-20 bg-slate-100 animate-pulse rounded-2xl" />
                <div className="h-60 bg-slate-100 animate-pulse rounded-2xl" />
              </div>
            ) : detail ? (
              <>
                {/* Header */}
                <div className="bg-slate-50 border-b border-slate-100 p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xl rounded-2xl ring-4 ring-white shadow-sm">{detail.pharmacy.name.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">{detail.pharmacy.name}</h2>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                          <span className="font-mono bg-slate-200/50 px-1.5 py-0.5 rounded">{detail.pharmacy.tenantCode || detail.id.slice(0, 8)}</span>
                          <span className={cn("px-2 py-0.5 rounded-full font-bold uppercase tracking-wide",
                            detail.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" :
                            detail.status === "TRIAL" ? "bg-blue-100 text-blue-700" :
                            detail.status === "PAUSED" ? "bg-amber-100 text-amber-700" :
                            "bg-red-100 text-red-700"
                          )}>{detail.status}</span>
                          <span className="px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700">{detail.planName}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => {
                        onClose();
                        navigate(`/dashboard/tenants?id=${detail.pharmacy.id}`);
                      }} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 text-brand-700 hover:bg-brand-100 rounded-lg text-xs font-semibold transition-colors border border-brand-200">
                        <Building2 className="w-3.5 h-3.5" /> View Tenant
                      </button>
                      <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                    </div>
                  </div>

                  {/* Quick Actions (7) */}
                  <div className="flex items-center gap-2 mt-5 flex-wrap">
                    <ActionBtn icon={ArrowUpCircle} label="Upgrade" color="indigo" onClick={() => onChangePlan(detail.id, detail.planName)} />
                    <ActionBtn icon={ArrowDownCircle} label="Downgrade" color="slate" onClick={() => onChangePlan(detail.id, detail.planName)} />
                    <ActionBtn icon={RefreshCw} label="Renew" color="emerald" onClick={() => actionMutation.mutate({ endpoint: "renew" })} loading={actionMutation.isPending} />
                    <ActionBtn icon={Ban} label="Suspend" color="red" onClick={() => actionMutation.mutate({ endpoint: "pause" })} />
                    <ActionBtn icon={XCircle} label="Cancel" color="red" onClick={() => actionMutation.mutate({ endpoint: "cancel" })} />
                    <ActionBtn icon={Mail} label="Remind" color="blue" onClick={() => actionMutation.mutate({ endpoint: "reminder" })} />
                    <ActionBtn icon={FileText} label="Invoice" color="emerald" onClick={() => actionMutation.mutate({ endpoint: "invoice" })} />
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 px-6 py-2 border-b border-slate-100 bg-white overflow-x-auto scrollbar-hide">
                  {TABS.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button key={t.key} onClick={() => setActiveTab(t.key)} className={cn("flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap", activeTab === t.key ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50")}>
                        <Icon className="w-3.5 h-3.5" /> {t.label}
                      </button>
                    );
                  })}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
                  {activeTab === "overview" && <OverviewTab detail={detail} />}
                  {activeTab === "billing" && <BillingTab detail={detail} invoices={invoices} />}
                  {activeTab === "invoices" && <InvoicesTab invoices={invoices} />}
                  {activeTab === "payment" && <PaymentTab />}
                  {activeTab === "features" && <FeaturesTab features={detail.features} />}
                  {activeTab === "usage" && <UsageTab usage={usageData || detail.usage} />}
                  {activeTab === "audit" && <AuditTab logs={auditData} />}
                  <div className="h-8" />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
                <AlertTriangle className="w-12 h-12 text-slate-200 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900">Subscription not found</h3>
                <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg">Close</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Action Button ────────────────────────────────────────────────────────────

function ActionBtn({ icon: Icon, label, color, onClick, loading }: { icon: any; label: string; color: string; onClick: () => void; loading?: boolean }) {
  const colors: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100",
    red: "bg-red-50 text-red-600 border-red-100 hover:bg-red-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100",
    slate: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100",
  };
  return (
    <button onClick={onClick} disabled={loading} className={cn("px-2.5 py-1.5 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50", colors[color] || colors.slate)}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />} {label}
    </button>
  );
}

// ── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ detail }: { detail: any }) {
  // validUntil can be absent (e.g. a tenant without a billed subscription yet) —
  // guard the same way TenantDrawer's SubscriptionTab already does, instead of
  // letting Date math on `undefined` produce "NaN days left".
  const hasValidUntil = Boolean(detail.validUntil);
  const daysLeft = hasValidUntil ? Math.ceil((new Date(detail.validUntil).getTime() - Date.now()) / 86400000) : null;
  return (
    <div className="space-y-6">
      {/* Renewal Countdown */}
      <div className={cn("p-5 rounded-2xl border", daysLeft === null ? "bg-slate-50 border-slate-200" : daysLeft <= 7 ? "bg-red-50 border-red-200" : daysLeft <= 30 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200")}>
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Renewal</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">
              {daysLeft === null ? "--" : daysLeft > 0 ? `${daysLeft} days left` : `${Math.abs(daysLeft)} days overdue`}
            </p>
          </div>
          <Calendar className={cn("w-8 h-8", daysLeft === null ? "text-slate-400" : daysLeft <= 7 ? "text-red-400" : daysLeft <= 30 ? "text-amber-400" : "text-emerald-400")} />
        </div>
        <p className="text-xs text-slate-500 mt-2">Valid until {hasValidUntil ? format(new Date(detail.validUntil), "MMM d, yyyy • h:mm a") : "--"}</p>
      </div>

      {/* Plan & Cycle */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Plan" value={detail.planName} icon={<CreditCard className="w-4 h-4" />} />
        <StatCard label="Billing" value={detail.billingCycle} icon={<Calendar className="w-4 h-4" />} />
        <StatCard label="Amount" value={detail.amount != null ? formatCurrency(detail.amount) : "Free"} icon={<Receipt className="w-4 h-4" />} />
        <StatCard label="Auto Renew" value={detail.autoRenew ? "Yes" : "No"} icon={<RefreshCw className="w-4 h-4" />} />
      </div>

      {/* Owner */}
      {detail.owner && (
        <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Tenant Owner</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-slate-500 text-xs">Name:</span> <span className="font-semibold text-slate-900 text-xs">{detail.owner.name}</span></div>
            <div><span className="text-slate-500 text-xs">Email:</span> <span className="font-semibold text-slate-900 text-xs">{detail.owner.email}</span></div>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Doctors" value={detail.usage?.doctors?.used ?? "--"} icon={<Stethoscope className="w-4 h-4" />} />
        <StatCard label="Patients" value={detail.usage?.patients?.used ?? "--"} icon={<Users className="w-4 h-4" />} />
        <StatCard label="Staff" value={detail.usage?.staff?.used ?? "--"} icon={<User className="w-4 h-4" />} />
        <StatCard label="Prescriptions" value={detail.usage?.prescriptions?.used ?? "--"} icon={<Pill className="w-4 h-4" />} />
      </div>
    </div>
  );
}

// ── Tab: Billing ─────────────────────────────────────────────────────────────

function BillingTab({ detail, invoices }: { detail: any; invoices: any[] | undefined }) {
  const billing = detail.billing;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <InfoCard label="Last Invoice" value={billing?.lastInvoice ? `${billing.lastInvoice.invoiceNumber} — ${formatCurrency(billing.lastInvoice.total)}` : "None"} />
        <InfoCard label="Next Invoice" value={billing?.nextInvoiceDate ? format(new Date(billing.nextInvoiceDate), "MMM d, yyyy • h:mm a") : "--"} />
        <InfoCard label="Outstanding" value={formatCurrency(billing?.outstanding || 0)} highlight={billing?.outstanding > 0} />
        <InfoCard label="Credit Balance" value={formatCurrency(billing?.creditBalance || 0)} />
        <InfoCard label="GST (Pharmacy)" value={billing?.gstinPharmacy || "Not Provided"} />
        <InfoCard label="GST (Platform)" value={billing?.gstinPlatform || "--"} />
        <InfoCard label="Discount" value={`${billing?.discount || 0}%`} />
        <InfoCard label="Coupon" value={billing?.couponCode || "None"} />
      </div>

      {/* Recent Payments */}
      {invoices && invoices.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Payments</h4>
          <div className="space-y-2">
            {invoices.slice(0, 5).map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <div>
                  <span className="font-mono font-bold text-slate-700">{inv.invoiceNumber}</span>
                  <span className="text-slate-400 ml-2">{format(new Date(inv.createdAt), "MMM d, yyyy • h:mm a")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("px-2 py-0.5 rounded-full font-bold",
                    inv.status === "PAID" ? "bg-emerald-100 text-emerald-700" : inv.status === "OVERDUE" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  )}>{inv.status}</span>
                  <span className="font-bold text-slate-900">{formatCurrency(inv.total)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Invoices ────────────────────────────────────────────────────────────

function InvoicesTab({ invoices }: { invoices: any[] | undefined }) {
  if (!invoices || invoices.length === 0) {
    return <EmptyState message="No invoices generated yet." />;
  }
  return (
    <div className="space-y-3">
      {invoices.map((inv: any) => (
        <div key={inv.id} className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono font-bold text-sm text-slate-900">{inv.invoiceNumber}</p>
              <p className="text-xs text-slate-500 mt-0.5">Due: {format(new Date(inv.dueDate), "MMM d, yyyy • h:mm a")}</p>
            </div>
            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold",
              inv.status === "PAID" ? "bg-emerald-100 text-emerald-700" : inv.status === "OVERDUE" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            )}>{inv.status}</span>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 text-xs text-slate-600">
            <div><p className="text-slate-400">Amount</p><p className="font-semibold text-slate-900">{formatCurrency(inv.amount)}</p></div>
            <div><p className="text-slate-400">Tax</p><p className="font-semibold text-slate-900">{formatCurrency(inv.tax)}</p></div>
            <div><p className="text-slate-400">Discount</p><p className="font-semibold text-slate-900">{formatCurrency(inv.discount)}</p></div>
            <div><p className="text-slate-400">Total</p><p className="font-bold text-slate-900">{formatCurrency(inv.total)}</p></div>
          </div>
          {inv.gstinPharmacy && (
            <p className="text-[10px] text-slate-400 mt-2">GST: {inv.gstinPharmacy} | Platform: {inv.gstinPlatform || "--"}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tab: Payment Methods ─────────────────────────────────────────────────────

function PaymentTab() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
        <Wallet className="w-8 h-8 text-slate-300" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-1">Payment Methods</h3>
      <p className="text-sm text-slate-500 max-w-sm">Payment gateway integration (Razorpay / Stripe) is not yet configured. This section will display saved cards, UPI, and bank accounts once connected.</p>
      <div className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg">Coming Soon</div>
    </div>
  );
}

// ── Tab: Features ────────────────────────────────────────────────────────────

function FeaturesTab({ features }: { features: any }) {
  if (!features) return <EmptyState message="No feature settings configured." />;

  const limits = [
    { label: "Doctor Limit", value: features.doctorLimit },
    { label: "Staff Limit", value: features.staffLimit },
    { label: "Patient Limit", value: features.patientLimit },
    { label: "Storage", value: `${features.storageLimit} MB` },
  ];
  const flags = [
    { label: "Billing", on: features.enableBilling },
    { label: "Inventory", on: features.enableInventory },
    { label: "CRM", on: features.enableCrm },
    { label: "WhatsApp", on: features.enableWhatsapp },
    { label: "SMS", on: features.enableSms },
    { label: "API Access", on: features.enableApiAccess },
    { label: "Online Booking", on: features.enableOnlineBooking },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Limits</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {limits.map((l) => (
            <div key={l.label} className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-center">
              <p className="text-[10px] font-medium text-slate-500">{l.label}</p>
              <p className="text-lg font-bold text-slate-900 mt-0.5">{l.value}</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Feature Flags</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {flags.map((f) => (
            <div key={f.label} className={cn("px-3 py-2 rounded-lg text-xs font-medium text-center", f.on ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-50 text-slate-400 ring-1 ring-slate-100")}>
              {f.on ? "✓" : "✗"} {f.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Usage ───────────────────────────────────────────────────────────────

function UsageTab({ usage }: { usage: any }) {
  if (!usage) return <EmptyState message="No usage data available." />;

  const items = [
    { label: "Doctors", icon: Stethoscope, used: usage.doctors?.used, limit: usage.doctors?.limit, color: "#6366f1" },
    { label: "Patients", icon: Users, used: usage.patients?.used, limit: usage.patients?.limit, color: "#06b6d4" },
    { label: "Staff", icon: User, used: usage.staff?.used, limit: usage.staff?.limit, color: "#f59e0b" },
    { label: "Storage", icon: HardDrive, used: usage.storage?.used, limit: usage.storage?.limit, color: "#10b981", unit: "MB" },
    { label: "Prescriptions", icon: Pill, used: usage.prescriptions?.used, limit: usage.prescriptions?.limit, color: "#8b5cf6" },
    { label: "Documents", icon: FileBarChart, used: usage.documents?.used, limit: usage.documents?.limit, color: "#ec4899" },
    { label: "Invoices", icon: Receipt, used: usage.invoices?.used, limit: usage.invoices?.limit, color: "#14b8a6" },
    { label: "API Usage", icon: Globe, used: usage.apiUsage?.used, limit: usage.apiUsage?.limit, color: "#f97316" },
  ];

  const barData = items.filter((i) => i.used != null).map((i) => ({ name: i.label, used: i.used, limit: i.limit || i.used }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          const pct = item.limit && item.limit > 0 && item.used != null ? Math.min(100, Math.round((item.used / item.limit) * 100)) : null;
          return (
            <div key={item.label} className="p-3 rounded-xl border border-slate-100 bg-slate-50">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium mb-1">
                <Icon className="w-3 h-3" style={{ color: item.color }} /> {item.label}
              </div>
              <p className="text-lg font-bold text-slate-900">{item.used ?? "--"}{item.unit ? ` ${item.unit}` : ""}</p>
              {pct !== null && (
                <div className="mt-1.5">
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{item.used} / {item.limit} ({pct}%)</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {barData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h4 className="text-xs font-bold text-slate-900 mb-3">Usage Overview</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <Tooltip />
              <Bar dataKey="used" fill="#6366f1" radius={[4, 4, 0, 0]} name="Used" />
              <Bar dataKey="limit" fill="#e2e8f0" radius={[4, 4, 0, 0]} name="Limit" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Tab: Audit ───────────────────────────────────────────────────────────────

function AuditTab({ logs }: { logs: any[] | undefined }) {
  if (!logs || logs.length === 0) return <EmptyState message="No audit logs recorded yet." />;

  return (
    <div className="space-y-3">
      {logs.map((log: any, idx: number) => (
        <div key={log.id || idx} className="flex gap-3 relative">
          <div className="mt-1.5 shrink-0 relative z-10">
            <div className="w-2 h-2 rounded-full bg-brand-400 ring-4 ring-white" />
            {idx < logs.length - 1 && <div className="absolute top-2 left-1/2 -translate-x-1/2 w-px h-8 bg-slate-100" />}
          </div>
          <div className="pb-4">
            <p className="text-sm font-medium text-slate-800">{log.action.replace(/_/g, " ")}</p>
            {log.oldValue && <p className="text-[10px] text-slate-400 mt-0.5">From: {log.oldValue}</p>}
            {log.newValue && <p className="text-[10px] text-slate-400">To: {log.newValue}</p>}
            <p className="text-[10px] text-slate-400 mt-0.5">{format(new Date(log.createdAt), "MMM d, yyyy • h:mm a")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: any; icon: React.ReactNode }) {
  return (
    <div className="p-3 rounded-xl border border-slate-100 bg-slate-50">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 mb-0.5">{icon} {label}</div>
      <p className="font-semibold text-slate-900 text-sm truncate">{value}</p>
    </div>
  );
}

function InfoCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="p-3 rounded-xl border border-slate-100 bg-slate-50">
      <p className="text-[10px] font-medium text-slate-500 mb-0.5">{label}</p>
      <p className={cn("font-semibold text-sm truncate", highlight ? "text-red-600" : "text-slate-900")}>{value}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">{message}</p>;
}
