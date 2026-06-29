import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trophy, Activity, LifeBuoy, Users, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TopListEntry, AnalyticsDashboard } from "../analytics.types";

const tabs = [
  { id: "topRevenue", label: "Top Revenue", icon: <Trophy className="w-4 h-4" /> },
  { id: "topActive", label: "Most Active", icon: <Activity className="w-4 h-4" /> },
  { id: "topSupport", label: "Top Support", icon: <LifeBuoy className="w-4 h-4" /> },
  { id: "topDoctors", label: "Top Doctors", icon: <Users className="w-4 h-4" /> },
  { id: "topGrowing", label: "Fastest Growing", icon: <TrendingUp className="w-4 h-4" /> },
] as const;

export function TopLists({ data }: { data: AnalyticsDashboard["topLists"] }) {
  const [activeTab, setActiveTab] = useState<typeof tabs[number]["id"]>("topRevenue");
  const navigate = useNavigate();

  const handleRowClick = (tabId: string, item: TopListEntry) => {
    if (tabId === "topRevenue" || tabId === "topActive" || tabId === "topGrowing") {
      navigate(`/dashboard/tenants?search=${item.name}`);
    } else if (tabId === "topDoctors") {
      // Assuming doctors are under their respective tenants or a global doctor search
      navigate(`/dashboard/tenants`);
    } else if (tabId === "topSupport") {
      navigate(`/dashboard/support?search=${item.name}`);
    }
  };

  const currentList = data[activeTab];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[600px]">
      <div className="p-4 border-b border-slate-100 flex gap-2 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all",
              activeTab === tab.id 
                ? "bg-indigo-50 text-indigo-700 border-indigo-100 shadow-sm" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700 border-transparent"
            )}
            style={{ borderWidth: '1px' }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <th className="pb-4 px-4 w-16">Rank</th>
              <th className="pb-4 px-4">Name</th>
              <th className="pb-4 px-4 text-right">Metric</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {currentList.map((item, idx) => (
              <tr 
                key={item.id} 
                className="group hover:bg-slate-50 cursor-pointer transition-colors"
                onClick={() => handleRowClick(activeTab, item)}
              >
                <td className="py-3 px-4">
                  <span className={cn(
                    "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
                    idx === 0 ? "bg-amber-100 text-amber-700" :
                    idx === 1 ? "bg-slate-200 text-slate-700" :
                    idx === 2 ? "bg-orange-100 text-orange-700" :
                    "bg-slate-50 text-slate-500 group-hover:bg-white group-hover:shadow-sm"
                  )}>
                    {item.rank}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  {item.subtitle && <p className="text-xs text-slate-500">{item.subtitle}</p>}
                </td>
                <td className="py-3 px-4 text-right">
                  <p className="font-mono font-medium text-slate-700">
                    {activeTab === "topRevenue" 
                      ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(item.value)
                      : item.value.toLocaleString()
                    }
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {currentList.length === 0 && (
          <div className="py-12 text-center text-slate-500 text-sm">
            No data available for this period.
          </div>
        )}
      </div>
    </div>
  );
}
