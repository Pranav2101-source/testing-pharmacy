import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, AlertCircle, Clock, TrendingDown, Check, ShoppingCart } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { fmt } from "../utils";
import { WASTE_RISK_CFG, EXPIRY_TIER_CFG, STOCK_TIER_CFG } from "../types";
import type { ExpiryTier, ExpiryAlert, StockAlert, AlertCounts } from "../types";

const ALERTS_PAGE_SIZE = 25;

export function AlertsTab({ onCountsLoaded }: { onCountsLoaded: (c: AlertCounts) => void }) {
  const navigate = useNavigate();
  const [expiryFilter, setExpiryFilter] = useState<ExpiryTier | "">("");
  const [expiryPage,  setExpiryPage]  = useState(1);
  const [stockPage,   setStockPage]   = useState(1);

  type AlertsResponse = { expiry: ExpiryAlert[]; lowStock: StockAlert[] };
  const { data, isFetching: loading, error: queryError, refetch: loadAlerts } = useQuery({
    queryKey:        queryKeys.inventory.alerts(),
    queryFn:         () => api.get("/inventory/alerts").then((r) => r.data.data as AlertsResponse),
    staleTime:       30_000,
    placeholderData: keepPreviousData,
  });

  const expiryItems = data?.expiry   ?? [];
  const lowItems    = data?.lowStock ?? [];
  const loadError   = queryError ? "Failed to load alerts. Check your connection and try again." : null;

  useEffect(() => {
    if (data) onCountsLoaded({ expiry: data.expiry.length, lowStock: data.lowStock.length });
  }, [data, onCountsLoaded]);

  if (loading && !data) return <div className="flex items-center justify-center py-24"><Loader2 className="w-7 h-7 animate-spin text-blue-400" /></div>;

  if (loadError && !data) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <AlertCircle className="w-8 h-8 text-red-300" />
      <p className="text-[13px] text-red-500 font-medium">{loadError}</p>
      <button onClick={() => loadAlerts()} className="text-[12px] text-blue-600 hover:underline">Retry</button>
    </div>
  );

  const filteredExpiry = expiryFilter ? expiryItems.filter((i) => i.tier === expiryFilter) : expiryItems;

  const expiryCounts = {
    EXPIRED:  expiryItems.filter((i) => i.tier === "EXPIRED").length,
    CRITICAL: expiryItems.filter((i) => i.tier === "CRITICAL").length,
    WARNING:  expiryItems.filter((i) => i.tier === "WARNING").length,
    NOTICE:   expiryItems.filter((i) => i.tier === "NOTICE").length,
  };

  const expiryTotalPages = Math.max(1, Math.ceil(filteredExpiry.length / ALERTS_PAGE_SIZE));
  const pagedExpiry = filteredExpiry.slice((expiryPage - 1) * ALERTS_PAGE_SIZE, expiryPage * ALERTS_PAGE_SIZE);

  const stockTotalPages = Math.max(1, Math.ceil(lowItems.length / ALERTS_PAGE_SIZE));
  const pagedStock = lowItems.slice((stockPage - 1) * ALERTS_PAGE_SIZE, stockPage * ALERTS_PAGE_SIZE);

  const thCls = "px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide";

  return (
    <div className="flex-1 overflow-auto p-5 space-y-6">

      {/* Expiry section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><Clock className="w-3.5 h-3.5 text-amber-600" /></div>
            <h3 className="text-[14px] font-bold text-slate-800">Expiry Alerts</h3>
            <span className="text-[12px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">{expiryItems.length}</span>
          </div>
          {/* Tier filter pills */}
          <div className="flex items-center gap-1.5">
            {(["", "EXPIRED", "CRITICAL", "WARNING", "NOTICE"] as const).map((tier) => {
              const count = tier === "" ? expiryItems.length : expiryCounts[tier];
              return (
                <button key={tier} onClick={() => { setExpiryFilter(tier); setExpiryPage(1); }}
                  className={cn("text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition-all",
                    expiryFilter === tier ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                  )}>
                  {tier === "" ? `All (${count})` : `${EXPIRY_TIER_CFG[tier as ExpiryTier].label} (${count})`}
                </button>
              );
            })}
          </div>
        </div>

        {filteredExpiry.length === 0 ? (
          <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
            <Check className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-[13px] text-slate-500 font-medium">No items in this category</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full hidden md:table">
              <thead className="bg-slate-50"><tr className="border-b border-slate-200">
                {["Severity","Medicine","Batch","Expiry Date","Days Left","Stock","Waste Risk","Location"].map((h) => <th key={h} className={thCls}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pagedExpiry.map((item) => {
                  const cfg  = EXPIRY_TIER_CFG[item.tier];
                  const risk = item.wasteRisk;
                  const rCfg = WASTE_RISK_CFG[risk.riskTier];
                  return (
                    <tr key={item.id} className={cn("border-b border-slate-100 last:border-0 transition-colors hover:brightness-95", cfg.rowCls)}>
                      <td className="px-4 py-3">
                        <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", cfg.badgeCls)}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-slate-800">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400">{item.medicine.genericName}</p>}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-mono text-slate-600">{item.batchNumber}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold text-slate-600">{fmt(item.expiryDate)}</td>
                      <td className="px-4 py-3 text-[13px] font-bold tabular-nums text-slate-700">
                        {item.daysToExpiry <= 0 ? <span className="text-red-600">Expired</span> : `${item.daysToExpiry}d`}
                      </td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-slate-700 tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-3">
                        <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", rCfg.cls)}>{rCfg.label}</span>
                        {risk.riskTier !== "SAFE" && risk.riskTier !== "NO_DATA" && risk.atRiskUnits > 0 && (
                          <p className="text-[11px] text-slate-400 mt-1 whitespace-nowrap">
                            {risk.atRiskUnits} units · ₹{risk.potentialLoss.toLocaleString("en-IN")}
                          </p>
                        )}
                        {risk.riskTier === "SAFE" && (
                          <p className="text-[11px] text-emerald-600 mt-1">All will sell</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-400">{item.location ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Phone cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {pagedExpiry.map((item) => {
                const cfg  = EXPIRY_TIER_CFG[item.tier];
                const risk = item.wasteRisk;
                const rCfg = WASTE_RISK_CFG[risk.riskTier];
                return (
                  <div key={item.id} className={cn("p-4", cfg.rowCls)}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400 truncate">{item.medicine.genericName}</p>}
                      </div>
                      <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0", cfg.badgeCls)}>{cfg.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] mb-2">
                      <div><span className="text-slate-400">Batch</span><p className="font-mono text-slate-600">{item.batchNumber}</p></div>
                      <div>
                        <span className="text-slate-400">Expiry</span>
                        <p className="font-semibold text-slate-700 tabular-nums">
                          {fmt(item.expiryDate)} · {item.daysToExpiry <= 0 ? <span className="text-red-600">Expired</span> : `${item.daysToExpiry}d`}
                        </p>
                      </div>
                      <div><span className="text-slate-400">Stock</span><p className="font-semibold text-slate-700 tabular-nums">{item.quantity}</p></div>
                      <div><span className="text-slate-400">Location</span><p className="text-slate-500">{item.location ?? "—"}</p></div>
                    </div>
                    <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", rCfg.cls)}>{rCfg.label}</span>
                    {risk.riskTier !== "SAFE" && risk.riskTier !== "NO_DATA" && risk.atRiskUnits > 0 && (
                      <p className="text-[11px] text-slate-400 mt-1">{risk.atRiskUnits} units · ₹{risk.potentialLoss.toLocaleString("en-IN")}</p>
                    )}
                    {risk.riskTier === "SAFE" && <p className="text-[11px] text-emerald-600 mt-1">All will sell</p>}
                  </div>
                );
              })}
            </div>
            {filteredExpiry.length > ALERTS_PAGE_SIZE && (
              <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
                <span className="text-[12px] text-slate-500">
                  Showing <span className="font-semibold text-slate-700">{(expiryPage - 1) * ALERTS_PAGE_SIZE + 1}–{Math.min(expiryPage * ALERTS_PAGE_SIZE, filteredExpiry.length)}</span> of <span className="font-semibold text-slate-700">{filteredExpiry.length}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setExpiryPage((p) => Math.max(1, p - 1))} disabled={expiryPage === 1}
                    className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
                  <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{expiryPage} / {expiryTotalPages}</span>
                  <button onClick={() => setExpiryPage((p) => Math.min(expiryTotalPages, p + 1))} disabled={expiryPage === expiryTotalPages}
                    className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Low stock section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><TrendingDown className="w-3.5 h-3.5 text-red-500" /></div>
          <h3 className="text-[14px] font-bold text-slate-800">Stock Alerts</h3>
          <span className="text-[12px] font-semibold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5">{lowItems.length}</span>
        </div>
        {lowItems.length === 0 ? (
          <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100">
            <Check className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-[13px] text-slate-500 font-medium">All stock levels are healthy</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full hidden md:table">
              <thead className="bg-slate-50"><tr className="border-b border-slate-200">
                {["Status","Medicine","Batch","Stock","Reorder Level","Min Stock","MRP",""].map((h) => <th key={h} className={thCls}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pagedStock.map((item) => {
                  const cfg = STOCK_TIER_CFG[item.tier];
                  return (
                    <tr key={item.id} className="border-b border-slate-100 last:border-0 hover:bg-red-50/10 transition-colors">
                      <td className="px-4 py-3">
                        <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", cfg.badgeCls)}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-slate-800">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400">{item.medicine.genericName}</p>}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-mono text-slate-600">{item.batchNumber}</td>
                      <td className="px-4 py-3">
                        <p className="text-[14px] font-bold text-red-600 tabular-nums">{item.quantity}</p>
                        {item.reorder.hasData ? (
                          <p className="text-[11px] text-blue-600 font-semibold mt-0.5 whitespace-nowrap">
                            📦 Order {item.reorder.suggestedQty}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-400 mt-0.5">No sales data</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{item.reorderLevel}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500 tabular-nums">{item.minimumStock}</td>
                      <td className="px-4 py-3">
                        <p className="text-[12px] text-slate-600 tabular-nums">₹{item.mrp.toFixed(2)}</p>
                        {item.reorder.hasData && (
                          <p className="text-[10px] text-slate-400 mt-0.5">{item.reorder.avgDailySales}/day avg</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(
                            `/dashboard/purchase?create-po=1&medicineId=${encodeURIComponent(item.medicine.id)}&medicine=${encodeURIComponent(item.medicine.name)}&gstRate=${item.medicine.gstRate}`
                          )}
                          className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-2.5 py-1 transition-colors whitespace-nowrap"
                        >
                          <ShoppingCart className="w-3 h-3" />Create PO
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Phone cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {pagedStock.map((item) => {
                const cfg = STOCK_TIER_CFG[item.tier];
                return (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                        {item.medicine.genericName && <p className="text-[11px] text-slate-400 truncate">{item.medicine.genericName}</p>}
                      </div>
                      <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0", cfg.badgeCls)}>{cfg.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] mb-3">
                      <div><span className="text-slate-400">Batch</span><p className="font-mono text-slate-600">{item.batchNumber}</p></div>
                      <div>
                        <span className="text-slate-400">Stock</span>
                        <p className="font-bold text-red-600 tabular-nums">{item.quantity}</p>
                      </div>
                      <div><span className="text-slate-400">Reorder Lvl</span><p className="text-slate-500 tabular-nums">{item.reorderLevel}</p></div>
                      <div><span className="text-slate-400">Min Stock</span><p className="text-slate-500 tabular-nums">{item.minimumStock}</p></div>
                      <div><span className="text-slate-400">MRP</span><p className="text-slate-600 tabular-nums">₹{item.mrp.toFixed(2)}</p></div>
                      <div>
                        {item.reorder.hasData
                          ? <p className="text-blue-600 font-semibold">📦 Order {item.reorder.suggestedQty}</p>
                          : <p className="text-slate-400">No sales data</p>}
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(
                        `/dashboard/purchase?create-po=1&medicineId=${encodeURIComponent(item.medicine.id)}&medicine=${encodeURIComponent(item.medicine.name)}&gstRate=${item.medicine.gstRate}`
                      )}
                      className="flex items-center justify-center gap-1.5 w-full text-[12px] font-semibold text-blue-600 active:bg-blue-100 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 transition-colors"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />Create PO
                    </button>
                  </div>
                );
              })}
            </div>
            {lowItems.length > ALERTS_PAGE_SIZE && (
              <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
                <span className="text-[12px] text-slate-500">
                  Showing <span className="font-semibold text-slate-700">{(stockPage - 1) * ALERTS_PAGE_SIZE + 1}–{Math.min(stockPage * ALERTS_PAGE_SIZE, lowItems.length)}</span> of <span className="font-semibold text-slate-700">{lowItems.length}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setStockPage((p) => Math.max(1, p - 1))} disabled={stockPage === 1}
                    className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">‹ Prev</button>
                  <span className="text-[12px] text-slate-500 font-medium px-3 py-1 bg-white border border-slate-200 rounded-lg">{stockPage} / {stockTotalPages}</span>
                  <button onClick={() => setStockPage((p) => Math.min(stockTotalPages, p + 1))} disabled={stockPage === stockTotalPages}
                    className="px-3 py-1 rounded-lg border border-slate-200 text-[12px] font-medium hover:bg-white disabled:opacity-40">Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
