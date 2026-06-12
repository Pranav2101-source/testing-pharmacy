import { cn } from "@/lib/utils";

export function StatusBadge<T extends string>({ status, cfg }: {
  status: T; cfg: Record<string, { label: string; cls: string; icon?: React.ElementType }>;
}) {
  const c = cfg[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  const Icon = (c as any).icon as React.ElementType | undefined;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap", c.cls)}>
      {Icon && <Icon className="w-2.5 h-2.5" />}{c.label}
    </span>
  );
}
