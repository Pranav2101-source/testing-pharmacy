import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useNavigate } from "react-router-dom";
import type { GeographicData } from "../analytics.types";

export function GeographicInsights({ data }: { data: GeographicData }) {
  const navigate = useNavigate();
  
  const formatMoney = (val: number) => 
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
      <h2 className="text-lg font-bold text-slate-800 mb-6">Geographic Insights</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[400px]">
        
        {/* Pharmacies by State */}
        <div className="flex flex-col h-full">
          <h3 className="text-sm font-semibold text-slate-600 mb-4 flex items-center justify-between">
            Pharmacies by State
            <span className="text-xs font-normal bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200">Count</span>
          </h3>
          <div className="flex-1 min-h-0 bg-slate-50 rounded-xl p-2 border border-slate-100">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byState} layout="vertical" margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" hide />
                <YAxis dataKey="state" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} width={70} />
                <Tooltip cursor={{ fill: '#e2e8f0' }} contentStyle={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                <Bar 
                  dataKey="pharmacies" 
                  name="Pharmacies" 
                  fill="#3b82f6" 
                  radius={[0, 4, 4, 0]} 
                  barSize={12}
                  onClick={(d: any) => navigate(`/dashboard/tenants?state=${d.state}`)}
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue by State */}
        <div className="flex flex-col h-full">
          <h3 className="text-sm font-semibold text-slate-600 mb-4 flex items-center justify-between">
            Revenue by State
            <span className="text-xs font-normal bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200">MRR</span>
          </h3>
          <div className="flex-1 min-h-0 bg-slate-50 rounded-xl p-2 border border-slate-100">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byState} layout="vertical" margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" hide />
                <YAxis dataKey="state" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} width={70} />
                <Tooltip 
                  formatter={(val: any) => formatMoney(val)}
                  cursor={{ fill: '#e2e8f0' }} 
                  contentStyle={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} 
                />
                <Bar 
                  dataKey="revenue" 
                  name="Revenue" 
                  fill="#10b981" 
                  radius={[0, 4, 4, 0]} 
                  barSize={12}
                  onClick={(d: any) => navigate(`/dashboard/tenants?state=${d.state}`)}
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Doctors by State */}
        <div className="flex flex-col h-full">
          <h3 className="text-sm font-semibold text-slate-600 mb-4 flex items-center justify-between">
            Doctors by State
            <span className="text-xs font-normal bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200">Active</span>
          </h3>
          <div className="flex-1 min-h-0 bg-slate-50 rounded-xl p-2 border border-slate-100">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byState} layout="vertical" margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" hide />
                <YAxis dataKey="state" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} width={70} />
                <Tooltip cursor={{ fill: '#e2e8f0' }} contentStyle={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                <Bar 
                  dataKey="doctors" 
                  name="Doctors" 
                  fill="#8b5cf6" 
                  radius={[0, 4, 4, 0]} 
                  barSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
