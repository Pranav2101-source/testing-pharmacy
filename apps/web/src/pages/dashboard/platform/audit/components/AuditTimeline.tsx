import React from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock, ShieldAlert } from "lucide-react";
import { auditApi } from "../audit.api";
import type { AuditLogItem } from "../audit.types";

interface AuditTimelineProps {
  entity: string;
  entityId: string;
}

export function AuditTimeline({ entity, entityId }: AuditTimelineProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-audit-timeline", entity, entityId],
    queryFn: () => auditApi.getTimeline(entity, entityId),
    enabled: !!entity && !!entityId,
  });

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
      </div>
    );
  }

  const logs = data?.data || [];

  if (!logs.length) {
    return (
      <div className="text-center p-8 bg-surface-50 rounded-lg border border-surface-200">
        <Clock className="w-8 h-8 text-surface-400 mx-auto mb-2" />
        <p className="text-surface-500 text-sm">No historical events found for this entity.</p>
      </div>
    );
  }

  return (
    <div className="relative pl-6 space-y-6">
      {/* Timeline line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-surface-200" />
      
      {logs.map((log: AuditLogItem) => (
        <div key={log.id} className="relative">
          {/* Dot */}
          <div className={`absolute -left-6 top-1.5 w-3 h-3 rounded-full border-2 border-white
            ${log.severity === "ERROR" || log.severity === "CRITICAL" ? "bg-red-500" : 
              log.severity === "WARNING" ? "bg-orange-500" : "bg-brand-500"}`} 
          />
          
          <div className="bg-white border border-surface-200 rounded-lg p-3 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm text-surface-900">{log.action}</span>
              <span className="text-xs text-surface-500">
                {format(new Date(log.createdAt), "MMM d, h:mm a")}
              </span>
            </div>
            <p className="text-xs text-surface-500">
              By: {log.user?.email || log.userEmail || "System"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
