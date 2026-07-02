import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useNavigate } from "react-router-dom";
import type { RevenueAnalytics } from "../analytics.types";
import { EmptyWidgetState } from "./EmptyWidgetState";

export function RevenueSection({ data }: { data: RevenueAnalytics }) {
  const navigate = useNavigate();

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
      {/* Revenue Growth Line Chart */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-[400px]">
        <h2 className="text-lg font-bold text-slate-800 mb-6">Revenue Growth</h2>
        <div className="flex-1 min-h-0">
          {data.revenueGrowth.every(d => d.mrr === 0 && d.arr === 0) ? (
            <EmptyWidgetState message="No revenue recorded for this period." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.revenueGrowth} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                <YAxis 
                  yAxisId="left"
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  tickFormatter={(val) => `₹${val / 1000}k`}
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  tickFormatter={(val) => `₹${val / 1000}k`}
                />
                <Tooltip 
                  formatter={(value: any) => formatCurrency(value)}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                <Line yAxisId="left" type="monotone" dataKey="mrr" name="MRR" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                <Line yAxisId="right" type="monotone" dataKey="arr" name="ARR" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-rows-2 gap-6 h-[400px]">
        {/* Revenue by Plan */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-0">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Revenue by Plan</h2>
          <div className="flex-1 min-h-0">
            {data.byPlan.length === 0 ? (
              <EmptyWidgetState message="No revenue by plan." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byPlan} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="plan" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={5} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(val) => `₹${val / 1000}k`} />
                  <Tooltip 
                    formatter={(value: any) => formatCurrency(value)}
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                  />
                  <Bar 
                    dataKey="revenue" 
                    name="Revenue" 
                    fill="#8b5cf6" 
                    radius={[4, 4, 0, 0]} 
                    onClick={(data: any) => navigate(`/dashboard/subscriptions?plan=${data.plan}`)}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Revenue by State */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-0">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Revenue by State</h2>
          <div className="flex-1 min-h-0">
            {data.byState.length === 0 ? (
              <EmptyWidgetState message="No regional data available." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byState} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="state" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} width={80} />
                  <Tooltip 
                    formatter={(value: any) => formatCurrency(value)}
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                  />
                  <Bar 
                    dataKey="revenue" 
                    name="Revenue" 
                    fill="#10b981" 
                    radius={[0, 4, 4, 0]} 
                    barSize={16}
                    onClick={(data: any) => navigate(`/dashboard/tenants?state=${data.state}`)}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
