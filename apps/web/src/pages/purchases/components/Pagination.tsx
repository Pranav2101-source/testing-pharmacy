import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({ page, totalPages, total, limit, onChange }: {
  page: number; totalPages: number; total: number; limit: number; onChange: (p: number) => void;
}) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-slate-50/50 flex-shrink-0">
      <span className="text-[12px] text-slate-500">
        Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total} records
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}
          className="w-7 h-7 rounded-md border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[12px] text-slate-500 px-3 py-1 bg-white border border-slate-200 rounded-md min-w-[70px] text-center">
          Page {page} / {totalPages}
        </span>
        <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          className="w-7 h-7 rounded-md border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
