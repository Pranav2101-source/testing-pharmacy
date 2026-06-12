import { cn } from "@/lib/utils";

export type TicketStatus = "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "PENDING_USER" | "RESOLVED" | "CLOSED";

const CFG: Record<TicketStatus, { label: string; dot: string; cls: string }> = {
  OPEN:         { label: "Open",         dot: "bg-amber-400",   cls: "bg-amber-50   text-amber-800   border-amber-200"   },
  ASSIGNED:     { label: "Assigned",     dot: "bg-blue-500",    cls: "bg-blue-50    text-blue-800    border-blue-200"    },
  IN_PROGRESS:  { label: "In Progress",  dot: "bg-violet-500",  cls: "bg-violet-50  text-violet-800  border-violet-200"  },
  PENDING_USER: { label: "Pending User", dot: "bg-orange-400",  cls: "bg-orange-50  text-orange-800  border-orange-200"  },
  RESOLVED:     { label: "Resolved",     dot: "bg-emerald-500", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  CLOSED:       { label: "Closed",       dot: "bg-slate-400",   cls: "bg-slate-100  text-slate-600   border-slate-300"   },
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const cfg = CFG[status] ?? CFG.OPEN;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border",
      cfg.cls,
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}
