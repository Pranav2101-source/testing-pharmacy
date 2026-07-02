import { useState, useRef, useEffect } from "react";
import { Download, RefreshCw, Calendar as CalendarIcon, ChevronDown, FileText, FileSpreadsheet } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { AnalyticsDateRange } from "../analytics.types";
import { cn } from "@/lib/utils";

import { ExportReportModal } from "./ExportReportModal";

interface AnalyticsHeaderProps {
  autoRefresh: number;
  onAutoRefreshChange: (val: number) => void;
  onRefresh: () => void;
  onExport: (format: "csv" | "xlsx", startDate: string, endDate: string) => void;
  isRefetching: boolean;
}

export function AnalyticsHeader({
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  onExport,
  isRefetching
}: AnalyticsHeaderProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const handleExportSubmit = (format: "csv" | "xlsx", startDate: string, endDate: string) => {
    onExport(format, startDate, endDate);
  };

  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Platform Analytics</h1>
        <p className="text-slate-500 mt-1">Business insights across all pharmacies and subscriptions.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">


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

        <div>
          <button 
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 rounded-lg text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Report
          </button>
          
          <ExportReportModal
            isOpen={exportOpen}
            onClose={() => setExportOpen(false)}
            onExport={handleExportSubmit}
          />
        </div>
      </div>
    </div>
  );
}
