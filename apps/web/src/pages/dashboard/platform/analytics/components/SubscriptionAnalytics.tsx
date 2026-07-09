import { useNavigate } from "react-router-dom";

import type { SubscriptionAnalytics } from "../analytics.types";
import { EmptyWidgetState } from "./EmptyWidgetState";

const formatMoney = (val: number) => 
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);

export function SubscriptionAnalyticsCard({ data }: { data: SubscriptionAnalytics }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h2 className="text-lg font-bold text-slate-800">Subscription Health</h2>
      </div>
      
      <div className="p-6 flex-1 flex flex-col gap-6">
        {/* Renewals Summary */}
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Upcoming Renewals</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div 
              onClick={() => navigate('/dashboard/subscriptions?renewal=7DAYS')}
              className="p-3 bg-amber-50 rounded-xl border border-amber-100 cursor-pointer hover:bg-amber-100 transition-colors"
            >
              <p className="text-2xl font-bold text-amber-700">{data.renewals.expiringIn7Days}</p>
              <p className="text-xs font-medium text-amber-600 mt-1">in 7 Days</p>
            </div>
            <div 
              onClick={() => navigate('/dashboard/subscriptions?renewal=30DAYS')}
              className="p-3 bg-blue-50 rounded-xl border border-blue-100 cursor-pointer hover:bg-blue-100 transition-colors"
            >
              <p className="text-2xl font-bold text-blue-700">{data.renewals.expiringIn30Days}</p>
              <p className="text-xs font-medium text-blue-600 mt-1">in 30 Days</p>
            </div>
            <div 
              onClick={() => navigate('/dashboard/subscriptions?status=EXPIRED')}
              className="p-3 bg-slate-100 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors"
            >
              <p className="text-2xl font-bold text-slate-700">{data.renewals.expired}</p>
              <p className="text-xs font-medium text-slate-500 mt-1">Expired</p>
            </div>
            <div 
              onClick={() => navigate('/dashboard/subscriptions?status=CANCELLED')}
              className="p-3 bg-red-50 rounded-xl border border-red-100 cursor-pointer hover:bg-red-100 transition-colors"
            >
              <p className="text-2xl font-bold text-red-700">{data.renewals.cancelled}</p>
              <p className="text-xs font-medium text-red-600 mt-1">Cancelled</p>
            </div>
          </div>
        </div>

        {/* Plan Distribution */}
        <div className="flex-1">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Plan Distribution</h3>
          {data.planDistribution.length === 0 ? (
            <EmptyWidgetState message="No active plans." />
          ) : (
            <div className="space-y-3">
              {data.planDistribution.map(plan => (
                <div 
                  key={plan.plan}
                  onClick={() => navigate(`/dashboard/subscriptions?plan=${plan.plan}`)}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      plan.plan === 'Enterprise' ? 'bg-purple-500' :
                      plan.plan === 'Professional' ? 'bg-blue-500' :
                      plan.plan === 'Standard' ? 'bg-emerald-500' : 'bg-slate-400'
                    }`} />
                    <span className="text-sm font-medium text-slate-700">{plan.plan}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{plan.count}</p>
                    <p className="text-xs text-slate-500">{formatMoney(plan.revenue)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Metrics */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/50">
        <div className="p-4 text-center">
          <p className="text-xs font-medium text-slate-500">Collection Rate</p>
          <p className={`text-xl font-bold mt-1 ${data.collectionRate > 90 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {data.collectionRate}%
          </p>
        </div>
        <div className="p-4 text-center">
          <p className="text-xs font-medium text-slate-500">Outstanding</p>
          <p className="text-xl font-bold mt-1 text-slate-900">{formatMoney(data.outstandingRevenue)}</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-xs font-medium text-slate-500">Auto-Renew</p>
          <p className="text-xl font-bold mt-1 text-slate-900">{data.autoRenewPct}%</p>
        </div>
      </div>
    </div>
  );
}
