import { cn } from "@/lib/utils";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

const PRIORITIES: { value: Priority; label: string; dot: string; color: string }[] = [
  { value: "LOW",    label: "Low",    dot: "bg-emerald-500", color: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200" },
  { value: "MEDIUM", label: "Medium", dot: "bg-yellow-500",  color: "bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border-yellow-200" },
  { value: "HIGH",   label: "High",   dot: "bg-orange-500",  color: "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200" },
  { value: "URGENT", label: "Urgent", dot: "bg-red-500",     color: "bg-red-50 text-red-700 hover:bg-red-100 border-red-200" },
];

type Props = {
  value: Priority;
  onChange: (val: Priority) => void;
  disabled?: boolean;
};

export function TicketPriority({ value, onChange, disabled }: Props) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Priority</label>
      <div className="flex flex-wrap gap-2">
        {PRIORITIES.map((p) => {
          const isActive = value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p.value)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[13px] font-semibold transition-all disabled:opacity-50",
                isActive ? p.color : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", p.dot, !isActive && "opacity-60")} />
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
