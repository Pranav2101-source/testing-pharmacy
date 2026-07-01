import React from "react";
import type { AuditLogItem } from "../audit.types";

interface AuditMetadataProps {
  log: AuditLogItem;
}

export function AuditMetadata({ log }: AuditMetadataProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-50 p-3 rounded-lg border border-surface-200">
          <span className="text-xs text-surface-500 block mb-1">IP Address</span>
          <span className="text-sm font-medium text-surface-900 font-mono">
            {log.ipAddress || "Unknown"}
          </span>
        </div>
        <div className="bg-surface-50 p-3 rounded-lg border border-surface-200">
          <span className="text-xs text-surface-500 block mb-1">Request ID</span>
          <span className="text-sm font-medium text-surface-900 font-mono">
            {log.requestId || "N/A"}
          </span>
        </div>
      </div>

      <div className="bg-surface-50 p-3 rounded-lg border border-surface-200">
        <span className="text-xs text-surface-500 block mb-1">User Agent</span>
        <span className="text-sm text-surface-900 break-all">
          {log.userAgent || "Unknown"}
        </span>
      </div>

      <div className="bg-surface-50 p-3 rounded-lg border border-surface-200">
        <span className="text-xs text-surface-500 block mb-1">Log ID</span>
        <span className="text-sm text-surface-900 font-mono text-xs">
          {log.id}
        </span>
      </div>
    </div>
  );
}
