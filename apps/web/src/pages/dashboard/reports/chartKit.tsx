/**
 * The Reports module's shared visual language — one place for colour, one set of
 * chart primitives, so every tab reads as the same product.
 *
 * <p>Colour is semantic, never decorative: money-in is always emerald, money-out
 * always slate, risk always amber, loss always red, compliance always indigo. A
 * reader who learns it on the Sales tab does not relearn it on Inventory.
 */
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Line,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart,
} from "recharts";
import { cn } from "@/lib/utils";

// ─── Semantic palette ────────────────────────────────────────────────────────
export const C = {
  revenue:  "#059669", // emerald-600 — money in
  revenueSoft: "#a7f3d0",
  cost:     "#64748b", // slate-500 — money out
  profit:   "#0d9488", // teal-600
  gst:      "#4f46e5", // indigo-600 — compliance / tax
  risk:     "#f59e0b", // amber-500 — attention, expiring, dead stock
  loss:     "#ef4444", // red-500 — below cost, shrinkage
  customer: "#8b5cf6", // violet-500
  inventory:"#0ea5e9", // sky-500
  grid:     "#eef2f7",
  axis:     "#94a3b8",
  prev:     "#cbd5e1", // last-period comparison line
} as const;

/** Payment channels — cash is the colour of money, digital shifts cooler. */
export const PAYMENT_COLORS: Record<string, string> = {
  CASH: "#059669", UPI: "#6366f1", CARD: "#f59e0b", CREDIT: "#ef4444",
  WALLET: "#14b8a6", ADVANCE: "#8b5cf6", OTHER: "#94a3b8",
};

/** Categorical series (medicines, categories) — max-distinct, colour-blind safe order. */
export const SERIES = ["#4f46e5", "#0ea5e9", "#059669", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

// ─── Formatting ──────────────────────────────────────────────────────────────
/** A finite number, or 0 — so a stray null/NaN/Infinity never renders as "₹NaN". */
export const num = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
export const inr = (n: number) => "₹" + num(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
export const inrCompact = (n: number) => {
  const v = num(n);
  const a = Math.abs(v);
  if (a >= 1e7) return "₹" + (v / 1e7).toFixed(2) + "Cr";
  if (a >= 1e5) return "₹" + (v / 1e5).toFixed(1) + "L";
  if (a >= 1e3) return "₹" + (v / 1e3).toFixed(1) + "K";
  return "₹" + Math.round(v).toLocaleString("en-IN");
};

const tooltipStyle = {
  borderRadius: "10px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 8px 24px -6px rgb(15 23 42 / 0.18)",
  fontSize: "12px",
  padding: "8px 10px",
};

// ─── Small states shared by every chart card ─────────────────────────────────
/** A chart failed to load. Says WHAT failed and WHY, never a bare spinner-gone-blank. */
export function ChartError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center gap-1.5 px-4">
      <span className="text-[12px] font-semibold text-red-600">Couldn&apos;t load this chart</span>
      <span className="text-[11px] text-slate-500 max-w-[36ch]">{message}</span>
      {onRetry && (
        <button onClick={onRetry}
          className="mt-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-2.5 py-1">
          Try again
        </button>
      )}
    </div>
  );
}
export function ChartEmpty({ msg }: { msg: string }) {
  return <div className="w-full h-full flex items-center justify-center text-[12px] text-slate-400 text-center px-4">{msg}</div>;
}
export function ChartSkeleton() { return <div className="w-full h-full rounded-xl skeleton" />; }

