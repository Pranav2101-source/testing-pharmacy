import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { AuditLogItem } from "../audit.types";
import { AuditChanges } from "./AuditChanges";
import { AuditMetadata } from "./AuditMetadata";
import { AuditTimeline } from "./AuditTimeline";

interface AuditDrawerProps {
  log: AuditLogItem;
  onClose: () => void;
}

type TabType = "DETAILS" | "CHANGES" | "TIMELINE";

export function AuditDrawer({ log, onClose }: AuditDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>("DETAILS");

  useEffect(() => {
    // Lock scrolling on mount
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    
    // Restore scrolling on unmount
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity" 
        onClick={onClose} 
      />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col transform transition-transform border-l border-surface-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-200 bg-surface-50">
          <div>
            <h2 className="text-lg font-semibold text-surface-900">Event Details</h2>
            <p className="text-sm text-surface-500">{log.action}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-surface-500 hover:text-surface-900 hover:bg-surface-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-200 px-4">
          <button
            onClick={() => setActiveTab("DETAILS")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "DETAILS" 
                ? "border-brand-600 text-brand-600" 
                : "border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300"
            }`}
          >
            Metadata
          </button>
          <button
            onClick={() => setActiveTab("CHANGES")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "CHANGES" 
                ? "border-brand-600 text-brand-600" 
                : "border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300"
            }`}
          >
            Changes
          </button>
          {log.entityId && (
            <button
              onClick={() => setActiveTab("TIMELINE")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "TIMELINE" 
                  ? "border-brand-600 text-brand-600" 
                  : "border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300"
              }`}
            >
              Timeline
            </button>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-white">
          {activeTab === "DETAILS" && (
            <AuditMetadata log={log} />
          )}

          {activeTab === "CHANGES" && (
            <AuditChanges oldData={log.oldData} newData={log.newData} />
          )}

          {activeTab === "TIMELINE" && log.entityId && (
            <div className="space-y-4">
              <div className="bg-brand-50 p-3 rounded-lg border border-brand-100 mb-4 text-sm text-brand-800">
                Showing activity history for <strong>{log.entity}</strong>: {log.resourceName || log.entityId}
              </div>
              <AuditTimeline entity={log.entity} entityId={log.entityId} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-200 bg-surface-50">
          <button
            onClick={onClose}
            className="w-full py-2 bg-white border border-surface-300 rounded-lg text-sm font-medium text-surface-700 hover:bg-surface-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
