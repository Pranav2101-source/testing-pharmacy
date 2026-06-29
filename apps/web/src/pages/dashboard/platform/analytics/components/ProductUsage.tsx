import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useNavigate } from "react-router-dom";
import type { UsageStats } from "../analytics.types";

export function ProductUsage({ data }: { data: UsageStats }) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      {/* Most Active Pharmacies */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-[350px]">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Most Active Pharmacies</h2>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.mostActivePharmacies} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} width={80} />
              <Tooltip 
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
              />
              <Bar 
                dataKey="invoiceCount" 
                name="Invoices" 
                fill="#3b82f6" 
                radius={[0, 4, 4, 0]} 
                barSize={16}
                onClick={(d) => navigate(`/dashboard/tenants?search=${d.name}`)}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Doctors */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-[350px]">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Top Doctors</h2>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.topDoctors} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} width={80} />
              <Tooltip 
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                formatter={(val, name, props: any) => [val, `${name} (${props.payload.pharmacyName})`]}
              />
              <Bar 
                dataKey="prescriptionCount" 
                name="Prescriptions" 
                fill="#8b5cf6" 
                radius={[0, 4, 4, 0]} 
                barSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Feature Usage */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-[350px]">
        <h2 className="text-sm font-bold text-slate-800 mb-4">Platform Feature Usage</h2>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.featureUsage} margin={{ top: 20, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="feature" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
              <Tooltip 
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
              />
              <Bar 
                dataKey="count" 
                name="Usage Count" 
                fill="#f59e0b" 
                radius={[4, 4, 0, 0]} 
                barSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
