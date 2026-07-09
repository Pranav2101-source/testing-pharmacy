import { api } from "@/lib/api-client";
import type { AnalyticsDashboard, ActivityItem, NewPharmacyDrilldownResult } from "./analytics.types";

export const analyticsApi = {
  getDashboard: (from: string, to: string, refresh = false) =>
    api.get<{ data: AnalyticsDashboard }>("/platform/analytics/dashboard", {
      params: { from, to, ...(refresh ? { refresh: "true" } : {}) },
    }).then(r => r.data.data),

  getActivity: (page: number, limit = 20) =>
    api.get<{ data: { items: ActivityItem[]; total: number } }>("/platform/analytics/activity", {
      params: { page, limit },
    }).then(r => r.data.data),

  exportData: (from: string, to: string, format: "csv" | "xlsx", allTime: boolean) => {
    return api.get("/platform/analytics/export", {
      params: { from, to, format, ...(allTime ? { allTime: "true" } : {}) },
      responseType: "blob",
    }).then((response) => {
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const ext = format === "xlsx" ? "xls" : "csv";
      link.setAttribute("download", allTime ? `platform-analytics-alltime.${ext}` : `platform-analytics-${from.split("T")[0]}_to_${to.split("T")[0]}.${ext}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  },

  getNewPharmacies: (params: { days?: number; page?: number; limit?: number; search?: string; plan?: string; status?: string; sort?: string }) =>
    api.get<{ data: NewPharmacyDrilldownResult }>("/platform/analytics/new-pharmacies", { params })
      .then(r => r.data.data),

  exportNewPharmacies: (params: { days?: number; search?: string; plan?: string; status?: string; sort?: string }) => {
    return api.get("/platform/analytics/new-pharmacies/export", {
      params,
      responseType: "blob",
    }).then((response) => {
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `NewPharmacies_Export_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  },
};
