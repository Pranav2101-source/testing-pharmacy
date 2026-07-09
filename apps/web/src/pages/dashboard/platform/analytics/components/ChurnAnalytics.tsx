import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useNavigate } from "react-router-dom";
import { TrendingDown, Building2, CreditCard, AlertOctagon } from "lucide-react";
import type { ChurnAnalytics } from "../analytics.types";
import { EmptyWidgetState } from "./EmptyWidgetState";

export function ChurnAnalyticsCard({ data }: { data: ChurnAnalytics }) {
  const navigate = useNavigate();

  const formatMoney = (val: number) => 
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h2 className="text-lg font-bold text-slate-800">Churn Analytics</h2>
        <div className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-xs font-bold border border-red-100 flex items-center gap-1.5">
          <TrendingDown className="w-3 h-3" />
          {data.churnRate}% Churn
        </div>
      </div>

      <div className="p-6 flex-1 flex flex-col gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div 
            onClick={() => navigate('/dashboard/subscriptions?status=CANCELLED')}
            className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm cursor-pointer hover:border-slate-300 hover:shadow transition-all group"
          >
            <div className="flex items-center gap-2 text-slate-500 mb-2">
              <CreditCard className="w-4 h-4 group-hover:text-red-500 transition-colors" />
              <span className="text-xs font-semibold uppercase tracking-wider">Cancelled</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{data.cancelledSubscriptions}</p>
          </div>

          <div 
            onClick={() => navigate('/dashboard/tenants?status=SUSPENDED')}
            className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm cursor-pointer hover:border-slate-300 hover:shadow transition-all group"
          >
            <div className="flex items-center gap-2 text-slate-500 mb-2">
              <Building2 className="w-4 h-4 group-hover:text-amber-500 transition-colors" />
              <span className="text-xs font-semibold uppercase tracking-wider">Suspended</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{data.suspendedPharmacies}</p>
          </div>

          <div className="p-4 rounded-xl border border-red-100 bg-red-50 shadow-sm">
            <div className="flex items-center gap-2 text-red-600 mb-2">
              <AlertOctagon className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Lost Revenue</span>
            </div>
            <p className="text-2xl font-bold text-red-700">{formatMoney(data.lostRevenue)}</p>
          </div>
        </div>

        <div className="flex-1 min-h-[150px] flex flex-col">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Churn Trend</h3>
          <div className="flex-1 min-h-0">
            {data.churnTrend.every(d => d.churned === 0) ? (
              <EmptyWidgetState message="No churn events recorded." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.churnTrend} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="churned" 
                    name="Churned Subs" 
                    stroke="#ef4444" 
                    strokeWidth={3} 
                    dot={{ r: 4, strokeWidth: 2 }} 
                    activeDot={{ r: 6 }} 
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
