import { AlertTriangle, Info, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CriticalAlert } from "../analytics.types";

export function CriticalAlerts({ alerts }: { alerts: CriticalAlert[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const activeAlerts = alerts.filter(a => !dismissed.has(a.id));

  if (activeAlerts.length === 0) return null;

  const getSeverityClasses = (severity: string) => {
    switch (severity) {
      case "CRITICAL": return "bg-red-50 border-red-200 text-red-800";
      case "WARNING": return "bg-amber-50 border-amber-200 text-amber-800";
      case "INFO": return "bg-blue-50 border-blue-200 text-blue-800";
      default: return "bg-slate-50 border-slate-200 text-slate-800";
    }
  };

  return (
    <div className="flex flex-col gap-3 mb-8">
      {activeAlerts.map(alert => (
        <div 
          key={alert.id} 
          className={cn(
            "flex items-center justify-between gap-3 p-4 rounded-xl border shadow-sm font-medium",
            getSeverityClasses(alert.severity)
          )}
        >
          <div className="flex items-center gap-3">
            {alert.severity === "INFO" ? (
              <Info className="w-5 h-5 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0" />
            )}
            {alert.message}
          </div>
          <button 
            onClick={() => setDismissed(prev => new Set(prev).add(alert.id))}
            className="p-1 hover:bg-black/5 rounded-full transition-colors"
          >
            <X className="w-4 h-4 opacity-50 hover:opacity-100" />
          </button>
        </div>
      ))}
    </div>
  );
}
