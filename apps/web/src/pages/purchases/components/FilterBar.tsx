import { Search, X, Calendar } from "lucide-react";
import type { Supplier } from "../types";

export function FilterBar({ search, onSearch, supplierId, onSupplier, suppliers, dateFrom, dateTo,
  onDateFrom, onDateTo, statusValue, onStatus, statusOptions, rightSlot }: {
  search: string; onSearch: (v: string) => void;
  supplierId: string; onSupplier: (v: string) => void;
  suppliers: Supplier[];
  dateFrom: string; dateTo: string;
  onDateFrom: (v: string) => void; onDateTo: (v: string) => void;
  statusValue: string; onStatus: (v: string) => void;
  statusOptions: { value: string; label: string }[];
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-white flex-shrink-0 flex-wrap">
      {/* Search */}
      <div className="flex items-center border border-slate-200 rounded-lg bg-slate-50/60 overflow-hidden h-8 flex-1 min-w-[180px] max-w-[260px] transition-colors focus-within:bg-white focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-50">
        <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 flex-shrink-0" />
        <input type="text" value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by number, name…"
          className="flex-1 px-2 text-[12px] text-slate-700 placeholder-slate-400 focus:outline-none h-full bg-transparent" />
        {search && (
          <button onClick={() => onSearch("")} className="mr-2 text-slate-300 hover:text-slate-500">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg bg-slate-50/60 h-8 px-2.5 text-[12px] text-slate-600">
        <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <input type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)}
          className="focus:outline-none bg-transparent text-[12px] text-slate-600 w-[92px]" />
        <span className="text-slate-300">–</span>
        <input type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)}
          className="focus:outline-none bg-transparent text-[12px] text-slate-600 w-[92px]" />
      </div>

      {/* Distributor */}
      <select value={supplierId} onChange={(e) => onSupplier(e.target.value)}
        className="border border-slate-200 rounded-lg bg-slate-50/60 h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none focus:bg-white focus:border-blue-300 min-w-[140px] max-w-[180px] transition-colors">
        <option value="">All Distributors</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {/* Status */}
      <select value={statusValue} onChange={(e) => onStatus(e.target.value)}
        className="border border-slate-200 rounded-lg bg-slate-50/60 h-8 px-2.5 text-[12px] text-slate-600 focus:outline-none focus:bg-white focus:border-blue-300 min-w-[110px] transition-colors">
        <option value="">All Status</option>
        {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
    </div>
  );
}
