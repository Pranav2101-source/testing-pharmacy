import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { istRangeStart, istRangeEnd, istCalendarDate, istMonthStart } from "@pharmacy/utils";
import { getStoredUser } from "@/lib/auth";
import {
  BarChart3, Receipt, AlertTriangle,
  IndianRupee, TrendingUp, Download,
  Loader2, Package2, Flame, TrendingDown, Archive,
  ShoppingCart, FileCheck, CheckCircle2,
  BadgePercent, BookOpen, ArrowUpDown, Banknote,
  ClipboardList, ArrowRight, Users, PhoneCall, Scissors,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/Skeleton";
import { LoadErrorState } from "@/components/LoadErrorState";
import { LooseTag } from "@/components/LooseTag";
import { api, getErrorMessage } from "@/lib/api-client";
import { downloadCsv, downloadXlsx, type CellValue } from "@/lib/export";
import { LayoutDashboard } from "lucide-react";
import OverviewTab from "./reports/OverviewTab";
import {
  RevenueTrend as RevenueTrendChart, ChartCard, Donut, HBars, LegendRow, StackedBars,
  C as CHARTC, SERIES, inrCompact, num,
} from "./reports/chartKit";

// ─── Types ────────────────────────────────────────────────────────
type ReportTab       = "overview" | "sales" | "customers" | "inventory" | "purchases" | "compliance" | "audit";
type ComplianceSubTab = "gst" | "gstr-3b" | "hsn-summary" | "schedule-h";
type Period          = "today" | "week" | "month" | "year" | "custom";
/** Chart bucket size. `month` keys are `YYYY-MM`; `day` keys are `YYYY-MM-DD`. */
type Bucket          = "day" | "month";

interface DailySalesPoint {
  date: string; invoiceCount: number; revenue: number; gstCollected: number;
}
interface MarginItem {
  inventoryId: string;
  medicine: { id: string; name: string; genericName: string | null; form: string | null } | null;
  qtySold: number; revenueExGst: number; cogs: number; grossProfit: number;
  marginPct: number; batchNumber: string | null;
}
interface TaxAmount {
  taxableValue: number; igst: number; cgst: number; sgst: number;
}
interface Gstr3b {
  periodLabel: string;
  identity: { legalName: string | null; gstin: string | null; state: string | null };
  outwardSupplies: {
    taxableOutward: TaxAmount; zeroRated: TaxAmount; nilRatedExempt: TaxAmount;
    reverseCharge: TaxAmount; nonGst: TaxAmount; creditNotes: TaxAmount;
  };
  // `state` is null when the place of supply could not be determined — no customer on the
  // bill, or a customer with no state. Rendered as an explicit unknown, never as a blank.
  interstateToUnregistered: { state: string | null; taxableValue: number; igst: number }[];
  // 4(B) has two statutory halves and they are not interchangeable: (1) is permanent,
  // (2) is reclaimable later through 4(D)(1).
  inputTaxCredit: {
    allOtherItc: TaxAmount; reversedSection17: TaxAmount;
    reversedOther: TaxAmount; netAvailable: TaxAmount;
  };
  exemptInward: TaxAmount;
  dataQuality: {
    gstinMissing: boolean; stateMissing: boolean;
    misclassifiedGrns: string[];
    suppliersWithoutState: number; suppliersTotal: number;
    /** What netting pushed below zero and had to be floored — carries into the next period. */
    carryForward: TaxAmount;
    /** Bills from this period cancelled after it closed, so a filed return no longer matches. */
    lateCancellations: { count: number; taxableValue: number; totalGst: number };
    interstateWithoutPlaceOfSupply: number;
    /** Expired stock never written off — the credit behind Table 4(B)(1), still unreversed. */
    expiredStock: { batches: number; units: number; cost: number; embeddedItc: number };
    untrackedNotes: string[];
  };
}
interface CustomerRow {
  customerId: string; name: string; phone: string | null;
  bills: number; revenue: number; lastVisit: string;
}
interface CustomerInsights {
  customersBilled: number; newCustomers: number; returningCustomers: number;
  repeatRatePct: number; identifiedRevenue: number;
  walkIns: { bills: number; sharePct: number };
  topCustomers: CustomerRow[];
}
interface LapsedCustomer {
  customerId: string; name: string; phone: string | null;
  totalBills: number; lifetimeRevenue: number; lastVisit: string; daysSinceLastVisit: number;
}
interface LapsedReport {
  inactiveDays: number; minVisits: number; valueAtRisk: number; items: LapsedCustomer[];
}
interface MarginReport {
  revenueExGst: number; cogs: number; grossProfit: number; marginPct: number; unitsSold: number;
  returns: { refundExGst: number; restockedCost: number; writtenOffCost: number; unitsReturned: number };
  // Null when nothing was sold loose (cut-strip) in the period — most pharmacies, most periods.
  looseSales: { revenueExGst: number; piecesSold: number; lineCount: number; billCount: number } | null;
  dataQuality: { costedRevenuePct: number; linesMissingCost: number; revenueMissingCost: number; totalLines: number };
  topContributors: MarginItem[];
  lossMakers: MarginItem[];
}
interface FastMovingItem {
  inventoryId: string;
  medicine: { id: string; name: string; genericName: string | null; form: string | null } | null;
  qtySold: number;
  revenue: number;
}
interface DeadStockItem {
  id: string; batchNumber: string; expiryDate: string; quantity: number;
  // Loose pieces from an opened strip — a batch can sit at quantity 0 and still be worth
  // the costAtRisk/retailValue shown, entirely from this remainder.
  looseUnits: number;
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
// `user` and `medicine` are nullable on the wire — the DTO emits null for both when the
// underlying row is gone. They were typed non-null here, so `item.invoice.user.name` would
// have taken the whole Reports page down rather than degrading to one incomplete row.
interface ScheduleHItem {
  id: string; quantity: number;
  invoice: {
    invoiceNumber: string; createdAt: string;
    prescriptionId: string | null; doctorName: string | null;
    customer: { name: string; phone: string | null } | null;
    user: { name: string } | null;
  };
  inventory: {
    medicine: { name: string; genericName: string | null; schedule: string | null; strength: string | null; form: string | null } | null;
  } | null;
}
interface GstData {
  // extraCharges / adjustmentAmount / roundOff complete the invoice identity:
  // taxable + GST + charges + adjustment + round-off == totalAmount. Without them the
  // screen showed a taxable value and a tax total that did not add up to the net beneath.
  _sum: {
    subtotal: number | null; discountAmount: number | null; taxableAmount: number | null;
    cgst: number | null; sgst: number | null; igst: number | null; totalGst: number | null;
    extraCharges: number | null; adjustmentAmount: number | null; roundOff: number | null;
    totalAmount: number | null;
  };
  _count: number;
}
interface ExpiryItem {
  id: string; quantity: number; looseUnits: number; expiryDate: string; batchNumber: string; mrp: number;
  medicine: { name: string };
}

// ─── Helpers ──────────────────────────────────────────────────────
function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/**
 * Two identity rows for a report that leaves the building — the pharmacy's name and,
 * where we have it, its GSTIN, plus when it was generated. An accountant or a bank
 * officer opening the workbook should not have to ask which shop it is for.
 */
function brandedHeader(title: string, gstin?: string | null): CellValue[][] {
  const name = getStoredUser()?.pharmacyName ?? "Pharmacy";
  const stamp = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return [
    [name, gstin ? `GSTIN ${gstin}` : ""],
    [title, `Generated ${stamp}`],
    [],
  ];
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
// The IST calendar date, NOT the UTC one. toISOString() reports the UTC day, which
// for local midnight in IST is always the day before — so every default range on this
// page began (and sometimes ended) a day out. See istCalendarDate.
function toInputDate(d: Date) { return istCalendarDate(d); }
// IST-aware range helpers — server stores UTC, IST = UTC+5:30. The offset logic lives in
// @pharmacy/utils so this page and the Sales/Purchases filters can't drift apart; these
// wrappers keep the non-null string contract the interpolating call sites below rely on.
function isoFrom(dateStr: string): string { return istRangeStart(dateStr) ?? ""; }
function isoTo(dateStr: string): string   { return istRangeEnd(dateStr) ?? ""; }

/**
 * Why the compliance tabs refuse to run on a half-filled range.
 *
 * <p>A date box can be CLEARED — the browser allows it and the value becomes "". The helpers
 * above then return "", the request goes out as `?from=&to=...`, and the period label renders
 * `fmtDate("")` as "Invalid Date" — which also lands in the exported workbook's header. What
 * the server does with an empty bound is worse than the label: it is not a date, so the range
 * falls back to its widest sentinel and the answer is EVERY invoice ever recorded, presented
 * under a one-month heading.
 *
 * <p>On a GST screen that is the dangerous kind of wrong: the figures look ordinary, they are
 * just for the wrong period entirely. So the range is validated before anything is fetched,
 * and the reason is shown rather than the button silently doing nothing.
 *
 * @returns null when the range is usable, otherwise the reason it is not
 */
function rangeError(from: string, to: string): string | null {
  if (!from || !to) {
    return "Pick both a start date and an end date.";
  }
  // Lexical comparison is correct and total for YYYY-MM-DD, no Date parsing needed.
  if (from > to) {
    return "The start date is after the end date.";
  }
  return null;
}

function getPeriodDates(period: Period, cf = "", ct = ""): { from: string; to: string } {
  const today = toInputDate(new Date());
  if (period === "today") return { from: today, to: today };
  if (period === "week")  { const d = new Date(); d.setDate(d.getDate() - 6); return { from: toInputDate(d), to: today }; }
  if (period === "month") { const d = new Date(); d.setDate(1); return { from: toInputDate(d), to: today }; }
  // Derived from the IST calendar date, not new Date(y, 0, 1) — local midnight on
  // 1 January is 31 December in UTC, the same off-by-one istMonthStart exists to avoid.
  if (period === "year")  return { from: `${today.slice(0, 4)}-01-01`, to: today };
  // A custom range that is empty or inverted must not reach the API — the Sales/Customers/
  // Purchases tabs auto-fetch on every selector change (no Generate button to gate it),
  // and an inverted range widens to a sentinel-bounded "everything" on the server. Fall
  // back to today until the pharmacist has picked a usable range; PeriodSelector shows why.
  if (rangeError(cf, ct)) return { from: today, to: today };
  return { from: cf, to: ct };
}

// ─── Date arithmetic on YYYY-MM-DD strings ───────────────────────
// Anchored at NOON UTC on purpose. Parsing a bare date gives UTC midnight, and any
// arithmetic on it that later gets read back in a zone behind UTC lands on the previous
// day; noon is twelve hours clear of both boundaries, so adding days can never slip one.
function parseDayUtc(dateStr: string): Date { return new Date(`${dateStr}T12:00:00Z`); }
function shiftDays(dateStr: string, days: number): string {
  const d = parseDayUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Inclusive day count — a single-day range is 1, not 0. */
function daysInRange(from: string, to: string): number {
  return Math.round((parseDayUtc(to).getTime() - parseDayUtc(from).getTime()) / 86400000) + 1;
}
/**
 * The equal-length window ending the day before `from` — what "vs previous period" compares
 * against. Deliberately length-matched rather than calendar-matched: comparing a 14-day
 * month-to-date against a full 31-day month would report a collapse in sales every month.
 */
function previousRange(from: string, to: string): { from: string; to: string } {
  const span = daysInRange(from, to);
  return { from: shiftDays(from, -span), to: shiftDays(from, -1) };
}
/**
 * Day bars up to about two months, month bars beyond.
 *
 * <p>The backend groups by IST day at any width, but the chart cannot: a quarter is 90 bars
 * and a year is 365, in a control sized for seven. 62 days keeps every calendar month on
 * daily bars — the common case — and switches before a quarter arrives.
 */
function bucketFor(from: string, to: string): Bucket {
  return daysInRange(from, to) > 62 ? "month" : "day";
}
/** Percentage change, or null when the baseline is zero and a percentage would be meaningless. */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
const PERIOD_LABELS: Record<Period, string> = {
  today: "Today", week: "Last 7 Days", month: "This Month", year: "This Year", custom: "Custom",
};

/**
 * Runs `load` only while the tab is on screen, and only when `key` has actually changed
 * since the last run.
 *
 * <p>Tabs are kept alive rather than unmounted (see the page component), so once a tab has
 * been opened its effects keep firing forever. Sales, Customers and Purchases all share one
 * period selector, so changing the period on the visible tab silently refetched every other
 * tab that had ever been opened — seven requests where four were wanted, all but the visible
 * ones thrown away, and every one of them a database round trip on a connection pool sized
 * for five.
 *
 * <p>The key check is what keeps keep-alive worth having: without it, gating on visibility
 * alone would refetch on every single tab switch, which is the cost unmounting had in the
 * first place. Switching away and back with nothing changed does nothing at all.
 */
function useVisibleLoad(active: boolean, key: string, load: () => void) {
  const lastLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!active || lastLoaded.current === key) return;
    lastLoaded.current = key;
    load();
    // `load` is a useCallback in every caller; keying on it as well would re-run whenever
    // an unrelated piece of that tab's state changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);
}

// ─── Shared: Period Selector ──────────────────────────────────────
function PeriodSelector({ period, onChange, customFrom, customTo, onCustomChange }: {
  period: Period; onChange: (p: Period) => void;
  customFrom: string; customTo: string;
  onCustomChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["today","week","month","year","custom"] as Period[]).map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all",
            period === p ? "bg-blue-600 text-white shadow-sm" : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300"
          )}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
      {period === "custom" && (() => {
        const err = rangeError(customFrom, customTo);
        return (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} max={customTo || toInputDate(new Date())}
              onChange={e => onCustomChange(e.target.value, customTo)}
              className={cn("px-2.5 py-1.5 rounded-lg border text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400",
                err ? "border-amber-300 bg-amber-50/50" : "border-slate-200")}
            />
            <span className="text-slate-400 text-[11px]">to</span>
            <input type="date" value={customTo} min={customFrom} max={toInputDate(new Date())}
              onChange={e => onCustomChange(customFrom, e.target.value)}
              className={cn("px-2.5 py-1.5 rounded-lg border text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400",
                err ? "border-amber-300 bg-amber-50/50" : "border-slate-200")}
            />
            {err && (
              <span className="text-[11px] font-semibold text-amber-700">
                {err} <span className="font-normal text-amber-600">— showing today until then</span>
              </span>
            )}
          </div>
        );
      })()}
    </div>
  );
}


// ─── Figures ─────────────────────────────────────────────────────
/**
 * The one number a tab leads with.
 *
 * <p>Proportional figures, deliberately not tabular: at this size `tabular-nums` pads every
 * digit to the width of a zero and a value like "121" renders visibly gappy. Tabular belongs
 * in columns that have to align vertically, not on a display figure.
 */
