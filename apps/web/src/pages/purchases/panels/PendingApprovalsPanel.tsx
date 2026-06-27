import { useState } from "react";
import { Loader2, ShieldCheck, Check, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/queryKeys";
import { CardSkeletonRows } from "@/components/Skeleton";
import { currency, fmtDate } from "../utils";
import { SlidePanel } from "./AutoSuggestPanel";

const PENDING_PARAMS = { approvalStatus: "PENDING_APPROVAL", limit: 50 };

export function PendingApprovalsPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [actionId, setActionId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const queryKey = queryKeys.purchases.orders(PENDING_PARAMS);
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get("/purchases/orders", { params: PENDING_PARAMS });
      return data.data as { items: any[]; total: number };
    },
    staleTime: 30_000,
  });
  const items   = data?.items ?? [];
  const loading = isPending;

  async function decide(id: string, approved: boolean) {
    setActionId(id);
    try {
      await api.patch(`/purchases/orders/${id}/approve`, { approved });
      queryClient.setQueryData<{ items: any[]; total: number }>(queryKey, (old) =>
        old ? { ...old, items: old.items.filter((i) => i.id !== id), total: old.total - 1 } : old);
      onDone();
    } catch {/* */} finally { setActionId(null); }
  }

  return (
    <SlidePanel title="Pending Approvals" subtitle="Purchase orders waiting for owner sign-off" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        {loading ? (
          <CardSkeletonRows rows={3} />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <ShieldCheck className="w-10 h-10 text-green-300 mb-3" />
            <p className="text-[14px] font-semibold text-slate-700">All caught up!</p>
            <p className="text-[12px] text-slate-400">No purchase orders are waiting for approval.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{items.length} PO{items.length !== 1 ? "s" : ""} waiting</p>
            {items.map((po) => (
              <div key={po.id} className="border border-orange-200 bg-orange-50/30 rounded-xl p-3.5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-[13px] font-bold text-blue-600">{po.orderNumber}</p>
                    <p className="text-[12px] font-semibold text-slate-700">{po.supplier.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{po._count.items} items · {fmtDate(po.orderedAt)}</p>
                  </div>
                  <p className="text-[15px] font-black text-slate-800">{currency(po.totalAmount)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => decide(po.id, true)} disabled={actionId === po.id}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-[12px] font-semibold py-1.5 rounded-lg disabled:opacity-60 transition-colors">
                    {actionId === po.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Approve
                  </button>
                  <button onClick={() => decide(po.id, false)} disabled={actionId === po.id}
                    className="flex-1 flex items-center justify-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 text-[12px] font-semibold py-1.5 rounded-lg disabled:opacity-60 transition-colors">
                    <X className="w-3 h-3" />Reject
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </SlidePanel>
  );
}
