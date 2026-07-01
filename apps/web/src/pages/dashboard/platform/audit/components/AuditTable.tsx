import React, { useState } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Eye, ShieldAlert, CheckCircle2, XCircle, Clock } from "lucide-react";
import type { AuditLogItem } from "../audit.types";
import { AuditDrawer } from "./AuditDrawer";

interface AuditTableProps {
  data: AuditLogItem[];
  total: number;
  isLoading: boolean;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export function AuditTable({ data, total, isLoading, page, limit, onPageChange }: AuditTableProps) {
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  const totalPages = Math.ceil(total / limit);

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "CRITICAL": return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Critical</span>;
      case "ERROR": return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">Error</span>;
      case "WARNING": return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Warning</span>;
      default: return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Info</span>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "SUCCESS": return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "FAILED": return <XCircle className="w-4 h-4 text-red-500" />;
      case "PENDING": return <Clock className="w-4 h-4 text-orange-500" />;
      default: return null;
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="p-12 text-center">
        <div className="w-12 h-12 bg-surface-100 text-surface-400 rounded-full flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-medium text-surface-900 mb-1">No audit events found</h3>
        <p className="text-surface-500">Try adjusting your filters or search term.</p>
      </div>
    );
  }

  return (
    <>
      <div className="min-w-[1000px]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-50/50 border-b border-surface-200">
              <th className="px-6 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Date & Time</th>
              <th className="px-6 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Module</th>
              <th className="px-6 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Action</th>
              <th className="px-6 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Actor</th>
              <th className="px-6 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Target</th>
              <th className="px-6 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200">
            {data.map((log) => (
              <tr key={log.id} className="hover:bg-surface-50/50 transition-colors group">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-surface-900">
                    {format(new Date(log.createdAt), "MMM d, yyyy")}
                  </div>
                  <div className="text-xs text-surface-500">
                    {format(new Date(log.createdAt), "h:mm:ss a")}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm font-medium text-surface-700">{log.module}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-surface-900">{log.action}</div>
                  <div className="mt-1">{getSeverityBadge(log.severity)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-surface-900">{log.user?.email || log.userEmail || "System"}</div>
                  <div className="text-xs text-surface-500">{log.pharmacy?.name || "Platform"}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-surface-700">{log.entity}</div>
                  <div className="text-xs text-surface-500 truncate max-w-[150px]" title={log.resourceName || log.entityId || "-"}>
                    {log.resourceName || log.entityId || "-"}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(log.status)}
                    <span className="text-sm text-surface-700">{log.status}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => setSelectedLog(log)}
                    className="text-brand-600 hover:text-brand-900 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-brand-50 rounded-lg"
                    title="View Details"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-surface-200 flex items-center justify-between bg-surface-50/30">
          <p className="text-sm text-surface-600">
            Showing <span className="font-medium">{(page - 1) * limit + 1}</span> to{" "}
            <span className="font-medium">{Math.min(page * limit, total)}</span> of{" "}
            <span className="font-medium">{total}</span> results
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              className="p-2 border border-surface-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages}
              className="p-2 border border-surface-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {selectedLog && (
        <AuditDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </>
  );
}
