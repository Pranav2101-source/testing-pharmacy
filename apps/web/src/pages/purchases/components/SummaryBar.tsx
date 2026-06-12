import { useState, useEffect } from "react";
import { IndianRupee, Truck, AlertTriangle, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { currency } from "../utils";

export function SummaryBar() {
  const [stats, setStats] = useState<{
    pendingGRNs: number; overduePayments: number; pendingApprovals: number; monthSpend: number;
  } | null>(null);

  useEffect(() => {
    async function load() {
      const now  = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const to   = now.toISOString();
      try {
        const [grnRes, poRes, summaryRes] = await Promise.all([
          api.get("/purchases/grn", { params: { status: "DRAFT", limit: 1 } }),
          api.get("/purchases/orders", { params: { approvalStatus: "PENDING_APPROVAL", limit: 1 } }),
          api.get("/reports/purchases/summary", { params: { from, to } }),
        ]);
        setStats({
          pendingGRNs:       grnRes.data.data.total,
          overduePayments:   summaryRes.data.data.overduePayments,
          pendingApprovals:  poRes.data.data.total,
          monthSpend:        summaryRes.data.data.totalSpend,
        });
      } catch {/* */}
    }
    load();
  }, []);

  const cards = [
    {
      label: "This Month Spend",
      value: stats ? currency(stats.monthSpend) : "—",
      icon: IndianRupee,
      cls:  "text-blue-700  bg-blue-50",
    },
    {
      label: "Pending Gate Inward",
      value: stats ? `${stats.pendingGRNs} GRN${stats.pendingGRNs !== 1 ? "s" : ""}` : "—",
      icon: Truck,
      cls:  "text-amber-700 bg-amber-50",
      warn: stats ? stats.pendingGRNs > 0 : false,
    },
    {
      label: "Overdue Payments",
      value: stats ? `${stats.overduePayments} bill${stats.overduePayments !== 1 ? "s" : ""}` : "—",
      icon: AlertTriangle,
      cls:  stats?.overduePayments ? "text-red-700 bg-red-50" : "text-slate-500 bg-slate-50",
      warn: stats ? stats.overduePayments > 0 : false,
    },
    {
      label: "Pending Approval",
      value: stats ? `${stats.pendingApprovals} PO${stats.pendingApprovals !== 1 ? "s" : ""}` : "—",
      icon: ShieldAlert,
      cls:  stats?.pendingApprovals ? "text-orange-700 bg-orange-50" : "text-slate-500 bg-slate-50",
      warn: stats ? stats.pendingApprovals > 0 : false,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 px-5 py-3 bg-[#f7f9fc] border-b border-slate-200">
      {cards.map((c) => (
        <div key={c.label} className={cn("flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 border", c.warn ? "border-current/20 shadow-sm" : "border-slate-200 bg-white")}>
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", c.cls)}>
            <c.icon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500 leading-none mb-0.5">{c.label}</p>
            <p className={cn("text-[14px] font-bold leading-none", c.warn ? "text-red-700" : "text-slate-800")}>{c.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