// ─── Card shell ──────────────────────────────────────────────────────────────
export function ChartCard({
  title, subtitle, right, height = 240, children, className,
  loading, error, empty, onRetry,
}: {
  title: string; subtitle?: React.ReactNode; right?: React.ReactNode;
  height?: number; children: React.ReactNode; className?: string;
  /** When set, the card renders the matching state instead of `children`. */
  loading?: boolean; error?: string | null; empty?: string | null; onRetry?: () => void;
}) {
  return (
    <div className={cn("bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col", className)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-black text-slate-800">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div style={{ height }} className="min-h-0 -ml-2">
        {loading ? <ChartSkeleton />
          : error ? <ChartError message={error} onRetry={onRetry} />
            : empty ? <ChartEmpty msg={empty} />
              : children}
      </div>
    </div>
  );
}

// ─── Revenue trend: bars for the period, a faint line for the one before ──────
export function RevenueTrend({
  data, prev, valueKey = "revenue", height = 220, currentKey,
}: {
  data: { label: string; revenue: number; bills?: number }[];
  prev?: number[] | null;
  valueKey?: string;
  height?: number;
  currentKey?: string;
}) {
  if (!data || data.length === 0) return <ChartEmpty msg="No sales in this period" />;
  const merged = data.map((d, i) => ({
    ...d,
    revenue: Number.isFinite(d.revenue) ? d.revenue : 0,
    prev: Number.isFinite(prev?.[i]) ? prev![i] : null,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={merged} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: C.axis, fontSize: 10 }}
          interval="preserveStartEnd" minTickGap={16} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: C.axis, fontSize: 10 }}
          width={44} tickFormatter={(v) => inrCompact(v)} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [inr(num(v)), n === "prev" ? "Prev. period" : "Revenue"]} />
        {prev && <Line type="monotone" dataKey="prev" stroke={C.prev} strokeWidth={2} dot={false} strokeDasharray="4 3" />}
        <Bar dataKey={valueKey} radius={[4, 4, 0, 0]} maxBarSize={34}>
          {merged.map((d, i) => (
            <Cell key={i} fill={currentKey && d.label === currentKey ? "#065f46" : d.revenue > 0 ? C.revenue : "#e2e8f0"} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Sparkline for KPI tiles ─────────────────────────────────────────────────
export function Sparkline({ values, color = C.revenue, height = 40 }: { values: number[]; color?: string; height?: number }) {
  const data = (values ?? []).map((v, i) => ({ v: Number.isFinite(v) ? v : 0, i }));
  if (data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#spark-${color})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Donut (payment mix, composition) ────────────────────────────────────────
export function Donut({
  data, height = 200, centerLabel, centerValue,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number; centerLabel?: string; centerValue?: string;
}) {
  // Drop non-positive / non-finite slices — a pie of them renders as a NaN-labelled blank.
  const clean = data.filter(d => Number.isFinite(d.value) && d.value > 0);
  const total = clean.reduce((s, d) => s + d.value, 0);
  if (clean.length === 0) return <ChartEmpty msg="Nothing to show for this period" />;
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={clean} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
            {clean.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle}
            formatter={(v: any, n: any) => [`${inr(v)} · ${total > 0 ? Math.round((num(v) / total) * 100) : 0}%`, n]} />
        </PieChart>
      </ResponsiveContainer>
      {(centerValue || centerLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue && <span className="text-[16px] font-black text-slate-800 tabular-nums">{centerValue}</span>}
          {centerLabel && <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Horizontal bars (top medicines, top customers, categories) ──────────────
export function HBars({
  data, height = 220, valueFormatter = inrCompact, color = C.inventory, onClick,
}: {
  data: { label: string; value: number }[];
  height?: number; valueFormatter?: (n: number) => string; color?: string;
  onClick?: (label: string) => void;
}) {
  const clean = data.filter(d => d && typeof d.label === "string" && Number.isFinite(d.value));
  if (clean.length === 0) return <ChartEmpty msg="No data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={clean} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" axisLine={false} tickLine={false}
          tick={{ fill: "#475569", fontSize: 11 }} width={112} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f8fafc" }} formatter={(v: any) => valueFormatter(num(v))} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16} fill={color}
          onClick={onClick ? (d: any) => onClick(d.label) : undefined}
          className={onClick ? "cursor-pointer" : undefined} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Stacked bars (GST heads over months, new vs returning customers) ────────
export function StackedBars({
  data, series, height = 240, currency = true,
}: {
  data: Record<string, any>[];
  series: { key: string; name: string; color: string }[];
  height?: number; currency?: boolean;
}) {
  if (!data || data.length === 0) return <ChartEmpty msg="No data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: C.axis, fontSize: 10 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: C.axis, fontSize: 10 }} width={44}
          tickFormatter={(v) => (currency ? inrCompact(v) : String(v))} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [currency ? inr(v) : num(v), n]} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={40} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Legend chip row ─────────────────────────────────────────────────────────
export function LegendRow({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />
          <span className="text-[11px] text-slate-500">{it.label}</span>
          {it.value && <span className="text-[11px] font-bold text-slate-700 tabular-nums">{it.value}</span>}
        </div>
      ))}
    </div>
  );
}