function HeroStat({ label, value, sub, delta }: {
  label: string; value: string; sub?: React.ReactNode; delta?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
      <div className="flex items-baseline gap-2.5 mt-1 flex-wrap">
        <span className="text-[36px] leading-none font-black text-slate-900">{value}</span>
        {delta}
      </div>
      {sub && <p className="text-[11px] text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "accent";
const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-slate-800",
  good:    "text-emerald-700",
  warn:    "text-amber-700",
  bad:     "text-red-700",
  accent:  "text-blue-700",
};

/**
 * The single stat shape used across this screen.
 *
 * <p>There used to be three of them: chips with an icon tile in the sales header, a divided
 * row in the profit panel, a third in the customers panel. Three ways of saying the same
 * thing on one page is what makes a dashboard feel assembled rather than designed, and it
 * costs the reader a fresh scan at every section.
 */
function StatTile({ label, value, hint, tone = "neutral", delta, loading }: {
  label: string; value: string; hint?: React.ReactNode; tone?: Tone;
  delta?: React.ReactNode; loading?: boolean;
}) {
  return (
    <div className="bg-white px-5 py-3.5 min-w-0">
      {loading
        ? <div className="h-[25px] w-20 rounded skeleton" />
        : <p className={cn("text-[21px] font-black leading-tight truncate", TONE_TEXT[tone])}>{value}</p>}
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
        <p className="text-[11px] font-bold text-slate-600">{label}</p>
        {!loading && delta}
      </div>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

/**
 * A hairline-divided row of {@link StatTile}s, folding to two columns on narrow screens.
 *
 * <p>The dividers are a 1px grid gap showing the slate underneath rather than borders on the
 * tiles — borders double up between neighbours and leave a stray edge at the ends, which is
 * what made the earlier `divide-x` version drift by a pixel when a row wrapped.
 */
function StatRow({ cols = 4, children }: { cols?: 3 | 4; children: React.ReactNode }) {
  return (
    <div className={cn(
      "grid grid-cols-2 gap-px bg-slate-100 border-b border-slate-100",
      cols === 3 ? "md:grid-cols-3" : "md:grid-cols-4"
    )}>
      {children}
    </div>
  );
}

// ─── Revenue trend (Recharts) ────────────────────────────────────
/** Bar caption: "12 Aug" for day buckets, "Aug" for month buckets. */
function trendLabel(key: string, bucket: Bucket): string {
  return bucket === "month"
    ? new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })
    : new Date(`${key}T12:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}

/**
 * Revenue per bucket for the selected period, with the equivalent window before it drawn
 * as a faint dashed line so "up or down on last time" is read at a glance rather than
 * computed. Built on the shared Recharts kit ({@code chartKit}) — same axes, same tooltip,
 * same colour language as every other chart in Reports.
 */
function RevenueChart({ days, prev, loading, bucket }: {
  days: DailySalesPoint[]; prev?: DailySalesPoint[] | null; loading: boolean; bucket: Bucket;
}) {
  if (loading) return <div className="h-[230px] w-full rounded-xl skeleton" />;
  if (days.length === 0) {
    return <div className="h-[230px] flex items-center justify-center text-[12px] text-slate-400">No sales in this period</div>;
  }
  const todayStr = toInputDate(new Date());
  const currentKey = trendLabel(bucket === "month" ? todayStr.slice(0, 7) : todayStr, bucket);
  const data = days.map(d => ({ label: trendLabel(d.date, bucket), revenue: d.revenue, bills: d.invoiceCount }));
  const prevArr = prev && prev.length === days.length ? prev.map(p => p.revenue) : null;
  return <RevenueTrendChart data={data} prev={prevArr} height={230} currentKey={currentKey} />;
}


// ─── Period-over-period delta chip ───────────────────────────────
/**
 * The number an owner actually looks for: not "₹50.9K", but "₹50.9K, up 12% on last month".
 *
 * <p>Stays silent rather than guessing when the previous period was zero — "up ∞%" and
 * "up 100%" are both meaningless against no baseline, and a first month of trading should
 * not read as explosive growth.
 */
function DeltaChip({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  const pct = pctChange(current, previous);
  if (pct === null) return <span className="text-[10px] text-slate-300 font-semibold">no prior data</span>;
  const flat = Math.abs(pct) < 0.5;
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span
      title={`Previous period: ${fmtK(previous)}`}
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums",
        flat ? "text-slate-400" : good ? "text-emerald-600" : "text-red-500"
      )}
    >
      {/* The arrow states the DIRECTION, the colour states whether that direction is good —
          for returns and cost, down is the good one. Conflating them would paint a fall in
          refunds red. */}
      {flat ? "―" : pct > 0 ? "▲" : "▼"}
      {Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%
    </span>
  );
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
  // The number itself is always rendered beside the colour, which is what makes a
  // three-step value scale legible at all — colour supplements it, never replaces it.
  const cls = pct >= 25 ? "bg-emerald-50 text-emerald-700" : pct >= 12 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-800";
  return (
    <span className={cn("inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums", cls)}>
      {pct.toFixed(1)}%
    </span>
  );
}

// ─── Profit & Margin ─────────────────────────────────────────────
/**
 * What the pharmacy actually earned, as opposed to what it took.
 *
 * <p>Every invoice line already stores the batch cost at the moment of sale, so this is
 * exact rather than estimated — and until now nothing read it back. The Purchases tab
 * answers "what did I pay for stock"; this answers "did I make money selling it", which is
 * a different question and the one an owner asks first.
 */
function MarginSection({ from, to, active }: { from: string; to: string; active: boolean }) {
  const [data, setData]       = useState<MarginReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: MarginReport }>(
        `/reports/sales/margin?from=${isoFrom(f)}&to=${isoTo(t)}&limit=15`
      );
      setData(res.data.data);
      setError(null);
    } catch (e) {
      // A blank profit panel reads as "you made nothing", which is the single most
      // alarming thing this screen could say by accident.
      setError(getErrorMessage(e, "Could not load the profit figures."));
      setData(null);
    } finally { setLoading(false); }
  }, []);

  useVisibleLoad(active, `${from}|${to}`, () => load(from, to));

  function handleExport() {
    if (!data) return;
    // A batch sold below cost is in lossMakers AND, when the pharmacy has few enough
    // batches, near the bottom of topContributors — union by inventoryId so the workbook
    // lists each medicine once. topContributors first: it carries the friendlier ordering.
    const seen = new Set<string>();
    const rows = [...data.topContributors, ...data.lossMakers].filter(i => {
      if (seen.has(i.inventoryId)) return false;
      seen.add(i.inventoryId);
      return true;
    });
    downloadXlsx(`profit-${from}-to-${to}.xlsx`, [
      ["Medicine", "Batch", "Qty Sold", "Revenue (ex-GST)", "Cost", "Gross Profit", "Margin %"],
      ...rows.map(i => [
        i.medicine?.name ?? "Unknown", i.batchNumber ?? "", i.qtySold,
        i.revenueExGst, i.cogs, i.grossProfit, i.marginPct,
      ]),
    ], "Profit & Margin");
  }

  const hasReturns = !!data && (data.returns.refundExGst > 0 || data.returns.unitsReturned > 0);
  const partialCosting = !!data && data.dataQuality.linesMissingCost > 0;

  return (
    <Section
      title="Profit & Margin"
      icon={Banknote}
      iconBg="bg-emerald-50"
      iconColor="text-emerald-600"
      action={data && data.topContributors.length > 0 ? (
        <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
          <Download className="w-3 h-3" /> Excel
        </button>
      ) : undefined}
    >
      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <LoadErrorState title="Profit figures could not be loaded" message={error} onRetry={() => load(from, to)} compact />
      ) : !data || data.revenueExGst === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center text-slate-400">
          <Banknote className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
          <p className="text-[13px] font-medium text-slate-500">No costed sales in this period</p>
          <p className="text-[11px] text-slate-400 mt-1 max-w-md">
            Profit is worked out from the medicines on each bill and what that batch cost. Bills
            carried over from the previous system have no line items, so they cannot be costed.
          </p>
        </div>
      ) : (
        <div>
          <StatRow>
            <StatTile label="Net revenue" hint="after GST & discounts" value={fmtK(data.revenueExGst)} />
            <StatTile label="Cost of goods" hint="what that stock cost" value={fmtK(data.cogs)} />
            <StatTile
              label="Gross profit" hint="revenue − cost"
              value={fmtK(data.grossProfit)}
              tone={data.grossProfit >= 0 ? "good" : "bad"}
            />
            <StatTile
              label="Margin" hint={`${fmt(data.unitsSold)} units sold`}
              value={`${data.marginPct.toFixed(1)}%`}
              tone={data.marginPct >= 20 ? "good" : data.marginPct >= 10 ? "warn" : "bad"}
            />
          </StatRow>

          {/* Honesty about the denominator — a partially costed period must announce itself
              rather than quietly reporting an inflated margin. */}
          {partialCosting && (
            <div className="flex items-start gap-2 px-5 py-3 bg-amber-50/60 border-b border-amber-100">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
              <p className="text-[11px] text-amber-800 leading-relaxed">
                <span className="font-bold">Based on {data.dataQuality.costedRevenuePct.toFixed(0)}% of this period's sales.</span>{" "}
                {data.dataQuality.linesMissingCost} of {data.dataQuality.totalLines} lines
                ({fmtK(data.dataQuality.revenueMissingCost)}) have no purchase price recorded, so they
                count as revenue with no cost. The real margin is lower than shown.
              </p>
            </div>
          )}

          {hasReturns && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2.5 bg-slate-50/60 border-b border-slate-100 text-[11px]">
              <span className="font-bold text-slate-600">Returns in this period</span>
              <span className="text-slate-500">{data.returns.unitsReturned} units refunded · <span className="tabular-nums">{fmtK(data.returns.refundExGst)}</span></span>
              {data.returns.writtenOffCost > 0 && (
                <span className="text-red-600 font-semibold">
                  {fmtK(data.returns.writtenOffCost)} written off — refunded and the stock destroyed
                </span>
              )}
            </div>
          )}

          {/* Cut-strip selling folded in as one line, not a whole extra panel — it is a
              slice of the same revenue above, not a separate figure to reconcile. Absent
              entirely (not a zeroed bar) for the common case of a pharmacy that has never
              turned loose selling on. */}
          {data.looseSales && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2.5 bg-amber-50/60 border-b border-amber-100 text-[11px]">
              <span className="flex items-center gap-1 font-bold text-amber-700">
                <Scissors className="w-3 h-3" /> Loose sales
              </span>
              <span className="text-amber-700" title="Total individual units across every loose line — tablets, capsules, mL and grams counted together">
                {fmt(data.looseSales.piecesSold)} loose unit{data.looseSales.piecesSold === 1 ? "" : "s"} sold ·{" "}
                <span className="tabular-nums font-semibold">{fmtK(data.looseSales.revenueExGst)}</span>
              </span>
              <span className="text-amber-600">
                across {data.looseSales.billCount} bill{data.looseSales.billCount === 1 ? "" : "s"}
              </span>
            </div>
          )}

          {/* The worklist. Everything above is a number; this is something to do. */}
          {data.lossMakers.length > 0 && (
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-red-500" strokeWidth={2} />
                <h4 className="text-[12px] font-black text-slate-800">Sold below cost</h4>
                <span className="text-[10px] text-slate-400">
                  losing {fmtK(Math.abs(data.lossMakers.reduce((s, i) => s + i.grossProfit, 0)))} in this period
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-3">
                Usually a stale MRP, a scheme price entered as the purchase rate, or a discount stacked
                on an already-thin line. Check the batch's purchase rate and selling price before the
                next sale.
              </p>
              <div className="space-y-1.5">
                {data.lossMakers.map(item => (
                  <div key={item.inventoryId} className="flex items-center justify-between gap-3 bg-red-50/60 border border-red-100 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-slate-800 truncate">{item.medicine?.name ?? "Unknown"}</p>
                      <p className="text-[10px] text-slate-500">
                        {item.batchNumber ? `Batch ${item.batchNumber} · ` : ""}{item.qtySold} sold ·
                        cost {fmtK(item.cogs)} vs {fmtK(item.revenueExGst)} earned
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] font-black text-red-600 tabular-nums">{fmtK(item.grossProfit)}</p>
                      <p className="text-[10px] text-red-400 font-bold tabular-nums">{item.marginPct.toFixed(1)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Where the profit came from */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-5 py-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            <span>Top profit earners</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Profit</span>
            <span className="text-right">Margin</span>
          </div>
          <div className="divide-y divide-slate-50">
            {data.topContributors.map(item => (
              <div key={item.inventoryId} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center px-5 py-2.5 hover:bg-slate-50/50 transition-colors">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{item.medicine?.name ?? "Unknown"}</p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {item.medicine?.genericName ?? (item.batchNumber ? `Batch ${item.batchNumber}` : "")}
                  </p>
                </div>
                <p className="text-[13px] font-bold text-slate-700 tabular-nums text-right">{item.qtySold}</p>
                <p className={cn("text-[13px] font-bold tabular-nums text-right", item.grossProfit >= 0 ? "text-emerald-700" : "text-red-600")}>
                  {fmtK(item.grossProfit)}
                </p>
                <div className="flex justify-end"><MarginBadge pct={item.marginPct} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Tab: Sales ───────────────────────────────────────────────────
function SalesTab({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, isManagerUp, active }: {
  period: Period; setPeriod: (p: Period) => void;
  customFrom: string; setCustomFrom: (v: string) => void;
  customTo: string; setCustomTo: (v: string) => void;
  isManagerUp: boolean; active: boolean;
}) {
  const [chartDays,  setChartDays]  = useState<DailySalesPoint[]>([]);
  const [prevDays,   setPrevDays]   = useState<DailySalesPoint[] | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [fastItems, setFastItems]   = useState<FastMovingItem[]>([]);
  const [fastLoading, setFastLoading] = useState(false);
  const [fastError, setFastError]   = useState<string | null>(null);
  const [slowItems, setSlowItems]   = useState<FastMovingItem[]>([]);
  const [slowError, setSlowError]   = useState<string | null>(null);

  const { from, to } = getPeriodDates(period, customFrom, customTo);
  const bucket = bucketFor(from, to);

  // ONE request for the whole series. This used to fan out into seven parallel
  // /reports/sales/daily calls (one per day, two DB queries each) to draw a seven-point
  // line; the backend now groups by IST day — or month — and fills empty buckets itself.
  //
  // The chart used to hardcode seven days and fetch on mount with an empty dependency
  // array, so the period selector sitting directly above it did nothing to it at all.
  const [chartError, setChartError] = useState<string | null>(null);
  // Monotonic request id, not an effect-cleanup flag: the loader is now called from
  // useVisibleLoad rather than run directly by an effect, so there is no cleanup to hang a
  // `cancelled` closure on. Switching period twice quickly can still land the slower first
  // response after the faster second one, which would leave the chart showing a range nobody
  // asked for — so a response only writes state if it is still the newest request.
  const chartRequestId = useRef(0);
  const loadChart = useCallback((f: string, t: string, b: Bucket) => {
    const requestId = ++chartRequestId.current;
    const prev = previousRange(f, t);
    setChartLoading(true);
    // The comparison window is fetched alongside, not after: it is the same endpoint and
    // the two are useless apart. A failure on the comparison alone must not blank the
    // chart, so it resolves to null and the figures simply omit their deltas.
    Promise.all([
      api.get<{ success: boolean; data: DailySalesPoint[] }>(
        `/reports/sales/daily-series?from=${f}&to=${t}&groupBy=${b}`
      ),
      api.get<{ success: boolean; data: DailySalesPoint[] }>(
        `/reports/sales/daily-series?from=${prev.from}&to=${prev.to}&groupBy=${b}`
      ).catch(() => null),
    ])
      .then(([current, previous]) => {
        if (chartRequestId.current !== requestId) return;
        setChartDays(current.data.data ?? []);
        setPrevDays(previous ? previous.data.data ?? [] : null);
        setChartError(null);
      })
      .catch(e => {
        if (chartRequestId.current !== requestId) return;
        // An empty chart reads as "no sales this period" — a conclusion a pharmacist might
        // act on. Say it failed instead of silently drawing zeros.
        setChartError(getErrorMessage(e, "Could not load the sales trend."));
        setChartDays([]);
        setPrevDays(null);
      })
      .finally(() => { if (chartRequestId.current === requestId) setChartLoading(false); });
  }, []);

  useVisibleLoad(active, `chart|${from}|${to}|${bucket}`, () => loadChart(from, to, bucket));

  // Fast-moving — depends on selected period
  const loadFast = useCallback(async (f: string, t: string) => {
    setFastLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: { items: FastMovingItem[] } }>(
        `/reports/analytics/fast-moving?from=${isoFrom(f)}&to=${isoTo(t)}&limit=20`
      );
      setFastItems(res.data.data.items ?? []);
      setFastError(null);
    } catch (e) {
      // Lower stakes than the compliance registers, but the same misreading: an
      // empty "Fast Moving" panel reads as "nothing is selling", which is a
      // purchasing decision a pharmacist might actually act on.
      setFastError(getErrorMessage(e, "Could not load fast-moving items."));
      setFastItems([]);
    }
    finally { setFastLoading(false); }
  }, []);

  useVisibleLoad(active, `fast|${from}|${to}`, () => loadFast(from, to));

  // Slowest movers — sold in the period, but barely. A "do not reorder" list, complementary
  // to Dead Stock (which is "never sold at all"). An advisory, not a filed figure — a failure
  // is shown in its own card so the pharmacist knows the list is incomplete, not that
  // everything is moving fine.
  const loadSlow = useCallback(async (f: string, t: string) => {
    try {
      const res = await api.get<{ success: boolean; data: { items: FastMovingItem[] } }>(
        `/reports/analytics/slow-moving?from=${isoFrom(f)}&to=${isoTo(t)}&limit=20&minQty=1`
      );
      setSlowItems(res.data.data.items ?? []);
      setSlowError(null);
    } catch (e) {
      setSlowError(getErrorMessage(e, "The slow-mover list didn't load — treat the reorder guidance below as incomplete."));
      setSlowItems([]);
    }
  }, []);
  useVisibleLoad(active, `slow|${from}|${to}`, () => loadSlow(from, to));

  const slowMovers = useMemo(() => {
    const map = new Map<string, { name: string; qtySold: number; revenue: number }>();
    for (const item of slowItems) {
      const key = item.medicine?.id ?? item.inventoryId;
      const ex = map.get(key);
      if (ex) { ex.qtySold += item.qtySold; ex.revenue += item.revenue; }
      else map.set(key, { name: item.medicine?.name ?? "Unknown", qtySold: item.qtySold, revenue: item.revenue });
    }
    return Array.from(map.values()).sort((a, b) => a.qtySold - b.qtySold).slice(0, 8);
  }, [slowItems]);

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

  const chartTotals = useMemo(() => ({
    revenue: chartDays.reduce((s, d) => s + d.revenue, 0),
    bills:   chartDays.reduce((s, d) => s + d.invoiceCount, 0),
    gst:     chartDays.reduce((s, d) => s + d.gstCollected, 0),
  }), [chartDays]);

  const prevTotals = useMemo(() => prevDays && ({
    revenue: prevDays.reduce((s, d) => s + d.revenue, 0),
    bills:   prevDays.reduce((s, d) => s + d.invoiceCount, 0),
    gst:     prevDays.reduce((s, d) => s + d.gstCollected, 0),
  }), [prevDays]);

  const rangeLabel = period === "custom" ? `${fmtDate(from)} – ${fmtDate(to)}` : PERIOD_LABELS[period];

  function handleExport() {
    downloadXlsx("top-medicines.xlsx", [
      ["Medicine", "Generic", "Qty Sold", "Revenue"],
      ...topMedicines.map(m => [m.name, m.genericName ?? "", m.qtySold, m.revenue]),
    ], "Top Selling");
  }

  return (
    <div className="space-y-4">
      {/* One selector for the whole tab. It used to sit inside Top Selling Medicines and
          drive only that panel, while the chart above it silently ignored it. */}
      {/* Sticky: on a long report the selector scrolled out of reach, so changing period
          meant scrolling back to the top first. The page body is the scroll container, so
          top-0 anchors here rather than to the viewport. */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur rounded-2xl border border-slate-200 shadow-sm px-5 py-3">
        <PeriodSelector
          period={period} onChange={setPeriod}
          customFrom={customFrom} customTo={customTo}
          onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
        />
      </div>

      {/* Revenue trend. The hero is revenue — one display figure per view, with the
          comparison beside it, so the first thing read is the answer rather than a row of
          three equally-weighted chips that made the reader choose. */}
      <Section
        title="Revenue Trend"
        icon={BarChart3}
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
        action={
          <span className="text-[11px] text-slate-400 font-semibold">
            {rangeLabel}{bucket === "month" ? " · by month" : ""}
          </span>
        }
      >
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 mb-5">
            <HeroStat
              label="Revenue"
              value={chartLoading ? "—" : fmtK(chartTotals.revenue)}
              delta={!chartLoading && prevTotals ? <DeltaChip current={chartTotals.revenue} previous={prevTotals.revenue} /> : undefined}
              sub={!chartLoading && prevTotals
                ? `vs ${fmtK(prevTotals.revenue)} in the previous ${daysInRange(from, to)} ${daysInRange(from, to) === 1 ? "day" : "days"} (${fmtDate(previousRange(from, to).from)} – ${fmtDate(previousRange(from, to).to)})`
                : undefined}
            />
            <div className="flex items-start gap-8">
              {[
                { label: "Bills", value: String(chartTotals.bills), current: chartTotals.bills, previous: prevTotals?.bills },
                { label: "GST collected", value: fmtK(chartTotals.gst), current: chartTotals.gst, previous: prevTotals?.gst },
              ].map(({ label, value, current, previous }) => (
                <div key={label} className="min-w-0">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-[20px] leading-none font-black text-slate-700">{chartLoading ? "—" : value}</span>
                    {!chartLoading && previous !== undefined && <DeltaChip current={current} previous={previous} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {chartError ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-red-300" />
              <p className="text-[13px] text-red-500 font-medium">{chartError}</p>
              <p className="text-[11px] text-slate-400">This is a loading problem — it does not mean there were no sales.</p>
            </div>
          ) : (
            <RevenueChart days={chartDays} prev={prevDays} loading={chartLoading} bucket={bucket} />
          )}
        </div>
      </Section>

      {/* Profit — cost and margin are the pharmacy's commercial position, so this is
          manager-and-above only, matching the server gate on the endpoint. */}
      {isManagerUp && <MarginSection from={from} to={to} active={active} />}

      {/* Top medicines */}
      <Section
        title="Top Selling Medicines"
        icon={Flame}
        iconBg="bg-orange-50"
        iconColor="text-orange-500"
        action={topMedicines.length > 0 ? (
          <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
            <Download className="w-3 h-3" /> Excel
          </button>
        ) : undefined}
      >
        {fastLoading ? (
          <ListSkeleton rows={5} />
        ) : fastError ? (
          <LoadErrorState
            title="Fast-moving items could not be loaded"
            message={fastError}
            onRetry={() => loadFast(from, to)}
            compact
          />
        ) : topMedicines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center text-slate-400">
            <Flame className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
            {/* "No sales in this period" directly under a chart showing revenue and bills
                for that same period is a flat contradiction, and the pharmacist is right to
                distrust it. This panel is built from invoice LINE ITEMS, and bills carried
                over from the previous system have none — only their totals came across. So
                say which of the two it is instead of leaving them to guess. */}
            {chartTotals.bills > 0 ? (
              <>
                <p className="text-[13px] font-medium text-slate-500">No medicine-level detail for this period</p>
                <p className="text-[11px] text-slate-400 mt-1 max-w-md">
                  The {chartTotals.bills} bills above came from the previous system, which carried over
                  totals only — not the individual medicines on each bill. Bills raised in this app
                  appear here normally.
                </p>
              </>
            ) : (
              <p className="text-[13px] font-medium">No sales in this period</p>
            )}
          </div>
        ) : (
          <div>
            <div className="px-5 py-4 border-b border-slate-100">
              <HBars
                data={[...topMedicines].sort((a, b) => b.revenue - a.revenue).slice(0, 8)
                  .map(m => ({ label: m.name, value: m.revenue }))}
                height={210} color={CHARTC.revenue} valueFormatter={inrCompact}
              />
            </div>
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

      {/* Slowest movers — sold, but barely. The reorder list to leave alone. */}
      {(slowMovers.length > 0 || slowError) && (
        <Section title="Slowest Movers" icon={TrendingDown} iconBg="bg-slate-100" iconColor="text-slate-500"
          action={<span className="text-[11px] text-slate-400 font-semibold">{rangeLabel} · fewest units first</span>}>
          <div className="px-5 py-4">
            {slowError ? (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-[11px] text-amber-900 leading-relaxed">{slowError}</p>
              </div>
            ) : (
              <>
                <HBars
                  data={slowMovers.map(m => ({ label: m.name, value: m.qtySold }))}
                  height={Math.min(slowMovers.length, 8) * 26 + 20}
                  color={CHARTC.cost} valueFormatter={(v) => `${v} sold`}
                />
                <p className="text-[10px] text-slate-400 mt-1">These sell slowly — hold off on reordering, and check them against Dead Stock and Expiry.</p>
              </>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Tab: Customers ───────────────────────────────────────────────
/**
 * Who is buying, and who has stopped.
 *
 * <p>The only sales analytic on this screen that works across the migrated history: it
 * reads invoice headers, and the missing line items that blank out every medicine-level
 * panel are not needed here.
 *
 * <p>Two halves that answer different questions, so they are fetched separately. The top
 * half follows the period selector. The lapsed list deliberately does NOT — "hasn't been
 * in for 90 days" is a fact about today, and scoping it to a reporting window would produce
 * the nonsense of someone being lapsed in March and not in April.
 */
// ─── Customers: visual dashboard ────────────────────────────────
/**
 * Who is buying (new vs returning), who spends the most, and — the one that pays for
 * itself — the lifetime value sitting in regulars who have stopped coming.
 */
function CustomersCharts({ insights, lapsed, lapsedError, trend, trendError, onRetryTrend, onExport }: {
  insights: CustomerInsights | null; lapsed: LapsedReport | null; lapsedError: string | null;
  trend: { month: string; billed: number; newCount: number; returning: number }[];
  trendError: string | null; onRetryTrend: () => void;
  onExport: () => void;
}) {
  const mix = useMemo(() => {
    if (!insights) return [];
    return [
      { name: "Returning", value: num(insights.returningCustomers), color: CHARTC.revenue },
      { name: "New", value: num(insights.newCustomers), color: CHARTC.customer },
    ].filter(s => s.value > 0);
  }, [insights]);
  const topCustomers = useMemo(
    () => (insights?.topCustomers ?? []).slice(0, 8).map(c => ({ label: c.name || "Unnamed", value: num(c.revenue) })),
    [insights],
  );
  const lapsedValue = useMemo(
    () => (lapsed?.items ?? []).slice(0, 8).map(c => ({ label: c.name || "Unnamed", value: num(c.lifetimeRevenue) })),
    [lapsed],
  );
  if (!insights) return null;
  return (
   <div className="space-y-4">
    {(trendError || (trend.length > 0 && trend.some(m => m.billed > 0))) && (
      <ChartCard title="Customer base — last 12 months"
        subtitle="Identified customers billed each month, first-timers vs regulars" height={210}
        error={trendError} onRetry={onRetryTrend}>
        <StackedBars
          data={trend.map(m => ({
            label: new Date(`${m.month}-01T12:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
            Returning: m.returning, New: m.newCount,
          }))}
          series={[
            { key: "Returning", name: "Returning", color: CHARTC.revenue },
            { key: "New", name: "New", color: CHARTC.customer },
          ]}
          height={190} currency={false}
        />
      </ChartCard>
    )}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <ChartCard title="New vs returning" subtitle={`${insights.repeatRatePct.toFixed(0)}% repeat rate · ${insights.walkIns.bills} walk-in bills`} height={230}>
        {mix.length === 0 ? <ChartsEmpty msg="No named customers this period" />
          : <>
              <Donut data={mix} height={160}
                centerValue={`${insights.repeatRatePct.toFixed(0)}%`} centerLabel="Repeat" />
              <LegendRow items={mix.map(s => ({ label: s.name, color: s.color, value: String(s.value) }))} />
            </>}
      </ChartCard>
      <ChartCard title="Your best customers" subtitle="By spend, this period" height={230}>
        {topCustomers.length === 0 ? <ChartsEmpty msg="No named customers this period" />
          : <HBars data={topCustomers} height={210} color={CHARTC.customer} valueFormatter={inrCompact} />}
      </ChartCard>
      <ChartCard title="Lifetime value drifting away"
        subtitle="Regulars gone 90+ days — a call usually works"
        height={230}
        error={lapsedError}
        empty={!lapsedError && lapsedValue.length === 0 ? "No regulars have gone quiet" : null}
        right={lapsedValue.length > 0 ? (
          <button onClick={onExport} className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1">
            <PhoneCall className="w-3 h-3" /> Call list
          </button>
        ) : undefined}>
        <HBars data={lapsedValue} height={210} color={CHARTC.risk} valueFormatter={inrCompact} />
      </ChartCard>
    </div>
   </div>
  );
}

