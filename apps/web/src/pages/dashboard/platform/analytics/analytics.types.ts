export type AnalyticsDateRange = { from: Date; to: Date };

export type KPICard = {
  key: string;
  label: string;
  value: number;
  formattedValue: string;
  change: number; // % vs previous period
  changeLabel: string; // e.g. "vs last 30 days"
  sparkline: number[]; // 7 data points for mini chart
};

export type RevenueAnalytics = {
  revenueGrowth: { date: string; mrr: number; arr: number; revenue: number }[];
  byPlan: { plan: string; revenue: number; count: number }[];
  byState: { state: string; revenue: number; pharmacyCount: number }[];
};

export type TenantGrowthData = {
  newPharmacies: { date: string; count: number }[];
  statusDistribution: { status: string; count: number }[];
};

export type SubscriptionAnalytics = {
  planDistribution: { plan: string; count: number; revenue: number }[];
  renewals: { expiringIn7Days: number; expiringIn30Days: number; expired: number; cancelled: number };
  collectionRate: number;
  outstandingRevenue: number;
  autoRenewPct: number;
};

export type ChurnAnalytics = {
  cancelledSubscriptions: number;
  suspendedPharmacies: number;
  lostRevenue: number;
  churnRate: number;
  churnTrend: { date: string; churned: number }[];
};

export type UsageStats = {
  mostActivePharmacies: { id: string; name: string; invoiceCount: number }[];
  topDoctors: { id: string; name: string; pharmacyName: string; prescriptionCount: number }[];
  featureUsage: { feature: string; count: number }[];
};

export type SearchAnalytics = {
  totalSearches: number;
  avgLatency: number;
  indexStats: { name: string; documents: number; fieldDistribution: Record<string, number> }[];
};

export type SupportAnalytics = {
  openTickets: number;
  avgResolutionTimeHours: number;
  byCategory: { category: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  byAgent: { agent: string; count: number }[];
  ticketTrend: { date: string; opened: number; resolved: number }[];
};

export type SystemHealth = {
  database: { status: string; latencyMs: number; sizeGb: number };
  redis: { status: string; connected: boolean };
  queue: { status: string; waiting: number; active: number; failed: number };
  api: { avgLatencyMs: number; requestsPerMin: number };
  backgroundJobs: { completed: number; failed: number; queued: number };
  storage: { usedMb: number; fileCount: number };
};

export type CriticalAlert = {
  id: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  message: string;
  category: string; // e.g. 'subscription', 'system', 'support'
};

export type GeographicData = {
  byState: { state: string; pharmacies: number; revenue: number; doctors: number }[];
};

export type ActivityItem = {
  id: string;
  type: string;
  message: string;
  entityName?: string;
  timestamp: string;
  metadata?: Record<string, any>;
};

export type TopListEntry = {
  rank: number;
  id: string;
  name: string;
  value: number;
  subtitle?: string;
};

export type AnalyticsDashboard = {
  executive: KPICard[];
  alerts: CriticalAlert[];
  revenue: RevenueAnalytics;
  tenants: TenantGrowthData;
  subscriptions: SubscriptionAnalytics;
  churn: ChurnAnalytics;
  usage: UsageStats;
  search: SearchAnalytics | null; // null if Meilisearch unavailable
  support: SupportAnalytics;
  health: SystemHealth;
  geographic: GeographicData;
  activity: ActivityItem[];
  topLists: {
    topRevenue: TopListEntry[];
    topActive: TopListEntry[];
    topSupport: TopListEntry[];
    topDoctors: TopListEntry[];
    topGrowing: TopListEntry[];
  };
};

export type DateRangePreset = "TODAY" | "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_90_DAYS" | "THIS_YEAR" | "CUSTOM";
export type AutoRefreshInterval = 0 | 30000 | 60000 | 300000;
