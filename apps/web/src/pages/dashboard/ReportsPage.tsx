import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getStoredUser } from "@/lib/auth";
import {
  BarChart3, Receipt, AlertTriangle, Calendar,
  IndianRupee, TrendingUp, ShoppingBag, Download,
  Loader2, ChevronLeft, ChevronRight, Package,
  Package2, Flame, TrendingDown, Archive,
  ShoppingCart, FileCheck, CheckCircle2,
  BadgePercent, BookOpen, ArrowUpDown, Banknote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────
type ReportTab       = "sales" | "inventory" | "purchases" | "compliance";
type ComplianceSubTab = "gst" | "hsn-summary" | "schedule-h";
type Period          = "today" | "week" | "month" | "custom";

interface DailySalesPoint {
  date: string; invoiceCount: number; revenue: number; gstCollected: number;
}
interface FastMovingItem {
  inventoryId: string;
  medicine: { id: string; name: string; genericName: string | null; form: string | null } | null;
  qtySold: number;
  revenue: number;
}
interface DeadStockItem {
  id: string; batchNumber: string; expiryDate: string; quantity: number;
  costAtRisk: number; retailValue: number; lastSaleDate: string | null;
  medicine: { id: string; name: string; genericName: string | null; form: string | null; category: string | null };
}
interface ValuationItem {
  key: string; medicineName: string; category: string | null;
  costValue: number; retailValue: number; totalQty: number;
}
interface CostAnalysisItem {
  medicineId: string; medicineName: string; totalQty: number;
  totalCost: number; totalMRPValue: number;
  avgPurchaseRate: number; avgMRP: number; marginPct: number; batches: number;
}
interface ScheduleHItem {
  id: string; quantity: number;
  invoice: {
    invoiceNumber: string; createdAt: string;
    prescriptionId: string | null; doctorName: string | null;
    customer: { name: string; phone: string } | null;
    user: { name: string };
  };
  inventory: {
    medicine: { name: string; genericName: string | null; schedule: string | null; strength: string | null; form: string | null };
  };
}
interface GstData {
  _sum: { subtotal: number | null; discountAmount: number | null; taxableAmount: number | null; cgst: number | null; sgst: number | null; totalGst: number | null; totalAmount: number | null };
  _count: number;
}
interface ExpiryItem {
  id: string; quantity: number; expiryDate: string; batchNumber: string; mrp: number;
  medicine: { name: string };
}

// ─── Helpers ──────────────────────────────────────────────────────
function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtK(n: number) {
  if (n >= 100000) return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000)   return "₹" + (n / 1000).toFixed(1) + "K";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function daysUntil(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}
function toInputDate(d: Date) { return d.toISOString().slice(0, 10); }
// IST-aware range helpers — server stores UTC, IST = UTC+5:30
function isoFrom(dateStr: string): string { return new Date(dateStr + "T00:00:00+05:30").toISOString(); }
function isoTo(dateStr: string): string   { return new Date(dateStr + "T23:59:59+05:30").toISOString(); }

function getLastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
    return toInputDate(d);
  });
}
function getPeriodDates(period: Period, cf = "", ct = ""): { from: string; to: string } {
  const today = toInputDate(new Date());
  if (period === "today") return { from: today, to: today };
  if (period === "week")  { const d = new Date(); d.setDate(d.getDate() - 6); return { from: toInputDate(d), to: today }; }
  if (period === "month") { const d = new Date(); d.setDate(1); return { from: toInputDate(d), to: today }; }
  return { from: cf || today, to: ct || today };
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv  = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Shared: Period Selector ──────────────────────────────────────
function PeriodSelector({ period, onChange, customFrom, customTo, onCustomChange }: {
  period: Period; onChange: (p: Period) => void;
  customFrom: string; customTo: string;
  onCustomChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["today","week","month","custom"] as Period[]).map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all",
            period === p ? "bg-blue-600 text-white shadow-sm" : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300"
          )}
        >
          {p === "today" ? "Today" : p === "week" ? "Last 7 Days" : p === "month" ? "This Month" : "Custom"}
        </button>
      ))}
      {period === "custom" && (
        <div className="flex items-center gap-2">
          <input type="date" value={customFrom} max={customTo || toInputDate(new Date())}
            onChange={e => onCustomChange(e.target.value, customTo)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400"
          />
          <span className="text-slate-400 text-[11px]">to</span>
          <input type="date" value={customTo} min={customFrom} max={toInputDate(new Date())}
            onChange={e => onCustomChange(customFrom, e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400"
          />
        </div>
      )}
    </div>
  );
}

// ─── Revenue Bar Chart (7-day, CSS-only) ─────────────────────────
function RevenueChart({ days, loading }: { days: DailySalesPoint[]; loading: boolean }) {
  const maxRev   = days.length > 0 ? Math.max(...days.map(d => d.revenue), 1) : 1;
  const todayStr = toInputDate(new Date());

  const bars = loading
    ? Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex flex-col justify-end" style={{ height: "88px" }}>
            <div className="w-full rounded-t skeleton" style={{ height: `${25 + i * 9}%` }} />
          </div>
          <span className="text-[9px] text-slate-200">&nbsp;</span>
        </div>
      ))
    : days.map(d => {
        const isToday = d.date === todayStr;
        const barH    = d.revenue > 0 ? Math.max((d.revenue / maxRev) * 96, 8) : 3;
        const label   = isToday ? "Today" : new Date(d.date + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short" });
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex flex-col justify-end" style={{ height: "88px" }}>
              <div
                title={`${fmtK(d.revenue)} · ${d.invoiceCount} bills`}
                className={cn(
                  "w-full rounded-t transition-all duration-700",
                  isToday ? "bg-blue-500" : d.revenue > 0 ? "bg-blue-200 hover:bg-blue-300" : "bg-slate-100"
                )}
                style={{ height: `${barH}%` }}
              />
            </div>
            <span className={cn("text-[9px] font-semibold", isToday ? "text-blue-600 font-bold" : "text-slate-400")}>
              {label}
            </span>
          </div>
        );
      });

  return <div className="flex items-end gap-1.5 h-28">{bars}</div>;
}

