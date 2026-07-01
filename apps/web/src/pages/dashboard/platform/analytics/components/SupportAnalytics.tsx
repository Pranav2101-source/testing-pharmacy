import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useNavigate } from "react-router-dom";
import { LifeBuoy, Clock } from "lucide-react";
import type { SupportAnalytics } from "../analytics.types";

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "#3b82f6",
  NORMAL: "#10b981",
  HIGH: "#f59e0b",
  URGENT: "#ef4444",
};

export function SupportAnalyticsCard({ data }: { data: SupportAnalytics }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-slate-800">Support Analytics</h2>
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <LifeBuoy className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Open Tickets</p>
              <p className="text-xl font-bold text-slate-900">{data.openTickets}</p>
            </div>
          </div>
          <div className="w-px h-10 bg-slate-200" />
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Resolution</p>
              <p className="text-xl font-bold text-slate-900">{data.avgResolutionTimeHours}h</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[300px]">
        {/* Trend */}
        <div className="lg:col-span-2 flex flex-col h-full border border-slate-100 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Ticket Volume Trend</h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.ticketTrend} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                />
                <Line type="monotone" dataKey="opened" name="Opened" stroke="#ef4444" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Priority */}
        <div className="flex flex-col h-full border border-slate-100 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">By Priority</h3>
          <div className="flex-1 min-h-0 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.byPriority}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="count"
                  nameKey="priority"
                >
                  {data.byPriority.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PRIORITY_COLORS[entry.priority] || "#cbd5e1"} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', padding: '8px 12px' }}
                  itemStyle={{ color: '#0f172a', fontWeight: 600 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            {data.byPriority.map(entry => (
              <div key={entry.priority} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[entry.priority] || "#cbd5e1" }} />
                <span className="text-xs font-medium text-slate-600 capitalize">{entry.priority.toLowerCase()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
