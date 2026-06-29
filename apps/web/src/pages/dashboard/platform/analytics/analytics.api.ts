import { api } from "@/lib/api-client";
import type { AnalyticsDashboard, ActivityItem } from "./analytics.types";

export const analyticsApi = {
  getDashboard: (from: string, to: string, refresh = false) =>
    api.get<{ data: AnalyticsDashboard }>("/platform/analytics/dashboard", {
      params: { from, to, ...(refresh ? { refresh: "true" } : {}) },
    }).then(r => r.data.data),

  getActivity: (page: number, limit = 20) =>
    api.get<{ data: { items: ActivityItem[]; total: number } }>("/platform/analytics/activity", {
      params: { page, limit },
    }).then(r => r.data.data),

  exportCSV: (from: string, to: string) => {
    return api.get("/platform/analytics/export", {
      params: { from, to },
      responseType: "blob",
    }).then((response) => {
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `platform-analytics-${from.split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  },
};
