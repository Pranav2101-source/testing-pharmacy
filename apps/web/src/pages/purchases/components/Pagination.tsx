import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({ page, totalPages, total, limit, onChange }: {
  page: number; totalPages: number; total: number; limit: number; onChange: (p: number) => void;
}) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-200 bg-gradient-to-b from-slate-50 to-slate-50/60 flex-shrink-0">
      <span className="text-[12px] text-slate-500 font-medium">
        Showing <strong className="text-slate-700">{Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)}</strong> of <strong className="text-slate-700">{total}</strong> records
      </span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}
          className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:border-slate-300 shadow-card disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[12px] font-semibold text-slate-600 px-3 py-1 bg-white border border-slate-200 rounded-lg min-w-[70px] text-center shadow-card">
          Page {page} / {totalPages}
        </span>
        <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}
          className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:border-slate-300 shadow-card disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
