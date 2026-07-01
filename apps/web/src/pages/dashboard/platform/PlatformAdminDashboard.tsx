import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { 
  Building2, Users, Receipt, AlertTriangle, Activity, 
  Database, Server, HardDrive, Clock, CheckCircle2,
  TrendingUp, CreditCard, ChevronRight, XCircle,
  Plus, BellRing, Mail, Key, Shield, Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import { Link } from "react-router-dom";

type DashboardStats = {
  real: {
    totalPharmacies: number;
    activePharmacies: number;
    totalDoctors: number;
    totalPatients: number;
    totalUsers: number;
    totalTickets: number;
    openTickets: number;
    urgentTickets: number;
    totalConsultations: number;
    activityFeed: Array<{ id: string; type: string; message: string; timestamp: string }>;
  };
  mock: {
    revenue: {
      mrr: number;
      arr: number;
      todaysRevenue: number;
      renewalsToday: number;
      failedPayments: number;
      outstandingInvoices: number;
    };
    systemHealth: {
      database: { status: string; value: string; detail: string };
      redis: { status: string; value: string; detail: string };
      queue: { status: string; value: string; detail: string };
      storage: { status: string; value: string; detail: string };
      api: { status: string; value: string; detail: string };
    };
    criticalAlerts: Array<{ id: string; type: string; message: string }>;
  };
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " years ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " months ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " days ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hours ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " mins ago";
  return Math.floor(seconds) + " secs ago";
}

// Dummy chart data for sparkline
const dummySparklineData = [
  { value: 400 }, { value: 300 }, { value: 550 }, { value: 450 }, { value: 700 }
];

export default function PlatformAdminDashboard() {
  const { data: res, isLoading, error } = useQuery({
    queryKey: ["platform-dashboard-stats"],
    queryFn: async () => {
      const { data } = await api.get<{ data: DashboardStats }>("/platform/stats");
      return data.data;
    }
  });

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
        <div className="h-8 w-64 bg-slate-200 animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-slate-200 animate-pulse rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (error || !res) {
    return (
      <div className="p-8 text-center text-red-500">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <h2 className="text-lg font-semibold">Failed to load platform stats</h2>
        <p className="text-sm opacity-80 mt-1">Please try again later or check your connection.</p>
      </div>
    );
  }

  const { real, mock } = res;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 bg-slate-50 h-full overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Platform Command Center</h1>
          <p className="text-slate-500 mt-1 flex items-center gap-2">
            <span className="flex w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" />
            All systems operational
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors">
            Download Report
          </button>
        </div>
      </div>

      {/* Critical Alerts */}
      {mock.criticalAlerts.length > 0 && (
        <div className="flex flex-col gap-3">
          {mock.criticalAlerts.map(alert => (
            <div key={alert.id} className={cn(
              "flex items-center gap-3 p-4 rounded-xl border shadow-sm font-medium",
              alert.type === "DANGER" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800"
            )}>
              <AlertTriangle className="w-5 h-5 shrink-0" />
              {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard title="Monthly Recurring Revenue" value={formatCurrency(mock.revenue.mrr)} trend="+12.5%" trendUp icon={<CreditCard className="w-5 h-5" />} color="indigo" />
        <KpiCard title="Active Pharmacies" value={real.activePharmacies.toString()} trend="+4" trendUp icon={<Building2 className="w-5 h-5" />} color="emerald" />
        <KpiCard title="Total Doctors" value={real.totalDoctors.toString()} trend="+18%" trendUp icon={<Users className="w-5 h-5" />} color="blue" />
        <KpiCard title="Open Urgent Tickets" value={real.urgentTickets.toString()} trend={real.urgentTickets > 5 ? "Action required" : "Healthy"} trendUp={real.urgentTickets === 0} icon={<AlertTriangle className="w-5 h-5" />} color={real.urgentTickets > 0 ? "red" : "slate"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Left/Middle Column - Main Content */}
        <div className="xl:col-span-2 space-y-8">
          
          {/* Revenue Breakdown */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800">Financial Overview</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100">
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-slate-500">ARR</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(mock.revenue.arr)}</p>
              </div>
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-slate-500">Today's Revenue</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(mock.revenue.todaysRevenue)}</p>
              </div>
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-slate-500">Renewals Today</p>
                <p className="text-2xl font-bold text-emerald-600 mt-1">{mock.revenue.renewalsToday}</p>
              </div>
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-slate-500">Outstanding Invoices</p>
                <p className="text-2xl font-bold text-amber-600 mt-1">{mock.revenue.outstandingInvoices}</p>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">System Health</h2>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <HealthMetric icon={<Database />} label="Database" health={mock.systemHealth.database} />
              <HealthMetric icon={<Server />} label="Redis" health={mock.systemHealth.redis} />
              <HealthMetric icon={<Activity />} label="Queue" health={mock.systemHealth.queue} />
              <HealthMetric icon={<HardDrive />} label="Storage" health={mock.systemHealth.storage} />
              <HealthMetric icon={<Zap />} label="API" health={mock.systemHealth.api} />
            </div>
          </div>

          {/* Additional Platform Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 text-slate-600 mb-2">
                <Users className="w-5 h-5 text-indigo-500" />
                <span className="font-semibold">Registered Patients</span>
              </div>
              <p className="text-3xl font-bold text-slate-900">{real.totalPatients}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 text-slate-600 mb-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span className="font-semibold">Consultations</span>
              </div>
              <p className="text-3xl font-bold text-slate-900">{real.totalConsultations}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 text-slate-600 mb-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span className="font-semibold">Open Support Tickets</span>
              </div>
              <p className="text-3xl font-bold text-slate-900">{real.openTickets} <span className="text-sm font-normal text-slate-500">/ {real.totalTickets} total</span></p>
            </div>
          </div>

        </div>

        {/* Right Column - Sidebars */}
        <div className="space-y-8">
          
          {/* Quick Actions */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Quick Actions</h2>
            </div>
            <div className="p-3 grid grid-cols-1 gap-1">
              <QuickAction icon={<Plus />} label="New Pharmacy" />
              <QuickAction icon={<AlertTriangle />} label="Create Support Ticket" />
              <QuickAction icon={<Key />} label="Invite Admin" />
              <QuickAction icon={<BellRing />} label="Broadcast Notice" />
              <QuickAction icon={<CreditCard />} label="Create Coupon" />
              <QuickAction icon={<TrendingUp />} label="Upgrade Subscription" />
              <QuickAction icon={<Shield />} label="View Audit Logs" to="/dashboard/audit" />
            </div>
          </div>

          {/* Live Platform Activity */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Live Activity
              </h2>
            </div>
            <div className="p-5 space-y-6">
              {real.activityFeed.length === 0 ? (
                <p className="text-slate-500 text-sm">No recent activity.</p>
              ) : (
                real.activityFeed.map((item, idx) => (
                  <div key={item.id + idx} className="relative pl-6 before:absolute before:left-[11px] before:top-2 before:bottom-[-24px] before:w-px before:bg-slate-200 last:before:hidden">
                    <span className={cn(
                      "absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center ring-4 ring-white z-10",
                      item.type === "PHARMACY_CREATED" ? "bg-emerald-100 text-emerald-600" :
                      item.type === "TICKET_CREATED" ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
                    )}>
                      {item.type === "PHARMACY_CREATED" ? <Building2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    </span>
                    <p className="text-sm font-medium text-slate-800 leading-tight">{item.message}</p>
                    <p className="text-xs text-slate-500 mt-1">{timeAgo(item.timestamp)}</p>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, trend, trendUp, icon, color }: any) {
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
        <div className={cn(
          "px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1",
          trendUp ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        )}>
          {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 rotate-180" />}
          {trend}
        </div>
      </div>
      <h3 className="text-slate-500 font-medium text-sm">{title}</h3>
      <p className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">{value}</p>
      
      {/* Sparkline decorative background */}
      <div className="absolute bottom-0 left-0 right-0 h-16 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dummySparklineData}>
            <Area type="monotone" dataKey="value" stroke={trendUp ? "#10b981" : "#ef4444"} fill={trendUp ? "#10b981" : "#ef4444"} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HealthMetric({ icon, label, health }: any) {
  const isHealthy = health.status === "HEALTHY";
  return (
    <div className="flex items-center gap-4">
      <div className={cn(
        "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
        isHealthy ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
      )}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          {label}
          <span className={cn("w-2 h-2 rounded-full", isHealthy ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500 animate-pulse")} />
        </p>
        <p className="text-lg font-bold text-slate-900 leading-tight">{health.value}</p>
        <p className="text-xs text-slate-500">{health.detail}</p>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, to }: any) {
  const content = (
    <>
      <div className="text-slate-400 group-hover:text-brand-600 transition-colors">
        {icon}
      </div>
      <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900 flex-1 text-left">{label}</span>
      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
    </>
  );

  const className = "flex items-center gap-3 w-full p-3 rounded-xl hover:bg-slate-50 transition-colors group";

  if (to) {
    return <Link to={to} className={className}>{content}</Link>;
  }

  return (
    <button className={className}>
      {content}
    </button>
  );
}