// ─── Section wrapper ─────────────────────────────────────────────
function Section({ title, icon: Icon, iconBg, iconColor, action, children }: {
  title: string; icon: React.ElementType; iconBg: string; iconColor: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", iconBg)}>
            <Icon className={cn("w-4 h-4", iconColor)} strokeWidth={1.8} />
          </div>
          <h3 className="text-[13px] font-black text-slate-800">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Margin badge ────────────────────────────────────────────────
function MarginBadge({ pct }: { pct: number }) {
  const cls = pct >= 25 ? "bg-emerald-50 text-emerald-700" : pct >= 12 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
  return (
    <span className={cn("inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums", cls)}>
      {pct.toFixed(1)}%
    </span>
  );
}

// ─── Tab: Sales ───────────────────────────────────────────────────
function SalesTab({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }: {
  period: Period; setPeriod: (p: Period) => void;
  customFrom: string; setCustomFrom: (v: string) => void;
  customTo: string; setCustomTo: (v: string) => void;
}) {
  const [chartDays,  setChartDays]  = useState<DailySalesPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [fastItems, setFastItems]   = useState<FastMovingItem[]>([]);
  const [fastLoading, setFastLoading] = useState(false);

  const { from, to } = getPeriodDates(period, customFrom, customTo);

  // 7-day chart — always last 7 days
  useEffect(() => {
    setChartLoading(true);
    const dates = getLastNDays(7);
    Promise.all(
      dates.map(d =>
        api.get<{ success: boolean; data: DailySalesPoint }>(`/reports/sales/daily?date=${d}`)
          .then(r => ({ ...r.data.data, date: d }))  // force YYYY-MM-DD so todayStr comparison works
          .catch((): DailySalesPoint => ({ date: d, invoiceCount: 0, revenue: 0, gstCollected: 0 }))
      )
    )
      .then(results => setChartDays(results))
      .finally(() => setChartLoading(false));
  }, []);

  // Fast-moving — depends on selected period
  const loadFast = useCallback(async (f: string, t: string) => {
    setFastLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: { items: FastMovingItem[] } }>(
        `/reports/analytics/fast-moving?from=${isoFrom(f)}&to=${isoTo(t)}&limit=20`
      );
      setFastItems(res.data.data.items ?? []);
    } catch { setFastItems([]); }
    finally { setFastLoading(false); }
  }, []);

  useEffect(() => { loadFast(from, to); }, [from, to, loadFast]);

  // Aggregate fast-moving by medicine (same med may appear in multiple batches)
  const topMedicines = useMemo(() => {
    const map = new Map<string, { name: string; genericName: string | null; qtySold: number; revenue: number }>();
    for (const item of fastItems) {
      const key = item.medicine?.id ?? item.inventoryId;
      const ex = map.get(key);
      if (ex) { ex.qtySold += item.qtySold; ex.revenue += item.revenue; }
      else map.set(key, { name: item.medicine?.name ?? "Unknown", genericName: item.medicine?.genericName ?? null, qtySold: item.qtySold, revenue: item.revenue });
    }
    return Array.from(map.values()).sort((a, b) => b.qtySold - a.qtySold).slice(0, 15);
  }, [fastItems]);

  // Period totals from chart (7-day)
  const chartTotals = useMemo(() => ({
    revenue: chartDays.reduce((s, d) => s + d.revenue, 0),
    bills:   chartDays.reduce((s, d) => s + d.invoiceCount, 0),
    gst:     chartDays.reduce((s, d) => s + d.gstCollected, 0),
  }), [chartDays]);

  function handleExport() {
    downloadCsv("top-medicines.csv", [
      ["Medicine", "Generic", "Qty Sold", "Revenue"],
      ...topMedicines.map(m => [m.name, m.genericName ?? "", String(m.qtySold), String(m.revenue)]),
    ]);
  }

  return (
    <div className="space-y-4">
      {/* 7-day overview */}
      <Section title="7-Day Revenue Trend" icon={BarChart3} iconBg="bg-blue-50" iconColor="text-blue-600">
        <div className="p-5 space-y-4">
          {/* Summary chips */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "7-Day Revenue", value: fmtK(chartTotals.revenue), icon: IndianRupee, color: "text-emerald-600", bg: "bg-emerald-50" },
              { label: "Bills",         value: String(chartTotals.bills), icon: ShoppingBag, color: "text-blue-600",    bg: "bg-blue-50"    },
              { label: "GST Collected", value: fmtK(chartTotals.gst),    icon: BadgePercent, color: "text-amber-600",  bg: "bg-amber-50"   },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className="flex items-center gap-3 bg-slate-50/60 rounded-xl px-3 py-2.5">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", bg)}>
                  <Icon className={cn("w-4 h-4", color)} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-[16px] font-black text-slate-800 tabular-nums leading-tight">{chartLoading ? "—" : value}</p>
                  <p className="text-[10px] text-slate-500 font-semibold">{label}</p>
                </div>
              </div>
            ))}
          </div>
          <RevenueChart days={chartDays} loading={chartLoading} />
        </div>
      </Section>

      {/* Top medicines */}
      <Section
        title="Top Selling Medicines"
        icon={Flame}
        iconBg="bg-orange-50"
        iconColor="text-orange-500"
        action={topMedicines.length > 0 ? (
          <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
            <Download className="w-3 h-3" /> CSV
          </button>
        ) : undefined}
      >
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/40">
          <PeriodSelector
            period={period} onChange={setPeriod}
            customFrom={customFrom} customTo={customTo}
            onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
          />
        </div>
        {fastLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-300" /></div>
        ) : topMedicines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Flame className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
            <p className="text-[13px] font-medium">No sales in this period</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-5 py-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              <span>Medicine</span>
              <span className="text-right">Qty Sold</span>
              <span className="text-right">Revenue</span>
              <span className="text-right">Rank</span>
            </div>
            <div className="divide-y divide-slate-50">
              {topMedicines.map((m, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center px-5 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{m.name}</p>
                    {m.genericName && <p className="text-[10px] text-slate-400 truncate">{m.genericName}</p>}
                  </div>
                  <p className="text-[13px] font-bold text-slate-700 tabular-nums text-right">{m.qtySold}</p>
                  <p className="text-[13px] font-bold text-slate-700 tabular-nums text-right">{fmtK(m.revenue)}</p>
                  <div className="flex justify-end">
                    <span className={cn("w-6 h-6 rounded-full text-[10px] font-black flex items-center justify-center",
                      i === 0 ? "bg-amber-100 text-amber-700" : i <= 2 ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"
                    )}>#{i + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Tab: Inventory ───────────────────────────────────────────────
function InventoryTab() {
  const [expiryItems, setExpiryItems]   = useState<ExpiryItem[]>([]);
  const [expiryLoading, setExpiryLoad]  = useState(true);
  const [deadItems, setDeadItems]       = useState<DeadStockItem[]>([]);
  const [deadLoading, setDeadLoad]      = useState(true);
  const [valItems, setValItems]         = useState<ValuationItem[]>([]);
  const [valLoading, setValLoad]        = useState(true);
  const [deadDays, setDeadDays]         = useState(90);

  useEffect(() => {
    api.get<{ success: boolean; data: ExpiryItem[] }>("/reports/expiry")
      .then(r => setExpiryItems(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setExpiryLoad(false));

    api.get<{ success: boolean; data: { items: ValuationItem[]; totalCostValue: number; totalRetailValue: number } }>("/reports/inventory/valuation?groupBy=category")
      .then(r => setValItems(r.data.data.items ?? []))
      .catch(() => {})
      .finally(() => setValLoad(false));
  }, []);

  const loadDead = useCallback(async (days: number) => {
    setDeadLoad(true);
    try {
      const r = await api.get<{ success: boolean; data: { items: DeadStockItem[]; totalCostAtRisk: number } }>(`/reports/analytics/dead-stock?days=${days}`);
      setDeadItems(r.data.data.items ?? []);
    } catch { setDeadItems([]); }
    finally { setDeadLoad(false); }
  }, []);

  useEffect(() => { loadDead(deadDays); }, [deadDays, loadDead]);

  const expired  = expiryItems.filter(i => daysUntil(i.expiryDate) <= 0);
  const critical = expiryItems.filter(i => daysUntil(i.expiryDate) > 0 && daysUntil(i.expiryDate) <= 30);
  const warning  = expiryItems.filter(i => daysUntil(i.expiryDate) > 30);

  const totalCost   = valItems.reduce((s, v) => s + v.costValue, 0);
  const totalRetail = valItems.reduce((s, v) => s + v.retailValue, 0);
  const totalProfit = totalRetail - totalCost;
  const totalMargin = totalRetail > 0 ? (totalProfit / totalRetail) * 100 : 0;
  const totalDeadCost = deadItems.reduce((s, d) => s + d.costAtRisk, 0);

  function expiryExport() {
    downloadCsv("expiry-report.csv", [
      ["Medicine","Batch","Expiry Date","Days Left","Qty","MRP"],
      ...expiryItems.map(i => [i.medicine.name, i.batchNumber, i.expiryDate.slice(0,10), String(daysUntil(i.expiryDate)), String(i.quantity), String(i.mrp)]),
    ]);
  }
  function deadExport() {
    downloadCsv("dead-stock.csv", [
      ["Medicine","Batch","Last Sale","Qty","Cost at Risk","Retail Value"],
      ...deadItems.map(i => [i.medicine.name, i.batchNumber, i.lastSaleDate ? i.lastSaleDate.slice(0,10) : "Never", String(i.quantity), String(i.costAtRisk), String(i.retailValue)]),
    ]);
  }

  return (
    <div className="space-y-4">

      {/* Expiry Alerts */}
      <Section
        title="Expiry Alerts"
        icon={AlertTriangle}
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
        action={expiryItems.length > 0 ? (
          <button onClick={expiryExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
            <Download className="w-3 h-3" /> CSV
          </button>
        ) : undefined}
      >
        {expiryLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-300" /></div>
        ) : expiryItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-200 mb-2" strokeWidth={1.4} />
            <p className="text-[13px] font-medium">No items expiring within 90 days</p>
          </div>
        ) : (
          <div>
            {/* Summary chips */}
            <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/40">
              {[
                { label: "Expired",    count: expired.length,  cls: "bg-red-100 text-red-700 border-red-200"         },
                { label: "≤30 days",  count: critical.length, cls: "bg-orange-100 text-orange-700 border-orange-200" },
                { label: "31–90 days",count: warning.length,  cls: "bg-amber-100 text-amber-700 border-amber-200"   },
              ].map(({ label, count, cls }) => (
                <span key={label} className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border", cls)}>
                  <AlertTriangle className="w-3 h-3" />
                  {count} {label}
                </span>
              ))}
            </div>
            {/* Table */}
            <div className="grid grid-cols-[2fr_1fr_1fr_80px_60px_70px] gap-3 px-5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
              <span>Medicine</span><span>Batch</span><span>Expiry</span><span className="text-right">Days Left</span><span className="text-right">Qty</span><span className="text-right">MRP</span>
            </div>
            <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
              {expiryItems.map(item => {
                const days = daysUntil(item.expiryDate);
                return (
                  <div key={item.id} className={cn("grid grid-cols-[2fr_1fr_1fr_80px_60px_70px] gap-3 items-center px-5 py-3",
                    days <= 0 ? "bg-red-50/60" : days <= 30 ? "bg-orange-50/40" : "")}>
                    <div className="flex items-center gap-2 min-w-0">
                      {days <= 30 && <AlertTriangle className={cn("w-3 h-3 flex-shrink-0", days <= 0 ? "text-red-500" : "text-orange-500")} />}
                      <p className="text-[12px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono">{item.batchNumber}</p>
                    <p className="text-[11px] text-slate-600">{item.expiryDate.slice(0,10)}</p>
                    <p className={cn("text-[12px] text-right", days <= 0 ? "text-red-600 font-black" : days <= 30 ? "text-orange-600 font-bold" : "text-amber-600 font-semibold")}>
                      {days <= 0 ? "Expired" : `${days}d`}
                    </p>
                    <p className="text-[12px] text-slate-700 text-right">{item.quantity}</p>
                    <p className="text-[12px] text-slate-700 text-right">₹{item.mrp}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* Dead Stock */}
      <Section
        title="Dead Stock"
        icon={Archive}
        iconBg="bg-slate-100"
        iconColor="text-slate-500"
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span>No movement in</span>
              <select
                value={deadDays}
                onChange={e => setDeadDays(Number(e.target.value))}
                className="border border-slate-200 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-400/30"
              >
                {[30,60,90,180].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
            {deadItems.length > 0 && (
              <button onClick={deadExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
                <Download className="w-3 h-3" /> CSV
              </button>
            )}
          </div>
        }
      >
        {deadLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-300" /></div>
        ) : deadItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-200 mb-2" strokeWidth={1.4} />
            <p className="text-[13px] font-medium">No dead stock found</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-100 bg-slate-50/40">
              <span className="text-[11px] text-slate-500">{deadItems.length} batches not selling</span>
              <span className="text-[11px] font-bold text-red-600">₹{fmt(totalDeadCost)} cost at risk</span>
            </div>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
              <span>Medicine</span><span>Batch</span><span>Last Sale</span><span className="text-right">Qty</span><span className="text-right">Cost at Risk</span>
            </div>
            <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
              {deadItems.map(item => (
                <div key={item.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 items-center px-5 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                    {item.medicine.genericName && <p className="text-[10px] text-slate-400">{item.medicine.genericName}</p>}
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono">{item.batchNumber}</p>
                  <p className="text-[11px] text-slate-600">{item.lastSaleDate ? item.lastSaleDate.slice(0,10) : "Never sold"}</p>
                  <p className="text-[12px] text-slate-700 text-right">{item.quantity}</p>
                  <p className="text-[12px] font-semibold text-red-600 text-right">₹{fmt(item.costAtRisk)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Stock Valuation */}
      <Section title="Stock Valuation" icon={Banknote} iconBg="bg-emerald-50" iconColor="text-emerald-600">
        {valLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-300" /></div>
        ) : (
          <div>
            {/* Summary bar */}
            <div className="px-5 py-4 border-b border-slate-100 space-y-3 bg-slate-50/40">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Stock at Cost",    value: fmtK(totalCost),   cls: "text-slate-700" },
                  { label: "Retail Value",     value: fmtK(totalRetail), cls: "text-blue-700"  },
                  { label: "Potential Profit", value: fmtK(totalProfit), cls: "text-emerald-700" },
                ].map(({ label, value, cls }) => (
                  <div key={label}>
                    <p className={cn("text-[18px] font-black tabular-nums leading-tight", cls)}>{value}</p>
                    <p className="text-[10px] text-slate-500 font-semibold mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
              {/* Margin progress bar */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                  <span>Overall Margin</span>
                  <span className="font-bold text-emerald-600">{totalMargin.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${Math.min(totalMargin, 100)}%` }} />
                </div>
              </div>
            </div>
            {/* Category breakdown */}
            {valItems.length > 0 && (
              <>
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                  <span>Category / Medicine</span><span className="text-right">Qty</span><span className="text-right">Cost Value</span><span className="text-right">Retail Value</span>
                </div>
                <div className="divide-y divide-slate-50 max-h-56 overflow-y-auto">
                  {valItems.slice(0, 20).map((v, i) => (
                    <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 items-center px-5 py-2.5 hover:bg-slate-50/50 transition-colors">
                      <p className="text-[12px] font-semibold text-slate-700 truncate">{v.key}</p>
                      <p className="text-[12px] text-slate-600 text-right tabular-nums">{v.totalQty.toLocaleString("en-IN")}</p>
                      <p className="text-[12px] text-slate-700 text-right tabular-nums">{fmtK(v.costValue)}</p>
                      <p className="text-[12px] font-semibold text-blue-700 text-right tabular-nums">{fmtK(v.retailValue)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Tab: Purchases ───────────────────────────────────────────────
function PurchasesTab({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }: {
  period: Period; setPeriod: (p: Period) => void;
  customFrom: string; setCustomFrom: (v: string) => void;
  customTo: string; setCustomTo: (v: string) => void;
}) {
  const [items, setItems]           = useState<CostAnalysisItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [sortKey, setSortKey]       = useState<"cost" | "margin" | "qty">("cost");

  const { from, to } = getPeriodDates(period, customFrom, customTo);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    try {
      const r = await api.get<{ success: boolean; data: { items: CostAnalysisItem[]; summary: { totalCost: number; totalMRPValue: number; overallMarginPct: number } } }>(
        `/reports/purchases/cost-analysis?from=${isoFrom(f)}&to=${isoTo(t)}&limit=50`
      );
      setItems(r.data.data.items ?? []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(from, to); }, [from, to, load]);

  const sorted = useMemo(() => [...items].sort((a, b) =>
    sortKey === "cost"   ? b.totalCost - a.totalCost :
    sortKey === "margin" ? b.marginPct - a.marginPct :
                           b.totalQty  - a.totalQty
  ), [items, sortKey]);

  const totalCost   = items.reduce((s, i) => s + i.totalCost, 0);
  const totalMRPVal = items.reduce((s, i) => s + i.totalMRPValue, 0);
  const avgMargin   = totalMRPVal > 0 ? ((totalMRPVal - totalCost) / totalMRPVal) * 100 : 0;

  function handleExport() {
    downloadCsv("purchase-cost-analysis.csv", [
      ["Medicine","Total Qty","Total Cost","MRP Value","Avg Purchase Rate","Avg MRP","Margin %"],
      ...sorted.map(i => [i.medicineName, String(i.totalQty), String(i.totalCost), String(i.totalMRPValue), String(i.avgPurchaseRate), String(i.avgMRP), String(i.marginPct)]),
    ]);
  }

  return (
    <div className="space-y-4">
      <Section
        title="Purchase Cost Analysis"
        icon={ShoppingCart}
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
        action={items.length > 0 ? (
          <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
            <Download className="w-3 h-3" /> CSV
          </button>
        ) : undefined}
      >
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/40">
          <PeriodSelector period={period} onChange={setPeriod} customFrom={customFrom} customTo={customTo} onCustomChange={(f,t) => { setCustomFrom(f); setCustomTo(t); }} />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-300" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <ShoppingCart className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
            <p className="text-[13px] font-medium">No purchase data for this period</p>
          </div>
        ) : (
          <div>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 px-5 py-4 border-b border-slate-100 bg-slate-50/40">
              {[
                { label: "Total Purchased",   value: fmtK(totalCost),    sub: `${items.length} medicines`,         cls: "text-slate-800" },
                { label: "MRP Value of Stock", value: fmtK(totalMRPVal), sub: "at retail price",                   cls: "text-blue-700"  },
                { label: "Average Margin",     value: `${avgMargin.toFixed(1)}%`, sub: avgMargin >= 20 ? "Healthy margin" : "Low margin", cls: avgMargin >= 20 ? "text-emerald-700" : "text-amber-700" },
              ].map(({ label, value, sub, cls }) => (
                <div key={label}>
                  <p className={cn("text-[18px] font-black tabular-nums leading-tight", cls)}>{value}</p>
                  <p className="text-[10px] text-slate-500 font-semibold mt-0.5">{label}</p>
                  <p className="text-[10px] text-slate-400">{sub}</p>
                </div>
              ))}
            </div>
            {/* Sort controls */}
            <div className="grid grid-cols-[2.5fr_0.8fr_1fr_1fr_1fr_1.2fr] gap-3 px-5 py-2 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              <span>Medicine</span>
              <button onClick={() => setSortKey("qty")} className={cn("flex items-center gap-0.5 hover:text-slate-600 justify-end", sortKey==="qty" && "text-blue-600")}><ArrowUpDown className="w-2.5 h-2.5"/>Qty</button>
              <span className="text-right">Avg Buy</span>
              <span className="text-right">Avg MRP</span>
              <button onClick={() => setSortKey("cost")} className={cn("flex items-center gap-0.5 hover:text-slate-600 justify-end", sortKey==="cost" && "text-blue-600")}><ArrowUpDown className="w-2.5 h-2.5"/>Cost</button>
              <button onClick={() => setSortKey("margin")} className={cn("flex items-center gap-0.5 hover:text-slate-600 justify-end", sortKey==="margin" && "text-blue-600")}><ArrowUpDown className="w-2.5 h-2.5"/>Margin</button>
            </div>
            <div className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto">
              {sorted.map((item, i) => (
                <div key={i} className="grid grid-cols-[2.5fr_0.8fr_1fr_1fr_1fr_1.2fr] gap-3 items-center px-5 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-slate-800 truncate">{item.medicineName}</p>
                    <p className="text-[10px] text-slate-400">{item.batches} batch{item.batches !== 1 ? "es" : ""}</p>
                  </div>
                  <p className="text-[12px] text-slate-700 text-right tabular-nums">{item.totalQty}</p>
                  <p className="text-[12px] text-slate-600 text-right tabular-nums">₹{item.avgPurchaseRate.toFixed(2)}</p>
                  <p className="text-[12px] text-slate-600 text-right tabular-nums">₹{item.avgMRP.toFixed(2)}</p>
                  <p className="text-[12px] font-semibold text-slate-700 text-right tabular-nums">{fmtK(item.totalCost)}</p>
                  <div className="flex justify-end">
                    <MarginBadge pct={item.marginPct} />
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/30 text-[10px] text-slate-400">
              Margin = (MRP − Purchase Rate) ÷ MRP × 100. Green ≥25%, Amber 12–25%, Red &lt;12%
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Tab: Compliance ──────────────────────────────────────────────
function ComplianceTab() {
  const [subTab, setSubTab] = useState<ComplianceSubTab>("gst");

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { id: "gst" as const,         label: "GST Summary",          icon: Receipt },
          { id: "hsn-summary" as const, label: "GSTR-1 HSN Summary",   icon: BadgePercent },
          { id: "schedule-h" as const,  label: "Schedule H Register",  icon: BookOpen },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
              subTab === id ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </div>

      {subTab === "gst"         && <GstReportSection />}
      {subTab === "hsn-summary" && <HsnSummarySection />}
      {subTab === "schedule-h"  && <ScheduleHSection />}
    </div>
  );
}

// ─── Compliance: GST ─────────────────────────────────────────────
function GstReportSection() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [from, setFrom]   = useState(toInputDate(firstOfMonth));
  const [to,   setTo]     = useState(toInputDate(now));
  const [data, setData]   = useState<GstData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ success: boolean; data: GstData }>(`/reports/gst?from=${isoFrom(from)}&to=${isoTo(to)}`);
      setData(r.data.data);
    } catch { setData(null); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExport() {
    if (!data) return;
    downloadCsv(`gst-${from}-to-${to}.csv`, [
      ["Period", `${fmtDate(from)} to ${fmtDate(to)}`],
      ["Invoices", String(data._count)],
      ["Gross Sales", String(data._sum.subtotal ?? 0)],
      ["Discount",    String(data._sum.discountAmount ?? 0)],
      ["Taxable",     String(data._sum.taxableAmount ?? 0)],
      ["CGST",        String(data._sum.cgst ?? 0)],
      ["SGST",        String(data._sum.sgst ?? 0)],
      ["Total GST",   String(data._sum.totalGst ?? 0)],
      ["Net Amount",  String(data._sum.totalAmount ?? 0)],
    ]);
  }

  return (
    <Section
      title="GST Summary"
      icon={Receipt}
      iconBg="bg-indigo-50"
      iconColor="text-indigo-600"
      action={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
            <span className="text-slate-400 text-[11px]">to</span>
            <input type="date" value={to} min={from} max={toInputDate(new Date())} onChange={e => setTo(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[12px] font-bold transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
            Generate
          </button>
          {data && (
            <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
              <Download className="w-3 h-3" /> CSV
            </button>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-300" /></div>
      ) : !data ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <Receipt className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
          <p className="text-[13px] font-medium">Select a date range and click Generate</p>
        </div>
      ) : (
        <div>
          <div className="px-5 py-2.5 bg-slate-50/40 border-b border-slate-100">
            <p className="text-[11px] text-slate-500">{data._count} invoices · {fmtDate(from)} to {fmtDate(to)}</p>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { label: "Gross Sales (before discount)", value: data._sum.subtotal,        style: "normal"    },
              { label: "Discount Given",                 value: data._sum.discountAmount,  style: "negative"  },
              { label: "Taxable Amount",                 value: data._sum.taxableAmount,   style: "bold"      },
              { label: "CGST",                           value: data._sum.cgst,            style: "normal"    },
              { label: "SGST",                           value: data._sum.sgst,            style: "normal"    },
              { label: "Total GST Collected",            value: data._sum.totalGst,        style: "bold"      },
              { label: "Net Invoice Value",              value: data._sum.totalAmount,     style: "highlight" },
            ].map(({ label, value, style }) => (
              <div key={label} className={cn("flex items-center justify-between px-5 py-3", style === "highlight" && "bg-blue-50/50")}>
                <span className={cn("text-[13px] text-slate-600",
                  style === "bold"      && "font-bold text-slate-800",
                  style === "highlight" && "font-black text-blue-700"
                )}>{label}</span>
                <span className={cn("text-[13px] font-semibold text-slate-800",
                  style === "negative"  && "text-red-600",
                  style === "highlight" && "font-black text-blue-700 text-[15px]"
                )}>
                  {style === "negative" ? "−" : ""}₹{fmt(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Compliance: GSTR-1 HSN Summary ──────────────────────────────
interface HsnRow {
  hsnCode: string; gstRate: number; totalQty: number;
  taxableAmount: number; cgst: number; sgst: number; igst: number;
  totalGst: number; totalAmount: number;
}
function HsnSummarySection() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [from, setFrom]     = useState(toInputDate(firstOfMonth));
  const [to,   setTo]       = useState(toInputDate(now));
  const [rows, setRows]     = useState<HsnRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ success: boolean; data: { rows: HsnRow[] } }>(
        `/reports/gst/hsn-summary?from=${isoFrom(from)}&to=${isoTo(to)}`
      );
      setRows(r.data.data.rows);
    } catch { setRows(null); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExport() {
    if (!rows || rows.length === 0) return;
    downloadCsv(`hsn-summary-${from}-to-${to}.csv`, [
      ["HSN Code", "GST Rate %", "Total Qty", "Taxable Amount", "CGST", "SGST", "IGST", "Total GST", "Total Amount"],
      ...rows.map(r => [
        r.hsnCode, String(r.gstRate), String(r.totalQty),
        r.taxableAmount.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2),
        r.igst.toFixed(2), r.totalGst.toFixed(2), r.totalAmount.toFixed(2),
      ]),
    ]);
  }

  return (
    <Section
      title="GSTR-1 HSN Summary"
      icon={BadgePercent}
      iconBg="bg-violet-50"
      iconColor="text-violet-600"
      action={
        <div className="flex items-center gap-2">
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <span className="text-slate-400 text-[11px]">to</span>
          <input type="date" value={to} min={from} max={toInputDate(new Date())} onChange={e => setTo(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[12px] font-bold transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
            Generate
          </button>
          {rows && rows.length > 0 && (
            <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
              <Download className="w-3 h-3" /> Export CSV
            </button>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-300" /></div>
      ) : !rows ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <BadgePercent className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
          <p className="text-[13px]">Select a period and click Generate</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <p className="text-[13px]">No sales in this period</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold">
                {["HSN Code", "GST %", "Qty", "Taxable Amt", "CGST", "SGST", "IGST", "Total GST", "Total Amt"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right first:text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-50 hover:bg-slate-50/60 transition-colors">
                  <td className="px-3 py-2 font-mono font-semibold text-slate-700">{r.hsnCode}</td>
                  <td className="px-3 py-2 text-right">{r.gstRate}%</td>
                  <td className="px-3 py-2 text-right">{r.totalQty}</td>
                  <td className="px-3 py-2 text-right">₹{fmt(r.taxableAmount)}</td>
                  <td className="px-3 py-2 text-right">₹{fmt(r.cgst)}</td>
                  <td className="px-3 py-2 text-right">₹{fmt(r.sgst)}</td>
                  <td className="px-3 py-2 text-right">₹{fmt(r.igst)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-indigo-700">₹{fmt(r.totalGst)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">₹{fmt(r.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold text-slate-700 border-t-2 border-slate-200">
                <td className="px-3 py-2" colSpan={2}>Totals</td>
                <td className="px-3 py-2 text-right">{rows.reduce((s, r) => s + r.totalQty, 0)}</td>
                <td className="px-3 py-2 text-right">₹{fmt(rows.reduce((s, r) => s + r.taxableAmount, 0))}</td>
                <td className="px-3 py-2 text-right">₹{fmt(rows.reduce((s, r) => s + r.cgst, 0))}</td>
                <td className="px-3 py-2 text-right">₹{fmt(rows.reduce((s, r) => s + r.sgst, 0))}</td>
                <td className="px-3 py-2 text-right">₹{fmt(rows.reduce((s, r) => s + r.igst, 0))}</td>
                <td className="px-3 py-2 text-right text-indigo-700">₹{fmt(rows.reduce((s, r) => s + r.totalGst, 0))}</td>
                <td className="px-3 py-2 text-right text-slate-800">₹{fmt(rows.reduce((s, r) => s + r.totalAmount, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── Compliance: Schedule H ───────────────────────────────────────
function ScheduleHSection() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [from, setFrom]   = useState(toInputDate(monthStart));
  const [to,   setTo]     = useState(toInputDate(now));
  const [schedule, setSchedule] = useState("");
  const [items, setItems] = useState<ScheduleHItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = `/reports/schedule-h?from=${isoFrom(from)}&to=${isoTo(to)}${schedule ? `&schedule=${schedule}` : ""}`;
      const r = await api.get<{ success: boolean; data: ScheduleHItem[] }>(params);
      setItems(r.data.data ?? []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExport() {
    downloadCsv(`schedule-h-${from}-to-${to}.csv`, [
      ["Date","Invoice No","Patient","Phone","Doctor","Prescription No","Medicine","Schedule","Strength","Qty","Dispensed By"],
      ...items.map(i => [
        i.invoice.createdAt.slice(0,10),
        i.invoice.invoiceNumber,
        i.invoice.customer?.name ?? "Walk-in",
        i.invoice.customer?.phone ?? "",
        i.invoice.doctorName ?? "",
        i.invoice.prescriptionId ?? "",
        i.inventory.medicine.name,
        i.inventory.medicine.schedule ?? "",
        i.inventory.medicine.strength ?? "",
        String(i.quantity),
        i.invoice.user.name,
      ]),
    ]);
  }

  return (
    <Section
      title="Schedule H / H1 Dispensing Register"
      icon={BookOpen}
      iconBg="bg-violet-50"
      iconColor="text-violet-600"
      action={
        <div className="flex items-center gap-2">
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <span className="text-slate-400 text-[11px]">to</span>
          <input type="date" value={to} min={from} max={toInputDate(new Date())} onChange={e => setTo(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <select value={schedule} onChange={e => setSchedule(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30">
            <option value="">All Schedules</option>
            {["H","H1","X","G"].map(s => <option key={s} value={s}>Schedule {s}</option>)}
          </select>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[12px] font-bold transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
            Load
          </button>
          {items.length > 0 && (
            <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
              <Download className="w-3 h-3" /> CSV
            </button>
          )}
        </div>
      }
    >
      <div className="px-5 py-2.5 bg-violet-50/40 border-b border-slate-100">
        <p className="text-[11px] text-violet-700">
          Required for drug license compliance. Keep this register updated and available for Drug Inspector inspection.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-300" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <BookOpen className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
          <p className="text-[13px] font-medium">No controlled medicine dispensing records</p>
          <p className="text-[11px] text-slate-400 mt-1">Click Load to fetch the register for the selected period</p>
        </div>
      ) : (
        <div>
          <div className="px-5 py-2 border-b border-slate-100 bg-slate-50/40 text-[11px] text-slate-500">
            {items.length} dispensing records
          </div>
          <div className="grid grid-cols-[1fr_1fr_1.5fr_1.5fr_0.8fr_1fr] gap-2 px-5 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
            <span>Date / Bill</span><span>Patient</span><span>Medicine</span><span>Doctor / Rx</span><span className="text-right">Qty</span><span>By</span>
          </div>
          <div className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto">
            {items.map(item => (
              <div key={item.id} className="grid grid-cols-[1fr_1fr_1.5fr_1.5fr_0.8fr_1fr] gap-2 items-start px-5 py-3 hover:bg-slate-50/50 transition-colors">
                <div>
                  <p className="text-[11px] font-mono text-slate-500">{item.invoice.invoiceNumber}</p>
                  <p className="text-[10px] text-slate-400">{item.invoice.createdAt.slice(0,10)}</p>
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-slate-800 truncate">{item.invoice.customer?.name ?? "Walk-in"}</p>
                  {item.invoice.customer?.phone && <p className="text-[10px] text-slate-400">{item.invoice.customer.phone}</p>}
                </div>
                <div>
                  <p className="text-[12px] font-semibold text-slate-800 truncate">{item.inventory.medicine.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {item.inventory.medicine.schedule && (
                      <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                        Sch {item.inventory.medicine.schedule}
                      </span>
                    )}
                    {item.inventory.medicine.strength && (
                      <span className="text-[10px] text-slate-400">{item.inventory.medicine.strength}</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[12px] text-slate-600 truncate">{item.invoice.doctorName ?? "—"}</p>
                  {item.invoice.prescriptionId && <p className="text-[10px] text-slate-400">Rx: {item.invoice.prescriptionId}</p>}
                </div>
                <p className="text-[12px] font-bold text-slate-700 text-right tabular-nums">{item.quantity}</p>
                <p className="text-[11px] text-slate-500 truncate">{item.invoice.user.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Main Tabs config ─────────────────────────────────────────────
const MAIN_TABS: { id: ReportTab; label: string; icon: React.ElementType; sub: string }[] = [
  { id: "sales",      label: "Sales",      icon: TrendingUp,  sub: "Revenue & top medicines"  },
  { id: "inventory",  label: "Inventory",  icon: Package2,    sub: "Expiry, dead stock, value" },
  { id: "purchases",  label: "Purchases",  icon: ShoppingCart,sub: "Cost & margin analysis"    },
  { id: "compliance", label: "Compliance", icon: FileCheck,   sub: "GST & Schedule H"          },
];

// ─── Page ─────────────────────────────────────────────────────────
export default function ReportsPage() {
  const role = useRef(getStoredUser()?.role ?? "CASHIER").current;
  const isManagerUp = role === "OWNER" || role === "MANAGER";
  const visibleTabs = isManagerUp ? MAIN_TABS : MAIN_TABS.filter(t => t.id !== "purchases");

  const [tab, setTab] = useState<ReportTab>("sales");
  const active = (visibleTabs.find(t => t.id === tab) ?? visibleTabs[0])!;

  // Shared period state — persists across tab switches
  const now = new Date();
  const [period,     setPeriod]     = useState<Period>("week");
  const [customFrom, setCustomFrom] = useState(toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [customTo,   setCustomTo]   = useState(toInputDate(now));

  return (
    <div className="h-full overflow-y-auto bg-slate-50/50">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-[18px] font-black text-slate-800">Reports</h1>
          <p className="text-[12px] text-slate-400 mt-0.5 font-medium">{active.sub}</p>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-2xl p-1 w-fit shadow-sm">
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all",
                tab === id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              )}
            >
              <Icon className="w-4 h-4" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {tab === "sales"      && (
            <SalesTab
              period={period} setPeriod={setPeriod}
              customFrom={customFrom} setCustomFrom={setCustomFrom}
              customTo={customTo} setCustomTo={setCustomTo}
            />
          )}
          {tab === "inventory"  && <InventoryTab />}
          {tab === "purchases"  && (
            <PurchasesTab
              period={period} setPeriod={setPeriod}
              customFrom={customFrom} setCustomFrom={setCustomFrom}
              customTo={customTo} setCustomTo={setCustomTo}
            />
          )}
          {tab === "compliance" && <ComplianceTab />}
        </div>

      </div>
    </div>
  );
}
