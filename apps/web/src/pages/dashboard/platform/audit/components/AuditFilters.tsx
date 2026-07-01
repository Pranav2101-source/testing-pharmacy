import React, { useState, useEffect } from "react";
import { Search, Filter, X } from "lucide-react";
import type { AuditLogFilters } from "../audit.api";
import { useDebounce } from "@/hooks/useDebounce";

interface AuditFiltersProps {
  filters: AuditLogFilters;
  onChange: (filters: AuditLogFilters) => void;
}

export function AuditFilters({ filters, onChange }: AuditFiltersProps) {
  const [searchTerm, setSearchTerm] = useState(filters.search || "");
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    onChange({ ...filters, search: debouncedSearch || undefined, page: 1 });
  }, [debouncedSearch]);

  const handleChange = (key: keyof AuditLogFilters, value: string) => {
    onChange({ ...filters, [key]: value || undefined, page: 1 });
  };

  const handleClear = () => {
    setSearchTerm("");
    onChange({ page: 1, limit: 50 });
  };

  const modules = ["AUTH", "TENANTS", "SUBSCRIPTIONS", "SUPPORT", "SETTINGS", "SYSTEM", "ANALYTICS", "AUDIT", "BILLING", "INVENTORY"];
  const severities = ["INFO", "WARNING", "ERROR", "CRITICAL"];
  const statuses = ["SUCCESS", "FAILED", "PENDING"];

  return (
    <div className="border-b border-surface-200 bg-surface-50/50 p-4 space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input
            type="text"
            placeholder="Search events, user email, or IDs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-surface-200 rounded-lg text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
          />
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
            isExpanded 
              ? "bg-brand-50 border-brand-200 text-brand-700" 
              : "bg-white border-surface-200 text-surface-700 hover:bg-surface-50"
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>
        {(filters.module || filters.severity || filters.status || filters.search) && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
          >
            <X className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-surface-200">
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Module</label>
            <select
              value={filters.module || ""}
              onChange={(e) => handleChange("module", e.target.value)}
              className="w-full p-2 bg-white border border-surface-200 rounded-lg text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Modules</option>
              {modules.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Severity</label>
            <select
              value={filters.severity || ""}
              onChange={(e) => handleChange("severity", e.target.value)}
              className="w-full p-2 bg-white border border-surface-200 rounded-lg text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Severities</option>
              {severities.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Status</label>
            <select
              value={filters.status || ""}
              onChange={(e) => handleChange("status", e.target.value)}
              className="w-full p-2 bg-white border border-surface-200 rounded-lg text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
