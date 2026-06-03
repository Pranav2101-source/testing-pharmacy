

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  Receipt,
  AlertTriangle,
  Calendar,
  IndianRupee,
  TrendingUp,
  ShoppingBag,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────
interface DailySalesData {
  date: string;
  invoiceCount: number;
  revenue: number;
  gstCollected: number;
}

interface GstData {
  _sum: {
    subtotal: number | null;
    discountAmount: number | null;
    taxableAmount: number | null;
    cgst: number | null;
    sgst: number | null;
    totalGst: number | null;
    totalAmount: number | null;
  };
  _count: number;
}

interface ExpiryItem {
  id: string;
  quantity: number;
  expiryDate: string;
  batchNumber: string;
  mrp: number;
  medicine: { name: string };
}

type ReportTab = "daily" | "gst" | "expiry";

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ─── Export CSV helper ────────────────────────────────────────
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Tabs ─────────────────────────────────────────────────────
const TABS: { id: ReportTab; label: string; icon: React.ElementType }[] = [
  { id: "daily",  label: "Daily Sales",  icon: BarChart3     },
  { id: "gst",    label: "GST Report",   icon: Receipt       },
  { id: "expiry", label: "Expiry Alert", icon: AlertTriangle },
];

// ─── Daily Sales Tab ──────────────────────────────────────────
function DailySalesTab() {
  const [date, setDate]     = useState(toInputDate(new Date()));
  const [data, setData]     = useState<DailySalesData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: DailySalesData }>(`/reports/sales/daily?date=${d}`);
      setData(res.data.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  function shiftDay(delta: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    if (d <= new Date()) setDate(toInputDate(d));
  }

  return (
    <div className="space-y-5">
      {/* Date picker */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => shiftDay(-1)}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>
        <input
          type="date"
          value={date}
          max={toInputDate(new Date())}
          onChange={e => setDate(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
        />
        <button
          onClick={() => shiftDay(1)}
          disabled={date >= toInputDate(new Date())}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </button>
        <span className="text-sm text-slate-400">
          {date === toInputDate(new Date()) ? "Today" : fmtDate(date)}
        </span>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
      </div>

      {/* Stats cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              label: "Total Revenue",
              value: `₹${fmt(data.revenue)}`,
              icon: IndianRupee,
              bg: "bg-brand-50",
              color: "text-brand-600",
            },
            {
              label: "Invoices Generated",
              value: data.invoiceCount.toString(),
              icon: ShoppingBag,
              bg: "bg-emerald-50",
              color: "text-emerald-600",
            },
            {
              label: "GST Collected",
              value: `₹${fmt(data.gstCollected)}`,
              icon: TrendingUp,
              bg: "bg-amber-50",
              color: "text-amber-600",
            },
          ].map(({ label, value, icon: Icon, bg, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
              <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0", bg)}>
                <Icon className={cn("w-5 h-5", color)} strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-2xl font-black text-slate-800">{value}</p>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.invoiceCount === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400">
          <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" strokeWidth={1.4} />
          <p className="text-sm font-semibold">No sales recorded for this date</p>
        </div>
      )}
    </div>
  );
}

// ─── GST Report Tab ───────────────────────────────────────────
function GstReportTab() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [from, setFrom]   = useState(toInputDate(firstOfMonth));
  const [to, setTo]       = useState(toInputDate(now));
  const [data, setData]   = useState<GstData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: GstData }>(`/reports/gst?from=${from}T00:00:00Z&to=${to}T23:59:59Z`);
      setData(res.data.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExport() {
    if (!data) return;
    downloadCsv(`gst-report-${from}-to-${to}.csv`, [
      ["Period", `${fmtDate(from)} to ${fmtDate(to)}`],
      ["Invoices", String(data._count)],
      ["Gross Sales", String(data._sum.subtotal ?? 0)],
      ["Discount", String(data._sum.discountAmount ?? 0)],
      ["Taxable Amount", String(data._sum.taxableAmount ?? 0)],
      ["CGST", String(data._sum.cgst ?? 0)],
      ["SGST", String(data._sum.sgst ?? 0)],
      ["Total GST", String(data._sum.totalGst ?? 0)],
      ["Net Amount", String(data._sum.totalAmount ?? 0)],
    ]);
  }

  return (
    <div className="space-y-5">
      {/* Date range */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">From</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={e => setFrom(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">To</label>
          <input
            type="date"
            value={to}
            min={from}
            max={toInputDate(new Date())}
            onChange={e => setTo(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-bold transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
          Generate
        </button>
        {data && (
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-600 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        )}
      </div>

      {/* GST Table */}
      {data && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-sm font-bold text-slate-700">
              GST Summary — {fmtDate(from)} to {fmtDate(to)}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">{data._count} invoices in this period</p>
          </div>
          <div className="divide-y divide-slate-50">
            {[
              { label: "Gross Sales (before discount)", value: data._sum.subtotal },
              { label: "Discount Given", value: data._sum.discountAmount, negative: true },
              { label: "Taxable Amount", value: data._sum.taxableAmount, bold: true },
              { label: "CGST (2.5% / 6% / 9%)", value: data._sum.cgst },
              { label: "SGST (2.5% / 6% / 9%)", value: data._sum.sgst },
              { label: "Total GST Collected", value: data._sum.totalGst, bold: true },
              { label: "Net Invoice Value", value: data._sum.totalAmount, highlight: true },
            ].map(({ label, value, negative, bold, highlight }) => (
              <div key={label} className={cn("flex items-center justify-between px-5 py-3", highlight && "bg-brand-50/50")}>
                <span className={cn("text-sm text-slate-600", bold && "font-bold text-slate-800", highlight && "font-black text-brand-700")}>
                  {label}
                </span>
                <span className={cn("text-sm font-semibold text-slate-800", negative && "text-red-600", highlight && "font-black text-brand-700 text-base")}>
                  {negative ? "−" : ""}₹{fmt(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Expiry Alert Tab ─────────────────────────────────────────
function ExpiryTab() {
  const [items, setItems]     = useState<ExpiryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ success: boolean; data: ExpiryItem[] }>("/reports/expiry")
      .then(res => setItems(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleExport() {
    downloadCsv("expiry-report.csv", [
      ["Medicine", "Batch", "Expiry Date", "Days Left", "Qty", "MRP"],
      ...items.map(i => [
        i.medicine.name,
        i.batchNumber,
        fmtDate(i.expiryDate),
        String(daysUntil(i.expiryDate)),
        String(i.quantity),
        String(i.mrp),
      ]),
    ]);
  }

  const expired   = items.filter(i => daysUntil(i.expiryDate) <= 0);
  const critical  = items.filter(i => daysUntil(i.expiryDate) > 0 && daysUntil(i.expiryDate) <= 30);
  const warning   = items.filter(i => daysUntil(i.expiryDate) > 30 && daysUntil(i.expiryDate) <= 90);

  return (
    <div className="space-y-5">
      {/* Summary chips */}
      {!loading && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Expired", count: expired.length,  color: "bg-red-100 text-red-700 border-red-200"       },
            { label: "≤30 days", count: critical.length, color: "bg-orange-100 text-orange-700 border-orange-200" },
            { label: "≤90 days", count: warning.length,  color: "bg-amber-100 text-amber-700 border-amber-200"  },
          ].map(({ label, count, color }) => (
            <span key={label} className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border", color)}>
              <AlertTriangle className="w-3 h-3" />
              {count} {label}
            </span>
          ))}
          {items.length > 0 && (
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors ml-auto"
            >
              <Download className="w-3 h-3" />
              Export CSV
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_80px_80px_80px] gap-4 px-5 py-3 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
          <span>Medicine</span>
          <span>Batch</span>
          <span>Expiry</span>
          <span>Days Left</span>
          <span>Qty</span>
          <span>MRP</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-300">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Package className="w-10 h-10 mb-3 opacity-30" strokeWidth={1.4} />
            <p className="text-sm font-semibold">No items expiring within 90 days</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map((item) => {
              const days = daysUntil(item.expiryDate);
              const rowColor = days <= 0
                ? "bg-red-50/60"
                : days <= 30
                ? "bg-orange-50/40"
                : "";
              const daysColor = days <= 0
                ? "text-red-600 font-black"
                : days <= 30
                ? "text-orange-600 font-bold"
                : "text-amber-600 font-semibold";

              return (
                <div
                  key={item.id}
                  className={cn("grid grid-cols-[2fr_1fr_1fr_80px_80px_80px] gap-4 items-center px-5 py-3.5", rowColor)}
                >
                  <div className="flex items-center gap-2.5">
                    {days <= 30 && <AlertTriangle className={cn("w-3.5 h-3.5 flex-shrink-0", days <= 0 ? "text-red-500" : "text-orange-500")} />}
                    <p className="text-sm font-semibold text-slate-800 truncate">{item.medicine.name}</p>
                  </div>
                  <p className="text-sm text-slate-600 font-mono">{item.batchNumber}</p>
                  <p className="text-sm text-slate-600">{fmtDate(item.expiryDate)}</p>
                  <p className={cn("text-sm", daysColor)}>
                    {days <= 0 ? "Expired" : `${days}d`}
                  </p>
                  <p className="text-sm text-slate-700">{item.quantity}</p>
                  <p className="text-sm text-slate-700">₹{item.mrp}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>("daily");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-xl font-black text-slate-800">Reports</h1>
          <p className="text-sm text-slate-400 mt-0.5">Sales analytics, GST summary, and expiry alerts</p>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-2xl p-1 w-fit">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
                tab === id
                  ? "bg-brand-600 text-white shadow-sm"
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
          {tab === "daily"  && <DailySalesTab />}
          {tab === "gst"    && <GstReportTab />}
          {tab === "expiry" && <ExpiryTab />}
        </div>

      </div>
    </div>
  );
}
