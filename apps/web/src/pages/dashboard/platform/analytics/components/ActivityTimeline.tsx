import { formatDistanceToNow } from "date-fns";
import { Building2, ArrowUpCircle, XCircle, LifeBuoy, CheckCircle2, UserPlus, DollarSign, AlertCircle, Activity } from "lucide-react";
import type { ActivityItem } from "../analytics.types";
import { useState } from "react";
import { analyticsApi } from "../analytics.api";

export function ActivityTimeline({ items: initialItems }: { items: ActivityItem[] }) {
  const [items, setItems] = useState<ActivityItem[]>(initialItems);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadMore = async () => {
    setLoading(true);
    try {
      const res = await analyticsApi.getActivity(page + 1);
      setItems(prev => [...prev, ...res.items]);
      setPage(p => p + 1);
      if (res.items.length === 0) setHasMore(false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getEventIcon = (type: string) => {
    switch(type) {
      case 'PHARMACY_CREATED': return <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><Building2 className="w-4 h-4" /></div>;
      case 'SUBSCRIPTION_UPGRADED': return <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center"><ArrowUpCircle className="w-4 h-4" /></div>;
      case 'SUBSCRIPTION_EXPIRED': return <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center"><XCircle className="w-4 h-4" /></div>;
      case 'TICKET_CREATED': return <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><LifeBuoy className="w-4 h-4" /></div>;
      case 'TICKET_RESOLVED': return <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><CheckCircle2 className="w-4 h-4" /></div>;
      case 'OWNER_INVITED': return <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center"><UserPlus className="w-4 h-4" /></div>;
      case 'PAYMENT_RECEIVED': return <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center"><DollarSign className="w-4 h-4" /></div>;
      case 'PAYMENT_FAILED': return <div className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center"><AlertCircle className="w-4 h-4" /></div>;
      default: return <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><Activity className="w-4 h-4" /></div>;
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-[600px]">
      <h2 className="text-lg font-bold text-slate-800 mb-6">Recent Activity</h2>
      
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar relative">
        <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-100 -z-10" />
        
        <div className="space-y-6">
          {items.map((item, idx) => (
            <div key={`${item.id}-${idx}`} className="flex gap-4">
              <div className="relative z-10 bg-white py-1">
                {getEventIcon(item.type)}
              </div>
              <div className="flex-1 py-1">
                <p className="text-sm font-medium text-slate-800">{item.message}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-500">
                    {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                  </span>
                  {item.entityName && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-slate-300" />
                      <span className="text-xs font-medium text-indigo-600">{item.entityName}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {hasMore && (
          <div className="mt-8 pt-4 border-t border-slate-100 text-center">
            <button 
              onClick={loadMore}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            >
              {loading ? "Loading..." : "Load More Activity"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
