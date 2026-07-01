import React from "react";

interface AuditChangesProps {
  oldData: any | null;
  newData: any | null;
}

export function AuditChanges({ oldData, newData }: AuditChangesProps) {
  if (!oldData && !newData) {
    return <div className="text-sm text-surface-500 py-4 text-center">No changes recorded</div>;
  }

  // Very basic diff view for this version
  return (
    <div className="space-y-4">
      {oldData && (
        <div>
          <h4 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">Previous State</h4>
          <pre className="bg-red-50 text-red-900 p-3 rounded-lg text-xs overflow-x-auto border border-red-100">
            {JSON.stringify(oldData, null, 2)}
          </pre>
        </div>
      )}
      
      {newData && (
        <div>
          <h4 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">New State</h4>
          <pre className="bg-emerald-50 text-emerald-900 p-3 rounded-lg text-xs overflow-x-auto border border-emerald-100">
            {JSON.stringify(newData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
