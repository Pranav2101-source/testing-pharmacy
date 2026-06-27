import { IndianRupee, Truck, AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { currency } from "../utils";
import { usePurchaseSummary } from "../hooks/usePurchaseSummary";
import { Skeleton } from "@/components/Skeleton";

export function SummaryBar() {
  const { data: stats, isPending } = usePurchaseSummary();

  const cards = [
    {
      label: "This Month Spend",
      value: stats ? currency(stats.monthSpend) : "—",
      icon: IndianRupee,
      iconBg: "bg-gradient-to-br from-blue-500 to-indigo-600",
      accent: "before:bg-blue-500",
    },
    {
      label: "Pending Gate Inward",
      value: stats ? `${stats.pendingGRNs} GRN${stats.pendingGRNs !== 1 ? "s" : ""}` : "—",
      icon: Truck,
      iconBg: "bg-gradient-to-br from-amber-400 to-orange-500",
      accent: "before:bg-amber-500",
      warn: stats ? stats.pendingGRNs > 0 : false,
    },
    {
      label: "Overdue Payments",
      value: stats ? `${stats.overduePayments} bill${stats.overduePayments !== 1 ? "s" : ""}` : "—",
      icon: AlertTriangle,
      iconBg: stats?.overduePayments ? "bg-gradient-to-br from-red-500 to-rose-600" : "bg-gradient-to-br from-slate-300 to-slate-400",
      accent: "before:bg-red-500",
      warn: stats ? stats.overduePayments > 0 : false,
    },
    {
      label: "Pending Approval",
      value: stats ? `${stats.pendingApprovals} PO${stats.pendingApprovals !== 1 ? "s" : ""}` : "—",
      icon: ShieldAlert,
      iconBg: stats?.pendingApprovals ? "bg-gradient-to-br from-orange-400 to-amber-600" : "bg-gradient-to-br from-slate-300 to-slate-400",
      accent: "before:bg-orange-500",
      warn: stats ? stats.pendingApprovals > 0 : false,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 px-5 py-3.5 bg-gradient-to-b from-slate-50 to-[#f7f9fc] border-b border-slate-200">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn(
            "relative flex items-center gap-3 rounded-2xl px-4 py-3 border bg-white overflow-hidden transition-shadow hover:shadow-card-md",
            "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px]",
            c.warn ? cn("border-slate-200 shadow-sm", c.accent) : "border-slate-200 shadow-card before:bg-transparent",
          )}
        >
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm", c.iconBg)}>
            <c.icon className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide leading-none mb-1 truncate">{c.label}</p>
            {isPending ? (
              <Skeleton className="h-4 w-20" />
            ) : (
              <p className={cn("text-[16px] font-black leading-none tabular-nums", c.warn ? "text-red-700" : "text-slate-800")}>{c.value}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
