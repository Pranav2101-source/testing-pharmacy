/**
 * Reports Home — the one screen an owner opens to answer "how is the shop doing, and
 * what should I do about it today".
 *
 * <p>Two halves. The top is the scoreboard: revenue, profit, tax due, stock value, each
 * against the period before. The bottom is the worklist — "money on the table": regulars
 * who have drifted, capital frozen in dead stock, medicines being sold below cost, credit
 * that has not been collected, stock about to expire. Every card is a number AND a link to
 * the tab that acts on it, because a dashboard that only tells you the score changes
 * nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IndianRupee, TrendingDown, Banknote, Receipt, Package2,
  PhoneCall, Archive, Scissors, AlertTriangle, ArrowRight, Wallet, ShieldCheck, Loader2,
} from "lucide-react";
import { istMonthStart, istCalendarDate } from "@pharmacy/utils";
import { api, getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { LoadErrorState } from "@/components/LoadErrorState";
import {
  C, PAYMENT_COLORS, ChartCard, RevenueTrend, Donut, HBars, LegendRow, Sparkline,
  inrCompact, num,
} from "./chartKit";

type Period = "month" | "30d" | "quarter" | "year";
const PERIOD_LABEL: Record<Period, string> = {
  month: "This month", "30d": "Last 30 days", quarter: "This quarter", year: "This year",
};

function toDate(d: Date) { return istCalendarDate(d); }
function shift(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function rangeFor(p: Period): { from: string; to: string; prevFrom: string; prevTo: string; groupBy: "day" | "month" } {
  const today = toDate(new Date());
  let from: string;
  if (p === "month") from = istMonthStart(new Date());
  else if (p === "30d") from = shift(today, -29);
  else if (p === "quarter") { const d = new Date(); d.setDate(d.getDate() - 89); from = toDate(d); }
  else from = `${today.slice(0, 4)}-01-01`;
  const span = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
  return {
    from, to: today,
    prevFrom: shift(from, -span), prevTo: shift(from, -1),
    groupBy: span > 62 ? "month" : "day",
  };
}
// Backend @RequestParam Instant expects the Z form (ISO_INSTANT); an explicit +05:30
// offset string is rejected with a 400. Convert IST wall-clock bounds to a UTC instant.
const isoStart = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
const isoEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`).toISOString();
const pct = (cur: number, prev: number) => (prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);

// ─── Types (subset of each report's response) ────────────────────────────────
interface SeriesPoint { date: string; invoiceCount: number; revenue: number; gstCollected: number; }
interface Margin {
  revenueExGst: number; cogs: number; grossProfit: number; marginPct: number;
  lossMakers: { grossProfit: number }[];
  returns: { writtenOffCost: number; refundExGst: number };
}
interface Lapsed { valueAtRisk: number; items: unknown[]; }
interface Dead { totalCostAtRisk: number; items: unknown[]; }
interface Expiry { id: string; quantity: number; looseUnits: number; expiryDate: string; mrp: number; }
interface PayMix { total: number; slices: { mode: string; amount: number; bills: number; sharePct: number }[]; }
interface Fast { items: { medicine: { name: string } | null; qtySold: number; revenue: number; inventoryId: string }[]; }
interface Cust { customersBilled: number; newCustomers: number; returningCustomers: number; walkIns: { bills: number; sharePct: number }; }
interface Gst3b { identity: { gstin: string | null; state: string | null }; dataQuality: { gstinMissing: boolean; stateMissing: boolean }; }
interface DashStats { pendingCredit?: number; }

function daysUntil(d: string) { return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); }

// ─── KPI tile ────────────────────────────────────────────────────────────────
function Kpi({ label, value, delta, prevText, icon: Icon, tone = "slate", spark }: {
  label: string; value: string; delta?: number | null; prevText?: string;
  icon: React.ElementType; tone?: "emerald" | "teal" | "indigo" | "sky" | "slate"; spark?: React.ReactNode;
}) {
  const toneCls = {
    emerald: "bg-emerald-50 text-emerald-600", teal: "bg-teal-50 text-teal-600",
    indigo: "bg-indigo-50 text-indigo-600", sky: "bg-sky-50 text-sky-600", slate: "bg-slate-100 text-slate-500",
  }[tone];
  const good = delta != null && delta >= 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-2">
        <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", toneCls)}>
          <Icon className="w-4 h-4" strokeWidth={1.9} />
        </span>
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[24px] leading-none font-black text-slate-900 tabular-nums">{value}</span>
        {delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums",
            Math.abs(delta) < 0.5 ? "text-slate-400" : good ? "text-emerald-600" : "text-red-500")}>
            {Math.abs(delta) < 0.5 ? "―" : good ? "▲" : "▼"}{Math.abs(delta).toFixed(Math.abs(delta) >= 100 ? 0 : 1)}%
          </span>
        )}
      </div>
      {spark && <div className="h-[34px] -mx-1">{spark}</div>}
      {prevText && <p className="text-[10px] text-slate-400">{prevText}</p>}
    </div>
  );
}

// ─── Opportunity card ────────────────────────────────────────────────────────
function Opp({ icon: Icon, tone, headline, value, body, cta, onClick }: {
  icon: React.ElementType; tone: "amber" | "red" | "violet" | "sky" | "emerald";
  headline: string; value: string; body: string; cta: string; onClick: () => void;
}) {
  const t = {
    amber: "border-amber-200 bg-amber-50/50 text-amber-700", red: "border-red-200 bg-red-50/50 text-red-700",
    violet: "border-violet-200 bg-violet-50/40 text-violet-700", sky: "border-sky-200 bg-sky-50/40 text-sky-700",
    emerald: "border-emerald-200 bg-emerald-50/40 text-emerald-700",
  }[tone];
  return (
    <button onClick={onClick}
      className={cn("text-left rounded-2xl border p-4 flex flex-col gap-1.5 transition-all hover:shadow-md hover:-translate-y-0.5", t)}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
        <span className="text-[11px] font-bold uppercase tracking-wide">{headline}</span>
      </div>
      <span className="text-[22px] font-black tabular-nums text-slate-900">{value}</span>
      <p className="text-[11px] text-slate-500 leading-snug">{body}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold">
        {cta} <ArrowRight className="w-3 h-3" />
      </span>
    </button>
  );
}

export default function OverviewTab({ active, onNavigate }: { active: boolean; onNavigate: (tab: string) => void }) {
  const [period, setPeriod] = useState<Period>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<{
    series: SeriesPoint[]; prevSeries: SeriesPoint[]; margin: Margin | null; gstTotal: number; gstPrev: number;
    stockCost: number; lapsed: Lapsed | null; dead: Dead | null; expiry: Expiry[]; pay: PayMix | null;
    fast: Fast | null; cust: Cust | null; gst3b: Gst3b | null; credit: number;
  } | null>(null);
  const reqId = useRef(0);

  const [partial, setPartial] = useState<string[]>([]);

  const load = useCallback(async (p: Period) => {
    const id = ++reqId.current;
    setLoading(true);
    const r = rangeFor(p);
    const missed: string[] = [];
    // Each section is fetched independently: one failing must not blank the rest. What DID
    // fail is remembered by name and shown as a strip, so the owner knows a figure is
    // absent rather than zero.
    const get = <T,>(label: string, path: string) =>
      api.get<{ data: T }>(path).then(x => x.data.data).catch((e) => {
        missed.push(label);
        if (typeof console !== "undefined") console.warn(`[reports/overview] ${label} failed:`, getErrorMessage(e, ""));
        return null;
      });
    const [series, prevSeries, margin, gst, gstPrev, val, lapsed, dead, expiry, pay, fast, cust, gst3b, dash] =
      await Promise.all([
        get<SeriesPoint[]>("Revenue trend", `/reports/sales/daily-series?from=${r.from}&to=${r.to}&groupBy=${r.groupBy}`),
        get<SeriesPoint[]>("Previous-period comparison", `/reports/sales/daily-series?from=${r.prevFrom}&to=${r.prevTo}&groupBy=${r.groupBy}`),
        get<Margin>("Gross profit", `/reports/sales/margin?from=${isoStart(r.from)}&to=${isoEnd(r.to)}&limit=5`),
        get<{ _sum: { totalGst: number | null } }>("GST payable", `/reports/gst?from=${isoStart(r.from)}&to=${isoEnd(r.to)}`),
        get<{ _sum: { totalGst: number | null } }>("GST comparison", `/reports/gst?from=${isoStart(r.prevFrom)}&to=${isoEnd(r.prevTo)}`),
        get<{ totalCostValue: number }>("Stock value", `/reports/inventory/valuation?groupBy=category`),
        get<Lapsed>("Lapsed customers", `/reports/customers/lapsed?inactiveDays=90&minVisits=2&limit=200`),
        get<Dead>("Dead stock", `/reports/analytics/dead-stock?days=90`),
        get<Expiry[]>("Expiring stock", `/reports/expiry?days=30`),
        get<PayMix>("Payment mix", `/reports/sales/payment-mix?from=${isoStart(r.from)}&to=${isoEnd(r.to)}`),
        get<Fast>("Top medicines", `/reports/analytics/fast-moving?from=${isoStart(r.from)}&to=${isoEnd(r.to)}&limit=8`),
        get<Cust>("Customer counts", `/reports/customers?from=${isoStart(r.from)}&to=${isoEnd(r.to)}&limit=1`),
        get<Gst3b>("Compliance status", `/reports/gst/gstr-3b?from=${isoStart(istMonthStart(new Date()))}&to=${isoEnd(r.to)}`),
        get<DashStats>("Uncollected credit", `/billing/dashboard/stats`),
      ]);
    if (reqId.current !== id) return;
    if (!series && !margin && !val) {
      setError("The reports service could not be reached — none of the overview figures loaded. Check your connection and retry.");
      setLoading(false);
      return;
    }
    setError(null);
    setPartial(missed);
    setD({
      series: series ?? [], prevSeries: prevSeries ?? [],
      margin, gstTotal: gst?._sum?.totalGst ?? 0, gstPrev: gstPrev?._sum?.totalGst ?? 0,
      stockCost: val?.totalCostValue ?? 0, lapsed, dead, expiry: expiry ?? [], pay, fast, cust, gst3b,
      credit: dash?.pendingCredit ?? 0,
    });
    setLoading(false);
  }, []);

  const lastKey = useRef<string>("");
  useEffect(() => {
    if (!active) return;
    if (lastKey.current === period) return;
    lastKey.current = period;
    load(period);
  }, [active, period, load]);

  const view = useMemo(() => {
    if (!d) return null;
    // A malformed YYYY-MM(-DD) key would render "Invalid Date"; fall back to the raw key.
    const fmtBucket = (key: string, monthOnly: boolean) => {
      const dt = new Date(`${key}${key.length === 7 ? "-01" : ""}T12:00:00Z`);
      if (Number.isNaN(dt.getTime())) return key;
      return dt.toLocaleDateString("en-IN",
        monthOnly ? { day: "2-digit", timeZone: "UTC" }
          : key.length === 7 ? { month: "short", timeZone: "UTC" }
            : { day: "2-digit", month: "short", timeZone: "UTC" });
    };
    const series = (d.series ?? []).map(x => ({ ...x, revenue: num(x.revenue), invoiceCount: num(x.invoiceCount) }));
    const prevSeries = (d.prevSeries ?? []).map(x => ({ ...x, revenue: num(x.revenue) }));
    const revNow = series.reduce((s, x) => s + x.revenue, 0);
    const revPrev = prevSeries.reduce((s, x) => s + x.revenue, 0);
    const billsNow = series.reduce((s, x) => s + x.invoiceCount, 0);
    const trend = series.map(x => ({ label: fmtBucket(x.date, series.length > 45), revenue: x.revenue, bills: x.invoiceCount }));
    const prevAligned = prevSeries.map(x => x.revenue);
    const lossTotal = d.margin ? Math.abs((d.margin.lossMakers ?? []).reduce((s, i) => s + Math.min(num(i.grossProfit), 0), 0)) : 0;
    const lossCount = d.margin ? (d.margin.lossMakers ?? []).length : 0;
    const expSoon = (d.expiry ?? []).filter(e => daysUntil(e.expiryDate) <= 30);
    const expValue = expSoon.reduce((s, e) => s + num(e.mrp) * (num(e.quantity) + (num(e.looseUnits) > 0 ? 1 : 0)), 0);
    const expiredCount = (d.expiry ?? []).filter(e => daysUntil(e.expiryDate) <= 0).length;
    const pay = d.pay?.slices?.map(s => ({ name: s.mode, value: num(s.amount), color: PAYMENT_COLORS[s.mode] ?? "#94a3b8" })) ?? [];
    const topMeds = (() => {
      const m = new Map<string, number>();
      for (const it of d.fast?.items ?? []) {
        const k = it.medicine?.name ?? "Unknown";
        m.set(k, (m.get(k) ?? 0) + num(it.revenue));
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
    })();
    return {
      revNow, revPrev, billsNow, trend, prevAligned,
      profit: d.margin?.grossProfit ?? 0, marginPct: d.margin?.marginPct ?? 0,
      lossTotal, lossCount, expSoon, expValue, expiredCount, pay, topMeds,
    };
  }, [d]);

  if (error) {
    return <div className="py-4"><LoadErrorState title="Reports overview could not be loaded" message={error} onRetry={() => load(period)} /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur rounded-2xl border border-slate-200 shadow-sm px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {(Object.keys(PERIOD_LABEL) as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={cn("px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all",
              period === p ? "bg-blue-600 text-white shadow-sm" : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300")}>
            {PERIOD_LABEL[p]}
          </button>
        ))}
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-300 ml-1" />}
      </div>

      {/* Some sections loaded, some didn't — name the ones that didn't so a blank card
          reads as "not loaded" rather than "nothing here". */}
      {!loading && partial.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
          <p className="text-[11px] text-amber-900 leading-relaxed">
            <span className="font-bold">{partial.length} section{partial.length === 1 ? "" : "s"} didn&apos;t load:</span>{" "}
            {partial.join(", ")}. Those figures are missing, not zero.{" "}
            <button onClick={() => load(period)} className="font-bold underline hover:no-underline">Retry</button>
          </p>
        </div>
      )}

      {/* Scoreboard */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Revenue" icon={IndianRupee} tone="emerald"
          value={loading || !view ? "—" : inrCompact(view.revNow)}
          delta={view ? pct(view.revNow, view.revPrev) : null}
          prevText={view ? `${view.billsNow} bills · prev ${inrCompact(view.revPrev)}` : undefined}
          spark={view && view.trend.length > 1 ? <SparkArea values={view.trend.map(t => t.revenue)} color={C.revenue} /> : undefined} />
        <Kpi label="Gross profit" icon={Banknote} tone="teal"
          value={loading || !view ? "—" : inrCompact(view.profit)}
          prevText={view ? `${view.marginPct.toFixed(1)}% margin` : undefined} />
        <Kpi label="GST payable" icon={Receipt} tone="indigo"
          value={loading || !d ? "—" : inrCompact(d.gstTotal)}
          delta={d ? pct(d.gstTotal, d.gstPrev) : null}
          prevText={d ? `output tax, ${PERIOD_LABEL[period].toLowerCase()}` : undefined} />
        <Kpi label="Stock at cost" icon={Package2} tone="sky"
          value={loading || !d ? "—" : inrCompact(d.stockCost)}
          prevText="live sellable stock" />
      </div>

      {/* Money on the table */}
      {view && d && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Wallet className="w-4 h-4 text-slate-400" />
            <h3 className="text-[13px] font-black text-slate-700">Money on the table</h3>
            <span className="text-[11px] text-slate-400">— things to act on this week</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {d.lapsed && d.lapsed.valueAtRisk > 0 && (
              <Opp icon={PhoneCall} tone="violet" headline="Lapsed regulars"
                value={inrCompact(d.lapsed.valueAtRisk)}
                body={`${d.lapsed.items.length} repeat customers haven't been in for 90+ days. A call usually brings them back.`}
                cta="Open call list" onClick={() => onNavigate("customers")} />
            )}
            {d.dead && d.dead.totalCostAtRisk > 0 && (
              <Opp icon={Archive} tone="amber" headline="Dead stock"
                value={inrCompact(d.dead.totalCostAtRisk)}
                body={`${d.dead.items.length} batches with no sale in 90 days — capital frozen on the shelf.`}
                cta="Review dead stock" onClick={() => onNavigate("inventory")} />
            )}
            {view.lossCount > 0 && (
              <Opp icon={Scissors} tone="red" headline="Sold below cost"
                value={inrCompact(view.lossTotal)}
                body={`${view.lossCount} medicine${view.lossCount === 1 ? "" : "s"} sold under cost this period — usually a stale MRP or a stacked discount.`}
                cta="Fix pricing" onClick={() => onNavigate("sales")} />
            )}
            {(view.expValue > 0 || view.expiredCount > 0) && (
              <Opp icon={AlertTriangle} tone="amber" headline={view.expiredCount > 0 ? "Expired / expiring" : "Expiring soon"}
                value={inrCompact(view.expValue)}
                body={`${view.expSoon.length} batch${view.expSoon.length === 1 ? "" : "es"} at MRP within 30 days${view.expiredCount > 0 ? ` · ${view.expiredCount} already expired` : ""}. Return to distributor or write off.`}
                cta="Manage expiry" onClick={() => onNavigate("inventory")} />
            )}
            {d.credit > 0 && (
              <Opp icon={IndianRupee} tone="sky" headline="Uncollected credit"
                value={inrCompact(d.credit)}
                body="Billed on credit and still outstanding across active invoices."
                cta="See receivables" onClick={() => onNavigate("customers")} />
            )}
            {d.margin && d.margin.returns.writtenOffCost > 0 && (
              <Opp icon={TrendingDown} tone="red" headline="Returned & destroyed"
                value={inrCompact(d.margin.returns.writtenOffCost)}
                body="Refunded to the customer AND the stock written off — the pharmacy is out both."
                cta="Review returns" onClick={() => onNavigate("sales")} />
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Revenue trend" className="lg:col-span-2"
          subtitle={view ? `${PERIOD_LABEL[period]} · vs previous period (dashed)` : undefined} height={230}>
          {loading || !view ? <ChartSkeleton /> :
            view.trend.length === 0 ? <Empty msg="No sales in this period" /> :
              <RevenueTrend data={view.trend} prev={view.prevAligned.length === view.trend.length ? view.prevAligned : null} height={230} />}
        </ChartCard>
        <ChartCard title="Payment mix" subtitle={d?.pay ? `${d.pay.slices.reduce((s, x) => s + x.bills, 0)} bills` : undefined} height={230}>
          {loading || !view ? <ChartSkeleton /> :
            view.pay.length === 0 ? <Empty msg="No takings yet" /> : (
              <div>
                <Donut data={view.pay} height={170}
                  centerValue={inrCompact(view.pay.reduce((s, x) => s + x.value, 0))} centerLabel="Total" />
                <LegendRow items={view.pay.map(s => ({ label: s.name, color: s.color, value: inrCompact(s.value) }))} />
              </div>
            )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Top medicines by revenue" className="lg:col-span-2"
          subtitle={PERIOD_LABEL[period]} height={230}>
          {loading || !view ? <ChartSkeleton /> :
            view.topMeds.length === 0 ? <Empty msg="No medicine-level sales in this period" /> :
              <HBars data={view.topMeds} height={230} color={C.revenue} onClick={() => onNavigate("sales")} />}
        </ChartCard>

        {/* Compliance status */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
            <h3 className="text-[13px] font-black text-slate-800">Compliance status</h3>
          </div>
          <ul className="space-y-2.5">
            <StatusRow ok={!d?.gst3b?.dataQuality?.gstinMissing}
              label="GSTIN on file" detail={d?.gst3b?.identity?.gstin ?? "not set"} />
            <StatusRow ok={!d?.gst3b?.dataQuality?.stateMissing}
              label="Pharmacy state set" detail={d?.gst3b?.identity?.state ?? "not set — interstate tax can't be determined"} />
            <StatusRow ok label="GST summary" detail="Ready for the current month" onClick={() => onNavigate("compliance")} />
            <StatusRow ok label="Schedule H register" detail="Open in Compliance" onClick={() => onNavigate("compliance")} />
          </ul>
          <button onClick={() => onNavigate("compliance")}
            className="mt-4 w-full flex items-center justify-center gap-1.5 text-[12px] font-bold text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg py-2 hover:bg-indigo-50 transition-colors">
            Open compliance <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ ok, label, detail, onClick }: { ok: boolean; label: string; detail: string; onClick?: () => void }) {
  return (
    <li className={cn("flex items-start gap-2.5", onClick && "cursor-pointer")} onClick={onClick}>
      <span className={cn("w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
        ok ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600")}>
        {ok ? <ShieldCheck className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-slate-700">{label}</p>
        <p className="text-[11px] text-slate-400 truncate">{detail}</p>
      </div>
    </li>
  );
}

function SparkArea({ values, color }: { values: number[]; color: string }) {
  return <Sparkline values={values} color={color} height={34} />;
}
function ChartSkeleton() { return <div className="w-full h-full rounded-xl skeleton" />; }
function Empty({ msg }: { msg: string }) {
  return <div className="w-full h-full flex items-center justify-center text-[12px] text-slate-400">{msg}</div>;
}
