import { useState, useMemo } from "react";
import { api } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "./analytics.api";
import { AnalyticsHeader } from "./components/AnalyticsHeader";
import { CriticalAlerts } from "./components/CriticalAlerts";
import { ExecutiveCards } from "./components/ExecutiveCards";
import { RevenueSection } from "./components/RevenueSection";
import { TenantGrowth } from "./components/TenantGrowth";
import { SubscriptionAnalyticsCard } from "./components/SubscriptionAnalytics";
import { ChurnAnalyticsCard } from "./components/ChurnAnalytics";
import { ProductUsage } from "./components/ProductUsage";
import { SearchAnalyticsCard } from "./components/SearchAnalytics";
import { SupportAnalyticsCard } from "./components/SupportAnalytics";
import { SystemHealthCard } from "./components/SystemHealth";
import { GeographicInsights } from "./components/GeographicInsights";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { TopLists } from "./components/TopLists";
import { NewPharmaciesDrawer } from "./components/NewPharmaciesDrawer";
import { TenantDrawer } from "../components/TenantDrawer";
import type { AnalyticsDateRange } from "./analytics.types";
import { AlertCircle } from "lucide-react";

export default function PlatformAnalyticsPage() {
  const [autoRefresh, setAutoRefresh] = useState<number>(0);
  const [isNewPharmaciesDrawerOpen, setIsNewPharmaciesDrawerOpen] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  // Generate 30-day rolling window for charts
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    return { from, to };
  }, []);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["platform-analytics", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => analyticsApi.getDashboard(range.from.toISOString(), range.to.toISOString(), false),
    refetchInterval: autoRefresh || false,
    staleTime: 30_000,
  });

  const handleExport = async (format: "csv" | "xlsx", startDate: string, endDate: string) => {
    try {
      const qs = new URLSearchParams({
        from: startDate,
        to: endDate,
        format,
        allTime: "false"
      }).toString();
      
      const res = await api.get(`/platform/analytics/export?${qs}`, {
        responseType: 'blob'
      });
      
      // Get filename from Content-Disposition header if possible, else default
      let filename = `PlatformAnalytics_${startDate}_to_${endDate}.${format}`;
      const disposition = res.headers['content-disposition'];
      if (disposition && disposition.indexOf('attachment') !== -1) {
        const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
        const matches = filenameRegex.exec(disposition);
        if (matches != null && matches[1]) { 
          filename = matches[1].replace(/['"]/g, '');
        }
      }
      
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 h-full overflow-y-auto">
      <AnalyticsHeader 
        autoRefresh={autoRefresh} 
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => {
          analyticsApi.getDashboard(range.from.toISOString(), range.to.toISOString(), true).then(() => refetch());
        }} 
        onExport={handleExport}
        isRefetching={isRefetching}
      />

      {isLoading ? (
        <div className="flex flex-col gap-8 animate-pulse">
          <div className="grid grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => <div key={i} className="h-32 bg-slate-200 rounded-2xl" />)}
          </div>
          <div className="h-[400px] bg-slate-200 rounded-2xl" />
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 h-[350px] bg-slate-200 rounded-2xl" />
            <div className="h-[350px] bg-slate-200 rounded-2xl" />
          </div>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl flex flex-col items-center justify-center text-center h-[400px]">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Failed to load analytics</h2>
          <p className="text-slate-600 mb-6 max-w-md">There was a problem retrieving the analytics data from the server. Please try again.</p>
          <button 
            onClick={() => refetch()}
            className="px-6 py-2 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-colors shadow-sm"
          >
            Retry Now
          </button>
        </div>
      ) : data ? (
        <>
          <CriticalAlerts alerts={data.alerts} />
          <ExecutiveCards 
            cards={data.executive} 
            onCardClick={(key) => {
              if (key === "newPharmacies") setIsNewPharmaciesDrawerOpen(true);
            }} 
          />
          <RevenueSection data={data.revenue} />
          <TenantGrowth data={data.tenants} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8">
            <SubscriptionAnalyticsCard data={data.subscriptions} />
            <ChurnAnalyticsCard data={data.churn} />
          </div>
          <ProductUsage data={data.usage} />
          {data.search && <SearchAnalyticsCard data={data.search} />}
          <SupportAnalyticsCard data={data.support} />
          <SystemHealthCard data={data.health} />
          <GeographicInsights data={data.geographic} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 pb-12">
            <ActivityTimeline items={data.activity} />
            <TopLists data={data.topLists} />
          </div>
        </>
      ) : null}

      <NewPharmaciesDrawer 
        isOpen={isNewPharmaciesDrawerOpen} 
        onClose={() => setIsNewPharmaciesDrawerOpen(false)} 
        days={30} 
        onTenantClick={(tenantId) => {
          setSelectedTenantId(tenantId);
          setIsNewPharmaciesDrawerOpen(false);
        }} 
      />
      
      <TenantDrawer 
        tenantId={selectedTenantId} 
        onClose={() => setSelectedTenantId(null)} 
      />
    </div>
  );
}