function CustomersTab({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, active }: {
  period: Period; setPeriod: (p: Period) => void;
  customFrom: string; setCustomFrom: (v: string) => void;
  customTo: string; setCustomTo: (v: string) => void;
  active: boolean;
}) {
  const [insights, setInsights] = useState<CustomerInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const [lapsed, setLapsed] = useState<LapsedReport | null>(null);
  const [lapsedLoading, setLapsedLoading] = useState(true);
  const [lapsedError, setLapsedError] = useState<string | null>(null);
  const [inactiveDays, setInactiveDays] = useState(90);
  // 12-month new-vs-returning trend — window-independent, loaded once.
  const [trend, setTrend] = useState<{ month: string; billed: number; newCount: number; returning: number }[]>([]);
  const [trendError, setTrendError] = useState<string | null>(null);
  const loadTrend = useCallback(() => {
    api.get<{ success: boolean; data: { months: typeof trend } }>("/reports/customers/trend?months=12")
      .then(r => { setTrend(r.data.data.months ?? []); setTrendError(null); })
      .catch(e => setTrendError(getErrorMessage(e, "The 12-month customer trend didn't load.")));
  }, []);
  useEffect(() => { loadTrend(); }, [loadTrend]);

  const { from, to } = getPeriodDates(period, customFrom, customTo);

  const loadInsights = useCallback(async (f: string, t: string) => {
    setInsightsLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: CustomerInsights }>(
        `/reports/customers?from=${isoFrom(f)}&to=${isoTo(t)}&limit=15`
      );
      setInsights(res.data.data);
      setInsightsError(null);
    } catch (e) {
      setInsightsError(getErrorMessage(e, "Could not load customer figures."));
      setInsights(null);
    } finally { setInsightsLoading(false); }
  }, []);

  const loadLapsed = useCallback(async (days: number) => {
    setLapsedLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: LapsedReport }>(
        `/reports/customers/lapsed?inactiveDays=${days}&minVisits=2&limit=100`
      );
      setLapsed(res.data.data);
      setLapsedError(null);
    } catch (e) {
      // An empty call list reads as "nobody has drifted away" — the most reassuring
      // thing this panel could say by accident.
      setLapsedError(getErrorMessage(e, "Could not load the lapsed customer list."));
      setLapsed(null);
    } finally { setLapsedLoading(false); }
  }, []);

  useVisibleLoad(active, `insights|${from}|${to}`, () => loadInsights(from, to));
  useVisibleLoad(active, `lapsed|${inactiveDays}`, () => loadLapsed(inactiveDays));

  function exportTop() {
    if (!insights) return;
    downloadXlsx(`top-customers-${from}-to-${to}.xlsx`, [
      ["Customer", "Phone", "Bills", "Revenue", "Last Visit"],
      ...insights.topCustomers.map(c => [
        // Phone deliberately stays text: as a number it loses any leading zero and renders
        // in scientific notation, which makes a call list undiallable.
        c.name, c.phone ?? "", c.bills, c.revenue, fmtDate(c.lastVisit),
      ]),
    ], "Top Customers");
  }

  function exportLapsed() {
    if (!lapsed) return;
    // The point of this panel: a file someone can work through with a phone.
    downloadXlsx(`lapsed-customers-${inactiveDays}d.xlsx`, [
      ["Customer", "Phone", "Last Visit", "Days Since", "Total Bills", "Lifetime Value"],
      ...lapsed.items.map(c => [
        c.name, c.phone ?? "", fmtDate(c.lastVisit), c.daysSinceLastVisit,
        c.totalBills, c.lifetimeRevenue,
      ]),
    ], "Lapsed Customers");
  }

  return (
    <div className="space-y-4">
      {/* Sticky: on a long report the selector scrolled out of reach, so changing period
          meant scrolling back to the top first. The page body is the scroll container, so
          top-0 anchors here rather than to the viewport. */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur rounded-2xl border border-slate-200 shadow-sm px-5 py-3">
        <PeriodSelector
          period={period} onChange={setPeriod}
          customFrom={customFrom} customTo={customTo}
          onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
        />
      </div>

      {!insightsLoading && !insightsError && (
        <CustomersCharts
          insights={insights} lapsed={lapsed} lapsedError={lapsedError}
          trend={trend} trendError={trendError} onRetryTrend={loadTrend}
          onExport={exportLapsed}
        />
      )}

      {/* Period half */}
      <Section
        title="Customers in This Period"
        icon={Users}
        iconBg="bg-violet-50"
        iconColor="text-violet-600"
        action={insights && insights.topCustomers.length > 0 ? (
          <button onClick={exportTop} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
            <Download className="w-3 h-3" /> Excel
          </button>
        ) : undefined}
      >
        {insightsLoading ? (
          <ListSkeleton rows={4} />
        ) : insightsError ? (
          <LoadErrorState title="Customer figures could not be loaded" message={insightsError} onRetry={() => loadInsights(from, to)} compact />
        ) : !insights ? null : (
          <div>
            <StatRow>
              <StatTile label="Customers billed" hint="with a record attached" value={fmt(insights.customersBilled)} />
              <StatTile label="New" hint="first ever purchase" value={fmt(insights.newCustomers)} tone="accent" />
              <StatTile label="Returning" hint="bought here before" value={fmt(insights.returningCustomers)} tone="good" />
              <StatTile
                label="Repeat rate" hint="returning ÷ billed"
                value={`${insights.repeatRatePct.toFixed(1)}%`}
                tone={insights.repeatRatePct >= 40 ? "good" : "warn"}
              />
            </StatRow>

            {/* Every figure above counts identified customers only. Without this line a
                pharmacy billing mostly anonymously would read as having almost no
                customers, and the number would look wrong rather than incomplete. */}
            {insights.walkIns.bills > 0 && (
              <div className="flex items-start gap-2 px-5 py-3 bg-slate-50/70 border-b border-slate-100">
                <Users className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  <span className="font-bold">{insights.walkIns.bills} bills ({insights.walkIns.sharePct.toFixed(0)}%) had no customer attached.</span>{" "}
                  Those are counted nowhere above. Attaching a name and number at the till is what
                  turns them into the follow-up list below.
                </p>
              </div>
            )}

            {insights.topCustomers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Users className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
                <p className="text-[13px] font-medium">No named customers billed in this period</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-5 py-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  <span>Top customers</span>
                  <span className="text-right">Bills</span>
                  <span className="text-right">Spent</span>
                  <span className="text-right">Last visit</span>
                </div>
                <div className="divide-y divide-slate-50">
                  {insights.topCustomers.map(c => (
                    <div key={c.customerId} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center px-5 py-2.5 hover:bg-slate-50/50 transition-colors">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</p>
                        {c.phone && <p className="text-[10px] text-slate-400 tabular-nums">{c.phone}</p>}
                      </div>
                      <p className="text-[13px] font-bold text-slate-700 tabular-nums text-right">{c.bills}</p>
                      <p className="text-[13px] font-bold text-slate-700 tabular-nums text-right">{fmtK(c.revenue)}</p>
                      <p className="text-[11px] text-slate-500 tabular-nums text-right">{fmtDate(c.lastVisit)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Section>

      {/* The call list */}
      <Section
        title="Customers Who Stopped Coming"
        icon={PhoneCall}
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
        action={lapsed && lapsed.items.length > 0 ? (
          <button onClick={exportLapsed} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
            <Download className="w-3 h-3" /> Call list
          </button>
        ) : undefined}
      >
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/40">
          <span className="text-[11px] font-semibold text-slate-500">No visit in</span>
          {[60, 90, 180].map(d => (
            <button
              key={d}
              onClick={() => setInactiveDays(d)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all",
                inactiveDays === d ? "bg-amber-500 text-white shadow-sm" : "bg-white border border-slate-200 text-slate-600 hover:border-amber-300"
              )}
            >
              {d} days
            </button>
          ))}
          {/* Says out loud that this panel ignores the selector above it, so nobody
              reads it as "lapsed during March". */}
          <span className="text-[10px] text-slate-400 ml-1">counted from today, not the period above</span>
        </div>

        {lapsedLoading ? (
          <ListSkeleton rows={5} />
        ) : lapsedError ? (
          <LoadErrorState title="The lapsed customer list could not be loaded" message={lapsedError} onRetry={() => loadLapsed(inactiveDays)} compact />
        ) : !lapsed || lapsed.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-200 mb-2" strokeWidth={1.4} />
            <p className="text-[13px] font-medium text-slate-500">No regulars have gone quiet</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-md">
              Everyone who has bought here at least twice has been in within the last {inactiveDays} days.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 bg-amber-50/50 border-b border-amber-100">
              <p className="text-[11px] text-amber-900 leading-relaxed">
                <span className="font-bold">{lapsed.items.length} regular customers</span> worth{" "}
                <span className="font-bold tabular-nums">{fmtK(lapsed.valueAtRisk)}</span> in past business
                have not been in for {inactiveDays} days. Mostly repeat-medicine patients who went elsewhere —
                a call is usually enough to get them back.
              </p>
            </div>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-5 py-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              <span>Customer</span>
              <span className="text-right">Last visit</span>
              <span className="text-right">Bills</span>
              <span className="text-right">Lifetime value</span>
            </div>
            <div className="divide-y divide-slate-50">
              {lapsed.items.map(c => (
                <div key={c.customerId} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center px-5 py-2.5 hover:bg-slate-50/50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</p>
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} className="text-[11px] text-blue-600 hover:underline tabular-nums font-medium">
                        {c.phone}
                      </a>
                    ) : (
                      <p className="text-[10px] text-slate-300 italic">no phone on file</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-[12px] text-slate-600 tabular-nums">{fmtDate(c.lastVisit)}</p>
                    <p className="text-[10px] text-amber-600 font-semibold tabular-nums">{c.daysSinceLastVisit} days ago</p>
                  </div>
                  <p className="text-[13px] font-bold text-slate-700 tabular-nums text-right">{c.totalBills}</p>
                  <p className="text-[13px] font-bold text-slate-700 tabular-nums text-right">{fmtK(c.lifetimeRevenue)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Inventory: visual dashboard ─────────────────────────────────
/**
 * The three questions an owner asks about stock, as pictures: where is my capital
 * (value by category), what is about to be worthless (expiry runway), and what is
 * already frozen (dead stock). Everything below is the same data as a working list.
 */
function InventoryCharts({
  valItems, expiryItems, deadItems,
  valLoading, expiryLoading, deadLoading,
  valError, expiryError, deadError,
  onRetryValuation, onRetryExpiry, onRetryDead,
}: {
  valItems: ValuationItem[]; expiryItems: ExpiryItem[]; deadItems: DeadStockItem[];
  valLoading: boolean; expiryLoading: boolean; deadLoading: boolean;
  valError: string | null; expiryError: string | null; deadError: string | null;
  onRetryValuation: () => void; onRetryExpiry: () => void; onRetryDead: () => void;
}) {
  const byCategory = useMemo(() => {
    const sorted = [...(valItems ?? [])].sort((a, b) => num(b.costValue) - num(a.costValue));
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7).reduce((s, v) => s + num(v.costValue), 0);
    const rows = top.map((v, i) => ({ name: v.key || "Uncategorised", value: num(v.costValue), color: SERIES[i % SERIES.length] ?? "#cbd5e1" }));
    if (rest > 0) rows.push({ name: "Other", value: rest, color: "#cbd5e1" });
    return rows;
  }, [valItems]);
  const totalCost = (valItems ?? []).reduce((s, v) => s + num(v.costValue), 0);

  const atRisk = useMemo(() => {
    const val = (i: ExpiryItem) => num(i.mrp) * (num(i.quantity) + (num(i.looseUnits) > 0 ? 1 : 0));
    const g = { expired: 0, m30: 0, m90: 0 };
    for (const i of expiryItems ?? []) {
      const d = daysUntil(i.expiryDate);
      if (Number.isNaN(d)) continue;
      if (d <= 0) g.expired += val(i);
      else if (d <= 30) g.m30 += val(i);
      else g.m90 += val(i);
    }
    return [
      { label: "Already expired", value: g.expired },
      { label: "Within 30 days", value: g.m30 },
      { label: "31–90 days", value: g.m90 },
    ].filter(r => r.value > 0);
  }, [expiryItems]);

  const deadTop = useMemo(
    () => [...(deadItems ?? [])].sort((a, b) => num(b.costAtRisk) - num(a.costAtRisk)).slice(0, 6)
      .map(d => ({ label: d.medicine?.name ?? "Unknown", value: num(d.costAtRisk) })),
    [deadItems],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <ChartCard title="Where your capital sits" subtitle="Stock at cost, by category" height={230}
        loading={valLoading} error={valError} onRetry={onRetryValuation}
        empty={!valLoading && !valError && byCategory.length === 0 ? "No stock on hand" : null}>
        <Donut data={byCategory} height={160} centerValue={inrCompact(totalCost)} centerLabel="At cost" />
        <LegendRow items={byCategory.slice(0, 5).map(c => ({ label: c.name, color: c.color, value: inrCompact(c.value) }))} />
      </ChartCard>

      <ChartCard title="Value about to be lost" subtitle="Stock at MRP, by expiry window" height={230}
        loading={expiryLoading} error={expiryError} onRetry={onRetryExpiry}
        empty={!expiryLoading && !expiryError && atRisk.length === 0 ? "Nothing expiring within 90 days" : null}>
        <HBars data={atRisk} height={170} color={CHARTC.risk} valueFormatter={inrCompact} />
      </ChartCard>

      <ChartCard title="Capital frozen in dead stock" subtitle="Biggest non-movers, at cost" height={230}
        loading={deadLoading} error={deadError} onRetry={onRetryDead}
        empty={!deadLoading && !deadError && deadTop.length === 0 ? "No dead stock" : null}>
        <HBars data={deadTop} height={170} color={CHARTC.loss} valueFormatter={inrCompact} />
      </ChartCard>
    </div>
  );
}

function ChartsEmpty({ msg }: { msg: string }) {
  return <div className="w-full h-full flex items-center justify-center text-[12px] text-slate-400">{msg}</div>;
}

// ─── Tab: Inventory ───────────────────────────────────────────────
function InventoryTab() {
  const [expiryItems, setExpiryItems]   = useState<ExpiryItem[]>([]);
  const [expiryLoading, setExpiryLoad]  = useState(true);
  const [expiryError, setExpiryError]   = useState<string | null>(null);
  const [deadItems, setDeadItems]       = useState<DeadStockItem[]>([]);
  const [deadLoading, setDeadLoad]      = useState(true);
  const [deadError, setDeadError]       = useState<string | null>(null);
  const [valItems, setValItems]         = useState<ValuationItem[]>([]);
  const [valLoading, setValLoad]        = useState(true);
  const [valError, setValError]         = useState<string | null>(null);
  const [deadDays, setDeadDays]         = useState(90);

  // Write-off is OWNER-only, matching the server gate. Read once: the role cannot change
  // without a re-login, and re-reading localStorage on every render buys nothing.
  const role = useRef(getStoredUser()?.role ?? "CASHIER").current;
  const [writeOffOpen, setWriteOffOpen]       = useState(false);
  const [writeOffReason, setWriteOffReason]   = useState("");
  const [writeOffBusy, setWriteOffBusy]       = useState(false);
  const [writeOffError, setWriteOffError]     = useState<string | null>(null);
  const [writeOffDone, setWriteOffDone] =
    useState<{ batchesWrittenOff: number; unitsWrittenOff: number; looseUnitsWrittenOff: number;
      unpriceableLooseBatches: number; costWrittenOff: number; itcToReverse: number } | null>(null);

  const loadExpiry = useCallback(async () => {
    setExpiryLoad(true);
    try {
      const r = await api.get<{ success: boolean; data: ExpiryItem[] }>("/reports/expiry");
      setExpiryItems(r.data.data ?? []);
      setExpiryError(null);
    } catch (e) {
      // An empty expiry list reads as "nothing is expiring soon" — a conclusion a
      // pharmacist may act on. A failure has to look like a failure.
      setExpiryError(getErrorMessage(e, "Could not load expiring stock."));
      setExpiryItems([]);
    } finally { setExpiryLoad(false); }
  }, []);

  const loadValuation = useCallback(async () => {
    setValLoad(true);
    try {
      const r = await api.get<{ success: boolean; data: { items: ValuationItem[]; totalCostValue: number; totalRetailValue: number } }>(
        "/reports/inventory/valuation?groupBy=category");
      setValItems(r.data.data.items ?? []);
      setValError(null);
    } catch (e) {
      // An empty valuation reads as "no stock on hand" — a conclusion a pharmacist may act on.
      setValError(getErrorMessage(e, "Could not load stock valuation."));
      setValItems([]);
    } finally { setValLoad(false); }
  }, []);

  useEffect(() => {
    loadExpiry();
    loadValuation();
  }, [loadExpiry, loadValuation]);

  const loadDead = useCallback(async (days: number) => {
    setDeadLoad(true);
    try {
      const r = await api.get<{ success: boolean; data: { items: DeadStockItem[]; totalCostAtRisk: number } }>(`/reports/analytics/dead-stock?days=${days}`);
      setDeadItems(r.data.data.items ?? []);
      setDeadError(null);
    } catch (e) {
      // An empty dead-stock panel reads as "no capital tied up in dead stock" —
      // the opposite of the truth if the request simply failed.
      setDeadError(getErrorMessage(e, "Could not load dead stock."));
      setDeadItems([]);
    }
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
    downloadXlsx("expiry-report.xlsx", [
      ["Medicine","Batch","Expiry Date","Days Left","Qty (packs)","Loose","MRP"],
      ...expiryItems.map(i => [i.medicine.name, i.batchNumber, i.expiryDate.slice(0,10), daysUntil(i.expiryDate), i.quantity, i.looseUnits, i.mrp]),
    ], "Expiring Stock");
  }

  /**
   * Writes every expired batch off the books.
   *
   * <p>Sends the ids explicitly rather than asking the server to "write off everything expired":
   * the list on screen is what the pharmacist looked at and agreed to, and a filter evaluated
   * server-side a second later could include a batch that expired in between. Only batches with
   * stock left are sent — an empty expired batch is already off the books.
   */
  async function writeOffExpired() {
    const ids = expired.filter(i => i.quantity > 0 || i.looseUnits > 0).map(i => i.id);
    if (ids.length === 0) return;
    setWriteOffBusy(true);
    setWriteOffError(null);
    try {
      const r = await api.post<{ success: boolean; data: typeof writeOffDone }>(
        "/inventory/write-off-expired", { inventoryIds: ids, reason: writeOffReason.trim() });
      setWriteOffDone(r.data.data);
      setWriteOffOpen(false);
      setWriteOffReason("");
      // Refresh EVERY panel that valued the destroyed stock, not just the expiry list.
      // Dead Stock and Stock Valuation both exclude non-ACTIVE batches server-side, so
      // they are correct on refetch — but they load once on mount, so without this they
      // kept showing the written-off batch at full cost until a page reload. Reading
      // "₹1,000 cost at risk" for stock you just destroyed reads as a failed write-off.
      await Promise.all([loadExpiry(), loadDead(deadDays), loadValuation()]);
    } catch (e) {
      setWriteOffError(getErrorMessage(e, "Could not write off the expired stock."));
    } finally { setWriteOffBusy(false); }
  }

  // A batch cut down to nothing but a loose remainder is still real stock to write off —
  // see the `expired` filter above and the matching `writeOffExpired` id list.
  const expiredWithStock = expiryItems.filter(i => daysUntil(i.expiryDate) <= 0 && (i.quantity > 0 || i.looseUnits > 0));
  const canWriteOff = role === "OWNER" && expiredWithStock.length > 0;
  function deadExport() {
    downloadXlsx("dead-stock.xlsx", [
      ["Medicine","Batch","Last Sale","Qty (packs)","Loose","Cost at Risk","Retail Value"],
      ...deadItems.map(i => [i.medicine.name, i.batchNumber, i.lastSaleDate ? i.lastSaleDate.slice(0,10) : "Never", i.quantity, i.looseUnits, i.costAtRisk, i.retailValue]),
    ], "Dead Stock");
  }

  return (
    <div className="space-y-4">

      <InventoryCharts
        valItems={valItems} expiryItems={expiryItems} deadItems={deadItems}
        valLoading={valLoading} expiryLoading={expiryLoading} deadLoading={deadLoading}
        valError={valError} expiryError={expiryError} deadError={deadError}
        onRetryValuation={loadValuation} onRetryExpiry={loadExpiry} onRetryDead={() => loadDead(deadDays)}
      />

      {/* Expiry Alerts */}
      <Section
        title="Expiry Alerts"
        icon={AlertTriangle}
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
        action={expiryItems.length > 0 ? (
          <div className="flex items-center gap-2">
            {canWriteOff && (
              <button onClick={() => { setWriteOffOpen(true); setWriteOffDone(null); setWriteOffError(null); }}
                className="flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700 border border-red-200 rounded-lg px-2 py-1.5 hover:bg-red-50 transition-colors">
                <Archive className="w-3 h-3" /> Write off {expiredWithStock.length} expired
              </button>
            )}
            <button onClick={expiryExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
              <Download className="w-3 h-3" /> Excel
            </button>
          </div>
        ) : undefined}
      >
        {/* Confirmation is inline and requires typing a reason. This destroys stock value and
            cannot be undone, so it must not be one stray click — and the reason becomes the
            audit record a Drug Inspector reads. */}
        {writeOffOpen && (
          <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3.5">
            <p className="text-[12px] font-black text-red-900 mb-1">
              Write off {expiredWithStock.length} expired batch{expiredWithStock.length === 1 ? "" : "es"}?
            </p>
            <p className="text-[11px] text-red-800 leading-relaxed mb-2.5">
              Their stock goes to zero and they are marked EXPIRED permanently. This cannot be undone.
              The input tax credit claimed on them becomes reversible under section 17(5)(h) and will
              appear in GSTR-3B Table 4(B)(1) for this period.
            </p>
            <input
              value={writeOffReason}
              onChange={e => setWriteOffReason(e.target.value)}
              placeholder="Reason (required) — e.g. Destroyed as per expiry disposal, Aug 2026"
              maxLength={500}
              className="w-full px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-[12px] mb-2.5 focus:outline-none focus:ring-2 focus:ring-red-400/30"
            />
            {writeOffError && <p className="text-[11px] text-red-700 font-semibold mb-2">{writeOffError}</p>}
            <div className="flex items-center gap-2">
              <button onClick={writeOffExpired} disabled={writeOffBusy || writeOffReason.trim().length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12px] font-bold transition-colors">
                {writeOffBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Write off permanently
              </button>
              <button onClick={() => { setWriteOffOpen(false); setWriteOffError(null); }} disabled={writeOffBusy}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
        {writeOffDone && (
          <div className="mx-5 mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
            <p className="text-[12px] text-emerald-900 leading-relaxed">
              <span className="font-bold">
                Wrote off {writeOffDone.batchesWrittenOff} batch
                {writeOffDone.batchesWrittenOff === 1 ? "" : "es"} ({writeOffDone.unitsWrittenOff} pack
                {writeOffDone.unitsWrittenOff === 1 ? "" : "s"}
                {writeOffDone.looseUnitsWrittenOff > 0
                  && ` + ${writeOffDone.looseUnitsWrittenOff} loose unit${writeOffDone.looseUnitsWrittenOff === 1 ? "" : "s"}`},
                ₹{fmt(writeOffDone.costWrittenOff)} at cost).
              </span>{" "}
              Reverse <span className="font-bold">₹{fmt(writeOffDone.itcToReverse)}</span> of input tax credit
              in GSTR-3B Table 4(B)(1) for this period — it is on the GSTR-3B tab now.
            </p>
            {writeOffDone.unpriceableLooseBatches > 0 && (
              <p className="text-[11px] text-amber-700 font-semibold mt-1.5 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                {writeOffDone.unpriceableLooseBatches} batch{writeOffDone.unpriceableLooseBatches === 1 ? "" : "es"} had a
                loose remainder with no pack size on record — its cost and ITC above are understated. Set the
                medicine&apos;s pack size to fix this going forward.
              </p>
            )}
          </div>
        )}
        {expiryLoading ? (
          <ListSkeleton rows={5} />
        ) : expiryError ? (
          // Never fall through to the reassuring "nothing expiring" empty state on a
          // failure — that is the one message that must be earned by a real answer.
          <LoadErrorState
            title="Expiring stock could not be loaded"
            message={expiryError}
            onRetry={loadExpiry}
            compact
          />
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
                    <p className="text-[12px] text-slate-700 text-right">
                      {item.quantity}
                      <LooseTag units={item.looseUnits} />
                    </p>
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
                <Download className="w-3 h-3" /> Excel
              </button>
            )}
          </div>
        }
      >
        {deadLoading ? (
          <ListSkeleton rows={5} />
        ) : deadError ? (
          <LoadErrorState
            title="Dead stock could not be loaded"
            message={deadError}
            onRetry={() => loadDead(deadDays)}
            compact
          />
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
                  <p className="text-[12px] text-slate-700 text-right">
                    {item.quantity}
                    <LooseTag units={item.looseUnits} />
                  </p>
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
          <ListSkeleton rows={5} />
        ) : valError ? (
          <LoadErrorState
            title="Stock valuation could not be loaded"
            message={valError}
            onRetry={loadValuation}
            compact
          />
        ) : (
          <div>
            {/* Summary bar */}
            <StatRow cols={3}>
              <StatTile label="Stock at cost" value={fmtK(totalCost)} />
              <StatTile label="Retail value" value={fmtK(totalRetail)} tone="accent" />
              <StatTile label="Potential profit" value={fmtK(totalProfit)} tone="good" />
            </StatRow>
            <div className="px-5 py-4 border-b border-slate-100 space-y-3 bg-slate-50/40">
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

// ─── Purchases: visual dashboard ────────────────────────────────
/**
 * Two pictures that turn a cost table into a negotiating position: where the money
 * goes (top spend), and where it goes with the least to show for it (thin margins on
 * high spend — the lines worth a call to the distributor).
 */
function PurchasesCharts({ items }: { items: CostAnalysisItem[] }) {
  const byCost = useMemo(
    () => [...(items ?? [])].sort((a, b) => num(b.totalCost) - num(a.totalCost)),
    [items],
  );
  const topSpend = useMemo(
    () => byCost.slice(0, 8).map(i => ({ label: i.medicineName || "Unknown", value: num(i.totalCost) })),
    [byCost],
  );
  const thinMargins = useMemo(
    () => byCost.slice(0, 12).sort((a, b) => num(a.marginPct) - num(b.marginPct)).slice(0, 8)
      .map(i => ({ label: i.medicineName || "Unknown", value: num(i.marginPct) })),
    [byCost],
  );
  if (!items || items.length === 0) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-5 py-4 border-b border-slate-100 bg-slate-50/30">
      <ChartCard title="Where the money goes" subtitle="Top medicines by spend, this period" height={220} className="border-slate-100">
        <HBars data={topSpend} height={200} color={CHARTC.cost} valueFormatter={inrCompact} />
      </ChartCard>
      <ChartCard title="Thinnest margins on your biggest buys" subtitle="Lowest MRP-vs-cost gap among top spend — worth a call" height={220} className="border-slate-100">
        <HBars data={thinMargins} height={200} color={CHARTC.risk} valueFormatter={(v) => `${num(v).toFixed(1)}%`} />
      </ChartCard>
    </div>
  );
}

// ─── Tab: Purchases ───────────────────────────────────────────────
function PurchasesTab({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, active }: {
  period: Period; setPeriod: (p: Period) => void;
  customFrom: string; setCustomFrom: (v: string) => void;
  customTo: string; setCustomTo: (v: string) => void;
  active: boolean;
}) {
  const [items, setItems]           = useState<CostAnalysisItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [sortKey, setSortKey]       = useState<"cost" | "margin" | "qty">("cost");
  // A failed load must not render as "no purchase data". Swallowing the error and
  // showing an empty state asserts as fact that this pharmacy bought nothing in the
  // period — the same failure the compliance registers were hardened against.
  const [error, setError]           = useState<string | null>(null);

  const { from, to } = getPeriodDates(period, customFrom, customTo);

  const [summary, setSummary] = useState<{ totalCost: number; totalMRPValue: number; overallMarginPct: number } | null>(null);

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    try {
      const r = await api.get<{ success: boolean; data: { items: CostAnalysisItem[]; summary: { totalCost: number; totalMRPValue: number; overallMarginPct: number } } }>(
        `/reports/purchases/cost-analysis?from=${isoFrom(f)}&to=${isoTo(t)}&limit=50`
      );
      setItems(r.data.data.items ?? []);
      setSummary(r.data.data.summary ?? null);
      // Clear any earlier failure — without this a transient error stuck on screen and the
      // Retry button refetched successfully but the error panel never went away.
      setError(null);
    } catch (e) {
      // getErrorMessage keeps the server's wording — an inverted date range now comes
      // back naming both dates, which is more use than a generic failure string.
      setError(getErrorMessage(e, "Could not load the purchase cost analysis."));
      setItems([]);
      setSummary(null);
    }
    finally { setLoading(false); }
  }, []);

  useVisibleLoad(active, `${from}|${to}`, () => load(from, to));

  const sorted = useMemo(() => [...items].sort((a, b) =>
    sortKey === "cost"   ? b.totalCost - a.totalCost :
    sortKey === "margin" ? b.marginPct - a.marginPct :
                           b.totalQty  - a.totalQty
  ), [items, sortKey]);

  // Period totals come from the server's own full-period aggregate, NOT from summing the
  // table — the table is only the top 50 spends, so reducing it understated real spend and
  // disagreed with the Purchase page's own figure. Falls back to the table sum pre-load.
  const totalCost   = summary?.totalCost     ?? items.reduce((s, i) => s + i.totalCost, 0);
  const totalMRPVal = summary?.totalMRPValue ?? items.reduce((s, i) => s + i.totalMRPValue, 0);
  const avgMargin   = summary?.overallMarginPct ?? (totalMRPVal > 0 ? ((totalMRPVal - totalCost) / totalMRPVal) * 100 : 0);

  function handleExport() {
    downloadXlsx(`purchase-cost-analysis-${from}-to-${to}.xlsx`, [
      ...brandedHeader("Purchase Cost Analysis"),
      ["Period total purchased", totalCost, "MRP value", totalMRPVal, "Avg margin %", Number(avgMargin.toFixed(2))],
      [],
      ["Medicine","Total Qty","Total Cost","MRP Value","Avg Purchase Rate","Avg MRP","Margin %"],
      ...sorted.map(i => [i.medicineName, i.totalQty, i.totalCost, i.totalMRPValue, i.avgPurchaseRate, i.avgMRP, i.marginPct]),
    ], "Cost Analysis");
  }

  return (
    <div className="space-y-4">
      <Section
        title="Purchase Cost Analysis"
        icon={ShoppingCart}
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
        action={items.length > 0 && !error ? (
          <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
            <Download className="w-3 h-3" /> Excel
          </button>
        ) : undefined}
      >
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/40">
          <PeriodSelector period={period} onChange={setPeriod} customFrom={customFrom} customTo={customTo} onCustomChange={(f,t) => { setCustomFrom(f); setCustomTo(t); }} />
        </div>
        {loading ? (
          <ListSkeleton rows={5} />
        ) : error ? (
          /* Distinct from the empty state below: this says the report could not be
             loaded, never that nothing was purchased. */
          <LoadErrorState title="Cost analysis could not be loaded" message={error} onRetry={() => load(from, to)} />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <ShoppingCart className="w-8 h-8 text-slate-200 mb-2" strokeWidth={1.4} />
            <p className="text-[13px] font-medium">No purchase data for this period</p>
          </div>
        ) : (
          <div>
            {/* Summary */}
            <StatRow cols={3}>
              <StatTile label="Total purchased" hint="confirmed receipts, whole period" value={fmtK(totalCost)} />
              <StatTile label="MRP value of stock" hint="at retail price" value={fmtK(totalMRPVal)} tone="accent" />
              <StatTile
                label="Average margin" hint={avgMargin >= 20 ? "Healthy margin" : "Low margin"}
                value={`${avgMargin.toFixed(1)}%`}
                tone={avgMargin >= 20 ? "good" : "warn"}
              />
            </StatRow>
            <PurchasesCharts items={items} />
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

// ─── Compliance: GSTR-3B ─────────────────────────────────────────
/**
 * A GSTR-3B working sheet — the figures to type into each table on the portal.
 *
 * <p>Deliberately not styled as a filed return. GSTR-3B is self-declared and signed by the
 * taxpayer; this screen supplies what the pharmacy's own documents can support and states
 * plainly what they cannot, because a summary that looks complete is the one nobody checks.
 */
function Gstr3bSection() {
  const now = new Date();
  const [from, setFrom] = useState(istMonthStart(now));
  const [to, setTo]     = useState(toInputDate(now));
  const [data, setData] = useState<Gstr3b | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Never fetched on a half-filled range — an empty bound silently widens the period to
  // all-time while the heading still claims one month. See rangeError.
  const invalidRange = rangeError(from, to);

  const load = useCallback(async () => {
    const bad = rangeError(from, to);
    if (bad) {
      setError(bad);
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get<{ success: boolean; data: Gstr3b }>(
        `/reports/gst/gstr-3b?from=${isoFrom(from)}&to=${isoTo(to)}`
      );
      setData(r.data.data);
      setError(null);
    } catch (e) {
      // A blank 3B reads as "you owe nothing this month". Say it failed instead.
      setError(getErrorMessage(e, "Could not build the GSTR-3B figures."));
      setData(null);
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** One row set feeding both formats — see the GST summary for why they must not drift. */
  function exportRows(d: Gstr3b): CellValue[][] {
    const amt = (label: string, a: TaxAmount) => [label, a.taxableValue, a.igst, a.cgst, a.sgst];
    return [
      ["GSTR-3B working sheet", d.periodLabel],
      // `||`, not `??`: the backend treats a blank GSTIN as missing (isBlank), so "" has to
      // read as NOT SET too. With `??` an empty string passed straight through and the
      // workbook shipped with an EMPTY GSTIN cell — the one thing this row exists to shout about.
      ["GSTIN", d.identity.gstin || "NOT SET", "Legal name", d.identity.legalName ?? ""],
      [],
      ["3.1 Details of outward supplies", "Taxable value", "IGST", "CGST", "SGST"],
      amt("(a) Outward taxable supplies", d.outwardSupplies.taxableOutward),
      amt("(b) Outward taxable supplies (zero rated)", d.outwardSupplies.zeroRated),
      amt("(c) Other outward supplies (nil rated, exempted)", d.outwardSupplies.nilRatedExempt),
      amt("(d) Inward supplies liable to reverse charge", d.outwardSupplies.reverseCharge),
      amt("(e) Non-GST outward supplies", d.outwardSupplies.nonGst),
      amt("Credit notes already deducted from (a) and (c)", d.outwardSupplies.creditNotes),
      [],
      ["3.2 Of (a), inter-state supplies to unregistered persons", "Taxable value", "IGST"],
      ...(d.interstateToUnregistered.length
        ? d.interstateToUnregistered.map(r =>
            [r.state ?? "PLACE OF SUPPLY NOT RECORDED — assign before filing", r.taxableValue, r.igst])
        : [["None in this period", 0, 0]]),
      [],
      ["4 Eligible ITC", "", "IGST", "CGST", "SGST"],
      amt("(A)(5) All other ITC", d.inputTaxCredit.allOtherItc),
      amt("(B)(1) ITC reversed — rules 38/42/43 & section 17(5)", d.inputTaxCredit.reversedSection17),
      amt("(B)(2) ITC reversed — others (debit notes to suppliers)", d.inputTaxCredit.reversedOther),
      amt("(C) Net ITC available", d.inputTaxCredit.netAvailable),
      ...(d.dataQuality.expiredStock.batches > 0
        ? [[`NOTE: 4(B)(1) is NOT derived. ₹${money(d.dataQuality.expiredStock.embeddedItc)} of credit sits in `
            + `${d.dataQuality.expiredStock.batches} expired batch(es) (${d.dataQuality.expiredStock.units} units, `
            + `₹${money(d.dataQuality.expiredStock.cost)} at cost) that have never been written off. `
            + "Section 17(5)(h) blocks credit on destroyed goods — enter this in 4(B)(1) for the period "
            + "you write them off."]]
        : []),
      [],
      ["5 Exempt / nil-rated inward supplies", "Value"],
      ["Purchases at nil rate", d.exemptInward.taxableValue],
      [],
      ["Check before filing"],
      // These two travel with the file on purpose. The workbook is what gets emailed to the
      // accountant, and a figure that was floored or a period that has moved since it was
      // filed is not something to leave behind on a screen nobody reopens.
      ...(d.dataQuality.carryForward.taxableValue > 0
        ? [[`Credit notes exceeded supplies by ₹${money(d.dataQuality.carryForward.taxableValue)} `
            + `(IGST ₹${money(d.dataQuality.carryForward.igst)}, CGST ₹${money(d.dataQuality.carryForward.cgst)}, `
            + `SGST ₹${money(d.dataQuality.carryForward.sgst)}). 3.1 above is floored to nil — carry this `
            + "into the next period rather than filing a negative."]]
        : []),
      ...(d.dataQuality.lateCancellations.count > 0
        ? [[`${d.dataQuality.lateCancellations.count} bill(s) from this period were cancelled AFTER it ended `
            + `(₹${money(d.dataQuality.lateCancellations.taxableValue)} taxable, `
            + `₹${money(d.dataQuality.lateCancellations.totalGst)} GST). If this period has already been `
            + "filed, these figures no longer match what you filed."]]
        : []),
      ...(d.dataQuality.interstateWithoutPlaceOfSupply > 0
        ? [[`₹${money(d.dataQuality.interstateWithoutPlaceOfSupply)} of inter-state supply has no place of `
            + "supply recorded. The portal needs a state against every 3.2 row — assign these by hand."]]
        : []),
      ...(d.dataQuality.suppliersWithoutState > 0
        ? [[`${d.dataQuality.suppliersWithoutState} of ${d.dataQuality.suppliersTotal} suppliers have no state `
            + "recorded — purchases from them are assumed local, and the flagged-receipt check cannot see them."]]
        : []),
      ...d.dataQuality.untrackedNotes.map(n => [n]),
      ...(d.dataQuality.misclassifiedGrns.length
        ? [["Receipts from out-of-state suppliers booked as CGST+SGST: "
            + d.dataQuality.misclassifiedGrns.join(", ")]]
        : []),
    ];
  }

  const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function AmountRow({ label, a, muted, strong }: { label: string; a: TaxAmount; muted?: boolean; strong?: boolean }) {
    return (
      <div className={cn(
        "grid grid-cols-[2.4fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-2.5 border-b border-slate-50 items-center",
        strong && "bg-slate-50/70"
      )}>
        <span className={cn("text-[12px]", muted ? "text-slate-400" : strong ? "font-black text-slate-800" : "text-slate-700 font-medium")}>
          {label}
        </span>
        {[a.taxableValue, a.igst, a.cgst, a.sgst].map((v, i) => (
          <span key={i} className={cn("text-[12px] tabular-nums text-right",
            muted ? "text-slate-300" : strong ? "font-black text-slate-800" : "text-slate-700")}>
            {money(v)}
          </span>
        ))}
      </div>
    );
  }

  return (
    <Section
      title="GSTR-3B"
      icon={FileCheck}
      iconBg="bg-teal-50"
      iconColor="text-teal-600"
      action={
        <div className="flex items-center gap-2">
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <span className="text-slate-400 text-[11px]">to</span>
          <input type="date" value={to} min={from} max={toInputDate(new Date())} onChange={e => setTo(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400" />
          <button onClick={load} disabled={loading || !!invalidRange} title={invalidRange ?? undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-bold transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
            Generate
          </button>
          {data && (
            <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={() => downloadXlsx(`gstr-3b-${from}-to-${to}.xlsx`, [...brandedHeader("GSTR-3B working sheet", data.identity.gstin), ...exportRows(data)], "GSTR-3B")}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-800 px-2 py-1.5 hover:bg-slate-50 transition-colors">
                <Download className="w-3 h-3" /> Excel
              </button>
              <span className="w-px self-stretch bg-slate-200" aria-hidden="true" />
              <button onClick={() => downloadCsv(`gstr-3b-${from}-to-${to}.csv`, [...brandedHeader("GSTR-3B working sheet", data.identity.gstin), ...exportRows(data)])}
                title="Plain CSV — for Tally and other accounting imports"
                className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 px-2 py-1.5 hover:bg-slate-50 transition-colors">
                CSV
              </button>
            </div>
          )}
        </div>
      }
    >
      {loading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <LoadErrorState title="GSTR-3B could not be built" message={error} onRetry={load} compact />
      ) : !data ? null : (
        <div>
          {/* Identity first — a missing GSTIN stops a filing outright, so it cannot be
              something you discover after reading the numbers. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 bg-slate-50/60 border-b border-slate-100">
            <span className="text-[11px] text-slate-500">
              <span className="font-bold text-slate-700">{data.identity.legalName ?? "This pharmacy"}</span>
              {" · "}{data.periodLabel}
            </span>
            {/* `||`, not `??` — a blank GSTIN is a missing GSTIN (the backend agrees), and with
                `??` an empty string rendered the label with nothing after it. */}
            <span className={cn("text-[11px] font-semibold tabular-nums",
              data.dataQuality.gstinMissing ? "text-red-600" : "text-slate-600")}>
              GSTIN {data.identity.gstin || "not set"}
            </span>
            {data.dataQuality.stateMissing && (
              <span className="text-[11px] font-semibold text-red-600">
                State not set — every supply has been treated as local
              </span>
            )}
          </div>

          <div className="grid grid-cols-[2.4fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            <span>3.1 Outward supplies</span>
            <span className="text-right">Taxable value</span>
            <span className="text-right">IGST</span>
            <span className="text-right">CGST</span>
            <span className="text-right">SGST</span>
          </div>
          <AmountRow label="(a) Outward taxable supplies" a={data.outwardSupplies.taxableOutward} strong />
          <AmountRow label="(b) Zero rated (exports, SEZ)" a={data.outwardSupplies.zeroRated} muted />
          <AmountRow label="(c) Nil rated, exempted" a={data.outwardSupplies.nilRatedExempt} />
          <AmountRow label="(d) Inward liable to reverse charge" a={data.outwardSupplies.reverseCharge} muted />
          <AmountRow label="(e) Non-GST outward supplies" a={data.outwardSupplies.nonGst} muted />
          <div className="px-5 py-2 bg-blue-50/40 border-b border-slate-100">
            <p className="text-[11px] text-slate-600">
              Rows (a) and (c) are already net of{" "}
              <span className="font-bold tabular-nums">₹{money(data.outwardSupplies.creditNotes.taxableValue)}</span>{" "}
              of credit notes raised in this period.
            </p>
          </div>

          {data.interstateToUnregistered.length > 0 && (
            <>
              <div className="grid grid-cols-[2.4fr_1fr_1fr] gap-3 px-5 py-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                <span>3.2 Inter-state supplies to unregistered persons</span>
                <span className="text-right">Taxable value</span>
                <span className="text-right">IGST</span>
              </div>
              {/* A null state is the "could not be determined" bucket. Keyed by index because
                  null is a legitimate key here and would collide with itself. */}
              {data.interstateToUnregistered.map((r, i) => (
                <div key={r.state ?? `unknown-${i}`}
                  className={cn("grid grid-cols-[2.4fr_1fr_1fr] gap-3 px-5 py-2.5 border-b border-slate-50",
                    r.state === null && "bg-amber-50/60")}>
                  {r.state === null ? (
                    <span className="text-[12px] text-amber-800 font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" strokeWidth={2.2} />
                      Place of supply not recorded — assign a state before filing
                    </span>
                  ) : (
                    <span className="text-[12px] text-slate-700 font-medium">{r.state}</span>
                  )}
                  <span className={cn("text-[12px] tabular-nums text-right",
                    r.state === null ? "text-amber-900 font-semibold" : "text-slate-700")}>{money(r.taxableValue)}</span>
                  <span className={cn("text-[12px] tabular-nums text-right",
                    r.state === null ? "text-amber-900 font-semibold" : "text-slate-700")}>{money(r.igst)}</span>
                </div>
              ))}
            </>
          )}

          <div className="grid grid-cols-[2.4fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            <span>4 Eligible input tax credit</span>
            <span />
            <span className="text-right">IGST</span>
            <span className="text-right">CGST</span>
            <span className="text-right">SGST</span>
          </div>
          <AmountRow label="(A)(5) All other ITC — goods received" a={data.inputTaxCredit.allOtherItc} />
          {/* Two rows, because the return has had two since July 2022 and they behave
              differently: (B)(1) is permanent, (B)(2) can be reclaimed later via 4(D)(1). */}
          {/* Muted when the row itself is nil, NOT when the expired-stock exposure is clear.
              Keying it off the exposure greyed the row out at exactly the moment a write-off
              gave it real values — the one state in which it matters most. */}
          <AmountRow label="(B)(1) ITC reversed — rules 38/42/43 & s.17(5)"
            a={data.inputTaxCredit.reversedSection17}
            muted={data.inputTaxCredit.reversedSection17.igst === 0
                && data.inputTaxCredit.reversedSection17.cgst === 0
                && data.inputTaxCredit.reversedSection17.sgst === 0} />
          <AmountRow label="(B)(2) ITC reversed — debit notes to suppliers" a={data.inputTaxCredit.reversedOther} />
          <AmountRow label="(C) Net ITC available" a={data.inputTaxCredit.netAvailable} strong />
          {data.dataQuality.expiredStock.batches > 0 && (
            <div className="px-5 py-2.5 bg-amber-50/60 border-b border-slate-100">
              <p className="text-[11px] text-amber-900 leading-relaxed">
                <span className="font-bold">
                  4(B)(1) above is nil because it cannot be derived — but ₹{money(data.dataQuality.expiredStock.embeddedItc)}
                  {" "}of credit is sitting in expired stock.
                </span>{" "}
                {data.dataQuality.expiredStock.batches === 1
                  ? `1 batch (${data.dataQuality.expiredStock.units} units, ₹${money(data.dataQuality.expiredStock.cost)} at cost) is`
                  : `${data.dataQuality.expiredStock.batches} batches (${data.dataQuality.expiredStock.units} units, ₹${money(data.dataQuality.expiredStock.cost)} at cost) are`}
                {" "}past expiry and {data.dataQuality.expiredStock.batches === 1 ? "has" : "have"} never been
                written off. Section 17(5)(h) blocks credit on destroyed goods, so this has to be reversed in the
                period you dispose of them — enter it in 4(B)(1) by hand.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <span className="text-[12px] font-medium text-slate-700">5 · Exempt and nil-rated inward supplies</span>
            <span className="text-[13px] font-black text-slate-800 tabular-nums">₹{money(data.exemptInward.taxableValue)}</span>
          </div>

          {/* The honest part. Every line names something to check by hand. */}
          <div className="px-5 py-4 bg-amber-50/50">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" strokeWidth={2} />
              <h4 className="text-[12px] font-black text-slate-800">Check these before you file</h4>
            </div>
            {/* A period whose figures have MOVED since it may have been filed. First, because
                it invalidates a return that has already gone in — everything else here is a
                caveat about what to enter, this one is about what was already entered. */}
            {data.dataQuality.lateCancellations.count > 0 && (
              <div className="mb-2.5 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <p className="text-[11px] text-red-900 leading-relaxed">
                  <span className="font-bold">
                    {data.dataQuality.lateCancellations.count} bill
                    {data.dataQuality.lateCancellations.count === 1 ? " was" : "s were"} cancelled after this
                    period ended
                  </span>{" "}
                  (₹{money(data.dataQuality.lateCancellations.taxableValue)} taxable,
                  ₹{money(data.dataQuality.lateCancellations.totalGst)} GST). That value is no longer in the
                  figures above. <span className="font-bold">If you have already filed this period, this sheet
                  no longer matches what you filed</span> — reconcile the difference before filing anything else.
                </p>
              </div>
            )}
            {data.dataQuality.carryForward.taxableValue > 0 && (
              <div className="mb-2.5 rounded-lg bg-amber-100/70 border border-amber-300 px-3 py-2.5">
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  <span className="font-bold">
                    Credit notes exceeded supplies by ₹{money(data.dataQuality.carryForward.taxableValue)}.
                  </span>{" "}
                  GSTR-3B cannot be filed with a negative 3.1, so the rows above are floored to nil rather
                  than shown as negative. Carry the excess (IGST ₹{money(data.dataQuality.carryForward.igst)},
                  CGST ₹{money(data.dataQuality.carryForward.cgst)},
                  SGST ₹{money(data.dataQuality.carryForward.sgst)}) into the next period's 3.1.
                </p>
              </div>
            )}
            {data.dataQuality.suppliersWithoutState > 0 && (
              <div className="mb-2.5 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <p className="text-[11px] text-red-900 leading-relaxed">
                  <span className="font-bold">
                    {data.dataQuality.suppliersWithoutState} of {data.dataQuality.suppliersTotal} suppliers
                    have no state recorded.
                  </span>{" "}
                  Interstate purchase tax is decided by comparing the supplier's state with yours, so
                  purchases from these suppliers are treated as local and charged CGST+SGST whatever the
                  truth. The out-of-state check below <span className="font-bold">cannot see them either</span> —
                  it has nothing to compare — so a short list there does not mean a clean bill.
                  Fill in supplier states before relying on this section.
                </p>
              </div>
            )}
            {data.dataQuality.misclassifiedGrns.length > 0 && (
              <p className="text-[11px] text-amber-900 mb-2 leading-relaxed">
                <span className="font-bold">
                  {data.dataQuality.misclassifiedGrns.length} goods receipt
                  {data.dataQuality.misclassifiedGrns.length === 1 ? "" : "s"} from out-of-state suppliers
                  {" "}recorded tax as CGST+SGST instead of IGST
                </span>{" "}
                ({data.dataQuality.misclassifiedGrns.join(", ")}). These predate the fix and were left
                untouched on purpose — they may sit behind a return you have already filed. Move the
                amounts between heads yourself if the credit has not been claimed yet.
              </p>
            )}
            <ul className="space-y-1">
              {data.dataQuality.untrackedNotes.map((n, i) => (
                <li key={i} className="text-[11px] text-slate-600 leading-relaxed flex gap-1.5">
                  <span className="text-slate-300 flex-shrink-0">•</span>{n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Tab: Compliance ──────────────────────────────────────────────
function ComplianceTab() {
  const [subTab, setSubTab] = useState<ComplianceSubTab>("gst");
  // Keep-alive, same reasoning as the main tab bar: these sections were mounted
  // conditionally, so every switch away and back re-ran the report from scratch AND
  // reset the date range the pharmacist had just chosen. A compliance range is picked
  // deliberately — it is a filing period — so losing it costs more here than anywhere
  // else on the page.
  const [mountedSubTabs, setMountedSubTabs] =
    useState<Set<ComplianceSubTab>>(() => new Set<ComplianceSubTab>(["gst"]));
  useEffect(() => {
    setMountedSubTabs(prev => (prev.has(subTab) ? prev : new Set(prev).add(subTab)));
  }, [subTab]);

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { id: "gst" as const,         label: "GST Summary",          icon: Receipt },
          { id: "gstr-3b" as const,     label: "GSTR-3B",              icon: FileCheck },
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

      {/* Mounted once, then shown/hidden via CSS — see the keep-alive note above. */}
      {mountedSubTabs.has("gst") && (
        <div className={cn(subTab !== "gst" && "hidden")}><GstReportSection /></div>
      )}
      {mountedSubTabs.has("gstr-3b") && (
        <div className={cn(subTab !== "gstr-3b" && "hidden")}><Gstr3bSection /></div>
      )}
      {mountedSubTabs.has("hsn-summary") && (
        <div className={cn(subTab !== "hsn-summary" && "hidden")}><HsnSummarySection /></div>
      )}
      {mountedSubTabs.has("schedule-h") && (
        <div className={cn(subTab !== "schedule-h" && "hidden")}><ScheduleHSection /></div>
      )}
    </div>
  );
}

// ─── Compliance: GST ─────────────────────────────────────────────
function GstReportSection() {
  const now = new Date();
  const [from, setFrom]   = useState(istMonthStart(now));
  const [to,   setTo]     = useState(toInputDate(now));
  const [data, setData]   = useState<GstData | null>(null);
  const [loading, setLoading] = useState(false);
  // Same reasoning as the Schedule H register: these figures are transcribed into
  // a GSTR filing, so "failed to load" must never render as zeroes or an empty
  // period. Filing a return from numbers that silently defaulted is far worse than
  // seeing an error.
  const [error, setError] = useState<string | null>(null);
  // Trailing-12-month liability trend — independent of the date range above, loaded once.
  const [trend, setTrend] = useState<{ month: string; cgst: number; sgst: number; igst: number; totalGst: number }[]>([]);
  const [trendError, setTrendError] = useState<string | null>(null);

  const invalidRange = rangeError(from, to);

  async function load() {
    const bad = rangeError(from, to);
    if (bad) {
      setError(bad);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ success: boolean; data: GstData }>(`/reports/gst?from=${isoFrom(from)}&to=${isoTo(to)}`);
      setData(r.data.data);
    } catch (e) {
      setError(getErrorMessage(e, "Could not load the GST summary. Please try again."));
      setData(null);
    }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadTrend = useCallback(() => {
    api.get<{ success: boolean; data: { months: typeof trend } }>("/reports/gst/trend?months=12")
      .then(r => { setTrend(r.data.data.months ?? []); setTrendError(null); })
      .catch(e => setTrendError(getErrorMessage(e, "The 12-month liability trend didn't load.")));
  }, []);
  useEffect(() => { loadTrend(); }, [loadTrend]);

  /**
   * One row set, two formats.
   *
   * <p>Built once and handed to both exporters so the workbook and the CSV can never drift
   * apart — a GST figure that differs between two files from the same screen is the kind of
   * discrepancy somebody has to reconcile by hand at filing time.
   */
  function exportRows(d: GstData): CellValue[][] {
    return [
      ["Period", `${fmtDate(from)} to ${fmtDate(to)}`],
      ["Invoices", d._count],
      ["Gross Sales", d._sum.subtotal ?? 0],
      ["Discount",    d._sum.discountAmount ?? 0],
      ["Taxable",     d._sum.taxableAmount ?? 0],
      ["CGST",        d._sum.cgst ?? 0],
      ["SGST",        d._sum.sgst ?? 0],
      ["IGST",        d._sum.igst ?? 0],
      ["Total GST",   d._sum.totalGst ?? 0],
      // The three terms that close the gap between taxable+GST and the net figure. Without
      // them the export had the same unexplained difference the screen did.
      ["Extra Charges",      d._sum.extraCharges ?? 0],
      ["Adjustments",        d._sum.adjustmentAmount ?? 0],
      ["Round Off",          d._sum.roundOff ?? 0],
      ["Net Amount",  d._sum.totalAmount ?? 0],
    ];
  }
  function exportExcel() { if (data) downloadXlsx(`gst-${from}-to-${to}.xlsx`, [...brandedHeader("GST Summary"), ...exportRows(data)], "GST Summary"); }
  // CSV stays on the two compliance reports because an accountant feeds these to Tally,
  // which imports CSV. Everything else on this screen is read by a person, in Excel.
  function exportCsvFile() { if (data) downloadCsv(`gst-${from}-to-${to}.csv`, [...brandedHeader("GST Summary"), ...exportRows(data)]); }

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
          <button onClick={load} disabled={loading || !!invalidRange} title={invalidRange ?? undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-bold transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
            Generate
          </button>
          {data && (
            <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={exportExcel} className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-800 px-2 py-1.5 hover:bg-slate-50 transition-colors">
                <Download className="w-3 h-3" /> Excel
              </button>
              <span className="w-px self-stretch bg-slate-200" aria-hidden="true" />
              <button
                onClick={exportCsvFile}
                title="Plain CSV — for Tally and other accounting imports"
                className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 px-2 py-1.5 hover:bg-slate-50 transition-colors"
              >
                CSV
              </button>
            </div>
          )}
        </div>
      }
    >
      {(trendError || (trend.length > 0 && trend.some(m => m.totalGst > 0))) && (
        <div className="px-5 py-4 border-b border-slate-100">
          <ChartCard title="Output tax liability — last 12 months" className="border-0 shadow-none p-0"
            subtitle="What you owed each month, by head. IGST = inter-state sales." height={200}
            error={trendError} onRetry={loadTrend}>
            <StackedBars
              data={trend.map(m => ({
                label: new Date(`${m.month}-01T12:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
                CGST: m.cgst, SGST: m.sgst, IGST: m.igst,
              }))}
              series={[
                { key: "CGST", name: "CGST", color: "#4f46e5" },
                { key: "SGST", name: "SGST", color: "#6366f1" },
                { key: "IGST", name: "IGST", color: "#f59e0b" },
              ]}
              height={190}
            />
          </ChartCard>
        </div>
      )}
      {loading ? (
        <ListSkeleton rows={5} />
      ) : error ? (
        <LoadErrorState title="GST summary could not be loaded" message={error} onRetry={load} />
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
          {(data._sum.totalGst ?? 0) > 0 && (() => {
            const heads = [
              { name: "CGST", value: data._sum.cgst ?? 0, color: "#4f46e5" },
              { name: "SGST", value: data._sum.sgst ?? 0, color: "#6366f1" },
              { name: "IGST", value: data._sum.igst ?? 0, color: "#f59e0b" },
            ].filter(h => h.value > 0);
            const taxable = data._sum.taxableAmount ?? 0;
            const gst = data._sum.totalGst ?? 0;
            const effRate = taxable > 0 ? (gst / taxable) * 100 : 0;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4 px-5 py-4 border-b border-slate-100 items-center">
                <Donut data={heads} height={150}
                  centerValue={`${effRate.toFixed(1)}%`} centerLabel="Eff. rate" />
                <div>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Output tax collected this period, by head. IGST above zero means inter-state sales —
                    those go to a different box on the return.
                  </p>
                  <LegendRow items={heads.map(h => ({ label: h.name, color: h.color, value: `₹${fmt(h.value)}` }))} />
                </div>
              </div>
            );
          })()}
          <div className="divide-y divide-slate-50">
            {[
              { label: "Gross Sales (before discount)", value: data._sum.subtotal,        style: "normal"    },
              { label: "Discount Given",                 value: data._sum.discountAmount,  style: "negative"  },
              { label: "Taxable Amount",                 value: data._sum.taxableAmount,   style: "bold"      },
              { label: "CGST",                           value: data._sum.cgst,            style: "normal"    },
              { label: "SGST",                           value: data._sum.sgst,            style: "normal"    },
              // Interstate tax. Without this row an interstate sale showed CGST 0 and
              // SGST 0 against a non-zero Total GST — three figures that cannot be
              // reconciled, on the screen a GSTR-1 return is transcribed from.
              { label: "IGST",                           value: data._sum.igst,            style: "normal"    },
              { label: "Total GST Collected",            value: data._sum.totalGst,        style: "bold"      },
              // Everything between the tax and the net figure. These columns exist on every
              // invoice and were simply never shown here, so Taxable + Total GST did not add
              // up to Net Invoice Value and nothing on the screen could explain the gap.
              // Rendered only when non-zero: on the ordinary bill they are all zero, and three
              // permanent zero rows would bury the figures that matter.
              ...(data._sum.extraCharges
                ? [{ label: "Extra Charges", value: data._sum.extraCharges, style: "normal" as const }] : []),
              ...(data._sum.adjustmentAmount
                ? [{ label: "Adjustments", value: data._sum.adjustmentAmount, style: "normal" as const }] : []),
              ...(data._sum.roundOff
                ? [{ label: "Round Off", value: data._sum.roundOff, style: "normal" as const }] : []),
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
  const [from, setFrom]     = useState(istMonthStart(now));
  const [to,   setTo]       = useState(toInputDate(now));
  const [rows, setRows]     = useState<HsnRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  // HSN totals feed the same GSTR filing as the GST summary — a silent empty
  // result would understate the return. See GstReportSection.
  const [error, setError] = useState<string | null>(null);

  const invalidRange = rangeError(from, to);

  async function load() {
    const bad = rangeError(from, to);
    if (bad) {
      setError(bad);
      setRows(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ success: boolean; data: { rows: HsnRow[] } }>(
        `/reports/gst/hsn-summary?from=${isoFrom(from)}&to=${isoTo(to)}`
      );
      setRows(r.data.data.rows);
    } catch (e) {
      setError(getErrorMessage(e, "Could not load the HSN summary. Please try again."));
      setRows(null);
    }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The backend keeps lines with no HSN code under this label so the totals still reconcile
   * with the GST summary — dropping them would make the two disagree. But GSTR-1 Table 12
   * needs a real HSN against every line, so it has to read as a to-do rather than as a code
   * somebody transcribes into the portal verbatim.
   */
  const UNCLASSIFIED = "UNCLASSIFIED";
  const unclassified = (rows ?? []).filter(r => r.hsnCode === UNCLASSIFIED);

  /** Built once for both formats — see the GST summary for why they must not drift. */
  function exportRows(): CellValue[][] {
    return [
      ["HSN Code", "GST Rate %", "Total Qty", "Taxable Amount", "CGST", "SGST", "IGST", "Total GST", "Total Amount"],
      ...(rows ?? []).map(r => [
        // HSN stays TEXT: it is a code, and as a number "03004" loses its leading zero.
        r.hsnCode, r.gstRate, r.totalQty,
        r.taxableAmount, r.cgst, r.sgst, r.igst, r.totalGst, r.totalAmount,
      ]),
    ];
  }
  const hasRows = !!rows && rows.length > 0;
  function exportExcel() { if (hasRows) downloadXlsx(`hsn-summary-${from}-to-${to}.xlsx`, [...brandedHeader("GSTR-1 HSN Summary"), ...exportRows()], "GSTR-1 HSN"); }
  function exportCsvFile() { if (hasRows) downloadCsv(`hsn-summary-${from}-to-${to}.csv`, [...brandedHeader("GSTR-1 HSN Summary"), ...exportRows()]); }

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
          <button onClick={load} disabled={loading || !!invalidRange} title={invalidRange ?? undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-bold transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
            Generate
          </button>
          {hasRows && (
            <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={exportExcel} className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-800 px-2 py-1.5 hover:bg-slate-50 transition-colors">
                <Download className="w-3 h-3" /> Excel
              </button>
              <span className="w-px self-stretch bg-slate-200" aria-hidden="true" />
              <button
                onClick={exportCsvFile}
                title="Plain CSV — for Tally and other accounting imports"
                className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 px-2 py-1.5 hover:bg-slate-50 transition-colors"
              >
                CSV
              </button>
            </div>
          )}
        </div>
      }
    >
      {loading ? (
        <ListSkeleton rows={5} />
      ) : error ? (
        <LoadErrorState title="HSN summary could not be loaded" message={error} onRetry={load} />
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
        <div>
          {rows.length > 1 && (
            <div className="mb-3">
              <HBars
                data={[...rows].sort((a, b) => b.taxableAmount - a.taxableAmount).slice(0, 8)
                  .map(r => ({ label: `${r.hsnCode} · ${r.gstRate}%`, value: r.taxableAmount }))}
                height={Math.min(rows.length, 8) * 26 + 20}
                color={CHARTC.gst} valueFormatter={inrCompact}
              />
              <p className="text-[10px] text-slate-400 mt-1">Taxable value by HSN / rate — where the return's Table 12 weight sits.</p>
            </div>
          )}
          {unclassified.length > 0 && (
            <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-2.5 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
              <p className="text-[11px] text-amber-900 leading-relaxed">
                <span className="font-bold">
                  ₹{fmt(unclassified.reduce((s, r) => s + r.taxableAmount, 0))} of sales have no HSN code.
                </span>{" "}
                They are shown below as <span className="font-mono font-bold">UNCLASSIFIED</span> so this
                summary still reconciles with the GST summary — but that is not a code, and GSTR-1 Table 12
                needs a real HSN against every line. Set the HSN on these medicines, then regenerate.
              </p>
            </div>
          )}
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
                <tr key={i} className={cn("border-t border-slate-50 hover:bg-slate-50/60 transition-colors",
                  r.hsnCode === UNCLASSIFIED && "bg-amber-50/60")}>
                  {/* Not a code — flagged so it is never transcribed into the portal as one. */}
                  <td className={cn("px-3 py-2 font-mono font-semibold",
                    r.hsnCode === UNCLASSIFIED ? "text-amber-800" : "text-slate-700")}>{r.hsnCode}</td>
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
        </div>
      )}
    </Section>
  );
}

// ─── Compliance: Schedule H ───────────────────────────────────────
function ScheduleHSection() {
  const now = new Date();
  const [from, setFrom]   = useState(istMonthStart(now));
  const [to,   setTo]     = useState(toInputDate(now));
  const [schedule, setSchedule] = useState("");
  const [items, setItems] = useState<ScheduleHItem[]>([]);
  const [loading, setLoading] = useState(false);
  // A failed load must NOT look like an empty register. Swallowing the error and
  // rendering [] made the page state "No controlled medicine dispensing records"
  // — a definitive claim that nothing was dispensed — whenever the request failed
  // for any reason. On a statutory register shown to a Drug Inspector that is the
  // most dangerous possible way to fail, so load errors are tracked separately and
  // rendered as an explicit failure.
  const [error, setError] = useState<string | null>(null);

  const invalidRange = rangeError(from, to);

  async function load() {
    const bad = rangeError(from, to);
    if (bad) {
      // Reported as an error, never as an empty register — see the note above.
      setError(bad);
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = `/reports/schedule-h?from=${isoFrom(from)}&to=${isoTo(to)}${schedule ? `&schedule=${schedule}` : ""}`;
      const r = await api.get<{ success: boolean; data: ScheduleHItem[] }>(params);
      setItems(r.data.data ?? []);
    } catch (e) {
      // The backend returns an actionable 400 when the date range exceeds the
      // register's row cap ("narrow the range…"). getErrorMessage surfaces that
      // text verbatim rather than replacing it with a generic failure string.
      setError(getErrorMessage(e, "Could not load the Schedule H register. Please try again."));
      setItems([]);
    }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExport() {
    downloadXlsx(`schedule-h-${from}-to-${to}.xlsx`, [
      ["Date","Invoice No","Patient","Phone","Doctor","Prescription No","Medicine","Schedule","Strength","Qty","Dispensed By"],
      // Optional chaining on `inventory`, `medicine` and `user`: all three are nullable on the
      // wire (the DTO emits null when the underlying row is gone, e.g. a legacy-imported bill
      // with no user). They were dereferenced directly, so ONE such row threw a TypeError and
      // took the whole export — and, in the table below, the whole Reports page — down. A
      // register that is missing one field is still a register; a blank screen is not.
      ...items.map(i => [
        i.invoice.createdAt.slice(0,10),
        i.invoice.invoiceNumber,
        i.invoice.customer?.name ?? "Walk-in",
        i.invoice.customer?.phone ?? "",
        i.invoice.doctorName ?? "",
        i.invoice.prescriptionId ?? "",
        i.inventory?.medicine?.name ?? "—",
        i.inventory?.medicine?.schedule ?? "",
        i.inventory?.medicine?.strength ?? "",
        i.quantity,
        i.invoice.user?.name ?? "—",
      ]),
    ], "Schedule Register");
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
          <button onClick={load} disabled={loading || !!invalidRange} title={invalidRange ?? undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-bold transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
            Load
          </button>
          {/* Export stays hidden while errored: a CSV built from a failed load
              would be an incomplete register that looks authoritative on disk. */}
          {items.length > 0 && !error && (
            <button onClick={handleExport} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors">
              <Download className="w-3 h-3" /> Excel
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
        <ListSkeleton rows={5} />
      ) : error ? (
        /* Deliberately distinct from the empty state below: this says the register
           could not be loaded, never that nothing was dispensed. */
        <LoadErrorState title="Register could not be loaded" message={error} onRetry={load} />
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
                  {/* Optional-chained: `inventory` and `medicine` are nullable on the wire, and
                      a direct dereference crashed the entire page rather than this one row. */}
                  <p className="text-[12px] font-semibold text-slate-800 truncate">
                    {item.inventory?.medicine?.name ?? "Medicine record unavailable"}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {item.inventory?.medicine?.schedule && (
                      <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                        Sch {item.inventory.medicine.schedule}
                      </span>
                    )}
                    {item.inventory?.medicine?.strength && (
                      <span className="text-[10px] text-slate-400">{item.inventory.medicine.strength}</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[12px] text-slate-600 truncate">{item.invoice.doctorName ?? "—"}</p>
                  {item.invoice.prescriptionId && <p className="text-[10px] text-slate-400">Rx: {item.invoice.prescriptionId}</p>}
                </div>
                <p className="text-[12px] font-bold text-slate-700 text-right tabular-nums">{item.quantity}</p>
                <p className="text-[11px] text-slate-500 truncate">{item.invoice.user?.name ?? "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Stock Audit Tab ──────────────────────────────────────────────
type AuditSession = {
  id: string; sessionNumber: string; approvedAt: string;
  totalItems: number; itemsWithVariance: number;
  gainValue: number; lossValue: number; netValue: number;
};
type AuditReport = {
  sessions: AuditSession[];
  totals: { gainValue: number; lossValue: number; netValue: number };
};

function AuditTab() {
  const [data,    setData]    = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get<{ success: boolean; data: AuditReport }>("/stock-audit/report")
      .then(({ data: r }) => setData(r.data))
      // getErrorMessage, like every other loader on this page — a raw axios
      // "Request failed with status code 500" is not something to show a pharmacist.
      .catch(e => setError(getErrorMessage(e, "Could not load the stock audit history.")))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    if (!data) return;
    downloadXlsx("stock-audit-report.xlsx", [
      ["Session", "Approved Date", "Items", "Variances", "Surplus (₹)", "Shrinkage (₹)", "Net (₹)"],
      ...data.sessions.map(s => [
        s.sessionNumber,
        fmtDate(s.approvedAt),
        s.totalItems,
        s.itemsWithVariance,
        s.gainValue,
        s.lossValue,
        s.netValue,
      ]),
    ], "Stock Audit");
  }

  return (
    <Section title="Stock Audit History" icon={ClipboardList} iconBg="bg-blue-50" iconColor="text-blue-600"
      action={
        <button onClick={exportCsv} disabled={!data || data.sessions.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export Excel
        </button>
      }>
      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <LoadErrorState title="Stock audit history could not be loaded" message={error} onRetry={load} compact />
      ) : !data || data.sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <ClipboardList className="w-10 h-10 text-slate-200 mb-3" strokeWidth={1.3} />
          <p className="text-[14px] font-semibold text-slate-500">No approved audits yet</p>
          <p className="text-[12px] text-slate-400 mt-1">Completed and approved audits will appear here with P&L analysis.</p>
          <Link to="/dashboard/inventory?tab=audit"
            className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
            Start a stock audit <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Audits done",    value: String(data.sessions.length),        icon: ClipboardList, color: "bg-blue-50 text-blue-600"   },
              { label: "Total surplus",  value: "₹" + fmt(data.totals.gainValue),    icon: TrendingUp,    color: "bg-emerald-50 text-emerald-600" },
              { label: "Total shrinkage",value: "₹" + fmt(data.totals.lossValue),    icon: TrendingDown,  color: "bg-red-50 text-red-600"      },
              {
                label: "Net P&L",
                value: (data.totals.netValue >= 0 ? "+" : "") + "₹" + fmt(data.totals.netValue),
                icon:  IndianRupee,
                color: data.totals.netValue >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600",
              },
            ].map(k => (
              <div key={k.label} className="bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", k.color)}>
                  <k.icon className="w-4 h-4" strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">{k.label}</p>
                  <p className="text-[15px] font-black text-slate-800 tabular-nums leading-tight">{k.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Session table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-3 px-4 py-2 bg-slate-50/70 border-b border-slate-100">
              {["Session", "Date", "Items", "Variances", "Surplus", "Shrinkage", "Net"].map(h => (
                <span key={h} className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{h}</span>
              ))}
            </div>
            <div className="divide-y divide-slate-50">
              {data.sessions.map(s => (
                <Link key={s.id} to={`/dashboard/stock-audit/${s.id}`}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 hover:bg-slate-50/60 transition-colors">
                  <span className="text-[12px] font-bold text-blue-700 font-mono">{s.sessionNumber}</span>
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">{fmtDate(s.approvedAt)}</span>
                  <span className="text-[12px] text-slate-700 tabular-nums text-right">{s.totalItems}</span>
                  <span className={cn("text-[12px] tabular-nums text-right font-semibold",
                    s.itemsWithVariance > 0 ? "text-amber-600" : "text-slate-400")}>
                    {s.itemsWithVariance}
                  </span>
                  <span className="text-[12px] text-emerald-600 tabular-nums text-right font-semibold">
                    {s.gainValue > 0 ? "₹" + fmt(s.gainValue) : "—"}
                  </span>
                  <span className="text-[12px] text-red-500 tabular-nums text-right font-semibold">
                    {s.lossValue > 0 ? "₹" + fmt(s.lossValue) : "—"}
                  </span>
                  <span className={cn("text-[12px] tabular-nums text-right font-bold",
                    s.netValue > 0 ? "text-emerald-600" : s.netValue < 0 ? "text-red-500" : "text-slate-400")}>
                    {s.netValue === 0 ? "—" : (s.netValue > 0 ? "+" : "") + "₹" + fmt(s.netValue)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Main Tabs config ─────────────────────────────────────────────
// Every tab here is OWNER + MANAGER: the /dashboard/reports route guard and every
// /reports + /stock-audit/report endpoint enforce exactly that, and the Profit & Margin
// section a manager already sees carries the same cost/margin data Purchases does. There
// is no report content that is OWNER-exclusive, so there is no per-tab role gate.
const MAIN_TABS: { id: ReportTab; label: string; icon: React.ElementType; sub: string }[] = [
  { id: "overview",   label: "Overview",   icon: LayoutDashboard, sub: "The scoreboard, and what to act on" },
  { id: "sales",      label: "Sales",      icon: TrendingUp,    sub: "Revenue, profit & top medicines" },
  { id: "customers",  label: "Customers",  icon: Users,         sub: "Repeat business & who stopped coming" },
  { id: "inventory",  label: "Inventory",  icon: Package2,      sub: "Expiry, dead stock, value"  },
  { id: "purchases",  label: "Purchases",  icon: ShoppingCart,  sub: "Cost & margin analysis"     },
  { id: "compliance", label: "Compliance", icon: FileCheck,     sub: "GST & Schedule H"           },
  { id: "audit",      label: "Stock Audit",icon: ClipboardList, sub: "Approved audit P&L history" },
];

// ─── Page ─────────────────────────────────────────────────────────
export default function ReportsPage() {
  const role = useRef(getStoredUser()?.role ?? "CASHIER").current;
  const isManagerUp = role === "OWNER" || role === "MANAGER";
  const visibleTabs = MAIN_TABS;

  // Deep-link support — e.g. /dashboard/reports?tab=purchases from Purchase page Quick Actions
  const [searchParams] = useSearchParams();
  const initialTab = (() => {
    const requested = searchParams.get("tab") as ReportTab | null;
    return requested && visibleTabs.some(t => t.id === requested) ? requested : "overview";
  })();
  const [tab, setTab] = useState<ReportTab>(initialTab);
  const active = (visibleTabs.find(t => t.id === tab) ?? visibleTabs[0])!;

  // Keep-alive: each tab mounts the first time it's opened, then inactive ones are
  // hidden with CSS rather than unmounted. These tabs fetch in useEffect on mount, so
  // unmounting meant every switch re-ran every report request from scratch (the
  // Inventory tab alone is three). Switching back is now instant and keeps each tab's
  // filters, sort and scroll position.
  const [mountedTabs, setMountedTabs] = useState<Set<ReportTab>>(() => new Set([initialTab]));
  useEffect(() => {
    setMountedTabs(prev => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  // Shared period state — persists across tab switches
  const now = new Date();
  const [period,     setPeriod]     = useState<Period>("week");
  // istMonthStart, not new Date(y, m, 1): that builds LOCAL midnight, which is the
  // previous day in UTC and was the source of the off-by-one in every default range.
  const [customFrom, setCustomFrom] = useState(istMonthStart(now));
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

        {/* Tab content — mounted once, then shown/hidden via CSS (see keep-alive above) */}
        <div>
          {mountedTabs.has("overview") && (
            <div className={cn(tab !== "overview" && "hidden")}>
              <OverviewTab active={tab === "overview"} onNavigate={(t) => setTab(t as ReportTab)} />
            </div>
          )}
          {mountedTabs.has("sales") && (
            <div className={cn(tab !== "sales" && "hidden")}>
              <SalesTab
                period={period} setPeriod={setPeriod}
                customFrom={customFrom} setCustomFrom={setCustomFrom}
                customTo={customTo} setCustomTo={setCustomTo}
                isManagerUp={isManagerUp} active={tab === "sales"}
              />
            </div>
          )}
          {mountedTabs.has("customers") && (
            <div className={cn(tab !== "customers" && "hidden")}>
              <CustomersTab
                period={period} setPeriod={setPeriod}
                customFrom={customFrom} setCustomFrom={setCustomFrom}
                customTo={customTo} setCustomTo={setCustomTo}
                active={tab === "customers"}
              />
            </div>
          )}
          {mountedTabs.has("inventory") && (
            <div className={cn(tab !== "inventory" && "hidden")}><InventoryTab /></div>
          )}
          {mountedTabs.has("purchases") && (
            <div className={cn(tab !== "purchases" && "hidden")}>
              <PurchasesTab
                period={period} setPeriod={setPeriod}
                customFrom={customFrom} setCustomFrom={setCustomFrom}
                customTo={customTo} setCustomTo={setCustomTo}
                active={tab === "purchases"}
              />
            </div>
          )}
          {mountedTabs.has("compliance") && (
            <div className={cn(tab !== "compliance" && "hidden")}><ComplianceTab /></div>
          )}
          {mountedTabs.has("audit") && (
            <div className={cn(tab !== "audit" && "hidden")}><AuditTab /></div>
          )}
        </div>

      </div>
    </div>
  );
}
