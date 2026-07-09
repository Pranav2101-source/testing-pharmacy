import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useNavigate } from "react-router-dom";
import type { TenantGrowthData } from "../analytics.types";
import { EmptyWidgetState } from "./EmptyWidgetState";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "#10b981",
  SUSPENDED: "#ef4444",
  TRIAL: "#f59e0b",
  EXPIRED: "#64748b",
};

export function TenantGrowth({ data }: { data: TenantGrowthData }) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      {/* New Pharmacies Chart */}
      <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-[350px]">
        <h2 className="text-lg font-bold text-slate-800 mb-6">Tenant Growth</h2>
        <div className="flex-1 min-h-0">
          {data.newPharmacies.every(d => d.count === 0) ? (
            <EmptyWidgetState message="No new tenants this period." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.newPharmacies} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip 
                  cursor={{ fill: '#f1f5f9' }}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="count" name="New Pharmacies" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Status Distribution */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-[350px]">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Status Distribution</h2>
        {data.statusDistribution.length === 0 ? (
          <EmptyWidgetState message="No status data available." />
        ) : (
          <>
            <div className="flex-1 min-h-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.statusDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="count"
                    nameKey="status"
                    onClick={(data: any) => navigate(`/dashboard/tenants?status=${data.status}`)}
                    className="cursor-pointer outline-none"
                  >
                    {data.statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status] || "#cbd5e1"} className="hover:opacity-80 transition-opacity" />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', padding: '8px 12px' }}
                    itemStyle={{ color: '#0f172a', fontWeight: 600 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-900">
                    {data.statusDistribution.reduce((acc, curr) => acc + curr.count, 0)}
                  </p>
                  <p className="text-xs text-slate-500">Total</p>
                </div>
              </div>
            </div>
            
            {/* Custom Legend */}
            <div className="flex flex-wrap justify-center gap-4 mt-2">
              {data.statusDistribution.map(entry => (
                <div key={entry.status} className="flex items-center gap-1.5 cursor-pointer" onClick={() => navigate(`/dashboard/tenants?status=${entry.status}`)}>
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[entry.status] || "#cbd5e1" }} />
                  <span className="text-xs font-medium text-slate-600 capitalize">{entry.status.toLowerCase()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
