import { Search, Zap, Database } from "lucide-react";
import type { SearchAnalytics } from "../analytics.types";

export function SearchAnalyticsCard({ data }: { data: SearchAnalytics }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-8">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
        <div className="flex items-center gap-2 text-slate-800">
          <Search className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold">Meilisearch Analytics</h2>
        </div>
        <div className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-100 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Connected
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
        <div className="p-6 flex flex-col justify-center items-center text-center">
          <Database className="w-8 h-8 text-slate-300 mb-3" />
          <p className="text-3xl font-bold text-slate-900">
            {data.indexStats.reduce((acc, curr) => acc + curr.documents, 0).toLocaleString()}
          </p>
          <p className="text-sm font-medium text-slate-500 mt-1">Total Documents Indexed</p>
        </div>

        <div className="p-6 flex flex-col justify-center items-center text-center">
          <Zap className="w-8 h-8 text-amber-300 mb-3" />
          <p className="text-3xl font-bold text-slate-900">{data.avgLatency}ms</p>
          <p className="text-sm font-medium text-slate-500 mt-1">Avg Search Latency</p>
        </div>

        <div className="p-6">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Index Breakdown</h3>
          <div className="space-y-4">
            {data.indexStats.map(idx => (
              <div key={idx.name}>
                <div className="flex justify-between items-end mb-1.5">
                  <span className="text-sm font-semibold text-slate-700 capitalize">{idx.name}</span>
                  <span className="text-sm text-slate-500">{idx.documents.toLocaleString()} docs</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full" style={{ width: '100%' }} />
                </div>
              </div>
            ))}
            {data.indexStats.length === 0 && (
              <p className="text-sm text-slate-500 italic">No indexes configured</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
