import { cn } from "@/lib/utils";
import { BATCH_STATUS_CFG, TAB_COLORS } from "../types";
import type { BatchStatus } from "../types";

export function TabBtn({ active, onClick, icon: Icon, label, badge, color = "blue" }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; badge?: number;
  color?: keyof typeof TAB_COLORS;
}) {
  const c = TAB_COLORS[color];
  return (
    <button onClick={onClick} className={cn(
      "flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-all whitespace-nowrap",
      active
        ? cn(c.border, c.text)
        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200",
    )}>
      <Icon className={cn("w-3.5 h-3.5", active ? c.icon : "text-slate-400")} />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={cn("text-[11px] font-bold rounded-full px-1.5 leading-[18px]",
          active ? c.badge : "bg-slate-100 text-slate-500"
        )}>{badge}</span>
      )}
    </button>
  );
}

export function StatusBadge({ status }: { status: BatchStatus }) {
  const cfg = BATCH_STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold border rounded-full px-2 py-0.5 whitespace-nowrap", cfg.cls)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
