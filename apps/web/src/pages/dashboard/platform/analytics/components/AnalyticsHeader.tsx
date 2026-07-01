import { Download, RefreshCw, Calendar as CalendarIcon } from "lucide-react";
import type { AnalyticsDateRange } from "../analytics.types";

interface AnalyticsHeaderProps {
  range: AnalyticsDateRange;
  onRangeChange: (range: AnalyticsDateRange) => void;
  autoRefresh: number;
  onAutoRefreshChange: (val: number) => void;
  onRefresh: () => void;
  onExport: () => void;
  isRefetching: boolean;
}

export function AnalyticsHeader({
  range,
  onRangeChange,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  onExport,
  isRefetching
}: AnalyticsHeaderProps) {
  // Simple fixed ranges for now
  const handleRangeSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const to = new Date();
    let from = new Date();
    
    if (val === "TODAY") from = new Date(new Date().setHours(0,0,0,0));
    else if (val === "LAST_7_DAYS") from = new Date(to.getTime() - 7 * 86400000);
    else if (val === "LAST_30_DAYS") from = new Date(to.getTime() - 30 * 86400000);
    else if (val === "LAST_90_DAYS") from = new Date(to.getTime() - 90 * 86400000);
    else if (val === "THIS_YEAR") from = new Date(to.getFullYear(), 0, 1);
    
    onRangeChange({ from, to });
  };

  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Platform Analytics</h1>
        <p className="text-slate-500 mt-1">Business insights across all pharmacies and subscriptions.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
          <CalendarIcon className="w-4 h-4 text-slate-400" />
          <select 
            className="bg-transparent border-none text-sm font-medium text-slate-700 focus:ring-0 cursor-pointer outline-none"
            onChange={handleRangeSelect}
            defaultValue="LAST_30_DAYS"
          >
            <option value="TODAY">Today</option>
            <option value="LAST_7_DAYS">Last 7 Days</option>
            <option value="LAST_30_DAYS">Last 30 Days</option>
            <option value="LAST_90_DAYS">Last 90 Days</option>
            <option value="THIS_YEAR">This Year</option>
          </select>
        </div>

        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
          <span className="text-sm font-medium text-slate-500">Auto Refresh:</span>
          <select 
            className="bg-transparent border-none text-sm font-medium text-slate-700 focus:ring-0 cursor-pointer outline-none"
            value={autoRefresh}
            onChange={(e) => onAutoRefreshChange(Number(e.target.value))}
          >
            <option value={0}>OFF</option>
            <option value={30000}>30 sec</option>
            <option value={60000}>1 min</option>
            <option value={300000}>5 min</option>
          </select>
        </div>

        <button 
          onClick={onRefresh}
          disabled={isRefetching}
          className="p-2.5 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-slate-600 ${isRefetching ? 'animate-spin' : ''}`} />
        </button>

        <button 
          onClick={onExport}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export Report
        </button>
      </div>
    </div>
  );
}
