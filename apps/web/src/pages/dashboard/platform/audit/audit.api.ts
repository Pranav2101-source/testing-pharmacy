import { api } from "@/lib/api-client";
import type { AuditLogResponse, AuditKPIResponse, AuditTimelineResponse, AuditLogItem } from "./audit.types";

export interface AuditLogFilters {
  page?: number;
  limit?: number;
  search?: string;
  module?: string;
  action?: string;
  severity?: string;
  status?: string;
  from?: string;
  to?: string;
}

export const auditApi = {
  getLogs: async (filters: AuditLogFilters): Promise<AuditLogResponse> => {
    const params = new URLSearchParams();
    if (filters.page) params.append("page", filters.page.toString());
    if (filters.limit) params.append("limit", filters.limit.toString());
    if (filters.search) params.append("search", filters.search);
    if (filters.module) params.append("module", filters.module);
    if (filters.action) params.append("action", filters.action);
    if (filters.severity) params.append("severity", filters.severity);
    if (filters.status) params.append("status", filters.status);
    if (filters.from) params.append("from", filters.from);
    if (filters.to) params.append("to", filters.to);

    const res = await api.get<AuditLogResponse>(`/platform/audit?${params.toString()}`);
    return res.data;
  },

  getKPIs: async (filters: Omit<AuditLogFilters, "page" | "limit" | "search">): Promise<AuditKPIResponse> => {
    const params = new URLSearchParams();
    if (filters.from) params.append("from", filters.from);
    if (filters.to) params.append("to", filters.to);
    
    const res = await api.get<AuditKPIResponse>(`/platform/audit/kpis?${params.toString()}`);
    return res.data;
  },

  getLogDetail: async (id: string): Promise<{ success: boolean; data: AuditLogItem }> => {
    const res = await api.get<{ success: boolean; data: AuditLogItem }>(`/platform/audit/${id}`);
    return res.data;
  },

  getTimeline: async (entity: string, entityId: string): Promise<AuditTimelineResponse> => {
    const params = new URLSearchParams();
    params.append("entity", entity);
    params.append("entityId", entityId);
    
    const res = await api.get<AuditTimelineResponse>(`/platform/audit/timeline?${params.toString()}`);
    return res.data;
  },

  exportCSV: async (filters: Omit<AuditLogFilters, "page" | "limit">): Promise<void> => {
    const params = new URLSearchParams();
    if (filters.search) params.append("search", filters.search);
    if (filters.module) params.append("module", filters.module);
    if (filters.action) params.append("action", filters.action);
    if (filters.severity) params.append("severity", filters.severity);
    if (filters.status) params.append("status", filters.status);
    if (filters.from) params.append("from", filters.from);
    if (filters.to) params.append("to", filters.to);
    
    const response = await api.get(`/platform/audit/export?${params.toString()}`, {
      responseType: "blob",
    });

    const blob = new Blob([response.data], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-${new Date().toISOString()}.csv`;

    link.click();
    URL.revokeObjectURL(url);
  }
};
