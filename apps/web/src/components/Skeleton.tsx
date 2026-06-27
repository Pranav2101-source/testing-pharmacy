import { cn } from "@/lib/utils";

// Base shimmering placeholder block. `.skeleton` (globals.css) provides the
// shimmer animation; this just gives it a sane default shape.
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-3.5 w-full rounded", className)} />;
}

// Skeleton rows for a `<table>` body — drop in place of the real <tr>s while
// loading. `widths` lets each column's bar vary in width so the skeleton
// roughly tracks the real content shape (e.g. a narrow "Sr No." column vs a
// wide "Distributor" column); purely cosmetic, doesn't need to be exact.
export function TableSkeletonRows({
  columns,
  rows = 8,
  widths,
}: {
  columns: number;
  rows?:   number;
  widths?: string[];
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className={cn("border-b border-slate-100", r % 2 === 1 && "bg-slate-50/40")}>
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className={widths?.[c] ?? "w-16"} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Skeleton placeholders for card-list panels (slide-in panels showing a list
// of small cards rather than a table) — e.g. OverdueBillsPanel,
// PendingApprovalsPanel.
export function CardSkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border border-slate-200 bg-slate-50/40 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
            <Skeleton className="h-4 w-16 flex-shrink-0" />
          </div>
          <Skeleton className="h-7 w-full rounded-lg" />
        </div>
      ))}
    </>
  );
}

// Same idea for CSS-grid row layouts (non-<table> lists). `gridClass` should
// be the exact grid-template-columns class the real rows use, so skeleton
// rows line up under the real header.
export function GridSkeletonRows({
  gridClass,
  columns,
  rows = 6,
}: {
  gridClass: string;
  columns:   number;
  rows?:     number;
}) {
  return (
    <div className="divide-y divide-slate-50">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={cn("grid gap-4 items-center px-5 py-3.5", gridClass)}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="w-3/4" />
          ))}
        </div>
      ))}
    </div>
  );
}
