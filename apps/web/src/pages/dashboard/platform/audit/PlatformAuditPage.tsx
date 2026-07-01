import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Shield, Search, RefreshCw, Download, Filter } from "lucide-react";
import { auditApi, AuditLogFilters } from "./audit.api";
import { AuditKPICards } from "./components/AuditKPICards";
import { AuditTable } from "./components/AuditTable";
import { AuditFilters } from "./components/AuditFilters"; 
import { useToast } from "@/hooks/useToast";
import { Loader2 } from "lucide-react";

export default function PlatformAuditPage() {
  const [filters, setFilters] = useState<AuditLogFilters>({
    page: 1,
    limit: 50,
  });
  const [isExporting, setIsExporting] = useState(false);
  const toast = useToast();

  const { data: logData, isLoading: isLogsLoading, refetch } = useQuery({
    queryKey: ["platform-audit-logs", filters],
    queryFn: () => auditApi.getLogs(filters),
  });

  const { data: kpiData, isLoading: isKpisLoading } = useQuery({
    queryKey: ["platform-audit-kpis", { from: filters.from, to: filters.to }],
    queryFn: () => auditApi.getKPIs({ from: filters.from, to: filters.to }),
  });

  const handleExport = async () => {
    try {
      setIsExporting(true);
      await auditApi.exportCSV(filters);
      toast.success("Audit logs exported successfully");
    } catch (err) {
      toast.error("Failed to export audit logs");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-surface-50 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-brand-600" />
            Audit Center
          </h1>
          <p className="text-surface-500 mt-1">
            Track every important activity across the platform.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            className="p-2 text-surface-600 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors border border-surface-200"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-surface-200 text-surface-700 rounded-lg hover:bg-surface-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{isExporting ? "Exporting..." : "Export CSV"}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <AuditKPICards data={kpiData?.data} isLoading={isKpisLoading} />

      {/* Main Content Area */}
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm">
        
        {/* Filters */}
        <AuditFilters filters={filters} onChange={setFilters} />

        {/* Table */}
        <div className="overflow-x-auto">
          <AuditTable 
            data={logData?.data?.items || []} 
            total={logData?.data?.total || 0}
            isLoading={isLogsLoading} 
            page={filters.page || 1}
            limit={filters.limit || 50}
            onPageChange={(p) => setFilters(prev => ({ ...prev, page: p }))}
          />
        </div>
      </div>
    </div>
  );
}
