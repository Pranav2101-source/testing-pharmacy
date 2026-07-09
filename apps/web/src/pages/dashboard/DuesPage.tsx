import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, Loader2, AlertCircle, FileX, Phone, AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Dues ───────────────────────────────────────────────────────────────────
// One screen for "who owes whom": money we owe distributors (Payables) and
// money customers owe us on credit (Receivables). Read-only summary — the
// aggregates come straight from the supplier ledger and customer credit balances.

type Payable = {
  id: string; name: string; phone: string | null; creditDays: number;
  totalPurchased: number; totalPaid: number; outstanding: number; overdueAmount: number;
};
type PayablesResp = { suppliers: Payable[]; totalOutstanding: number; totalOverdue: number; count: number };

type Receivable = {
  id: string; name: string; phone: string | null; customerType: string;
  creditUsed: number; creditLimit: number;
};
type ReceivablesResp = { customers: Receivable[]; totalOutstanding: number; count: number };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

type Tab = "payables" | "receivables";

export default function DuesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(raw === "receivables" ? "receivables" : "payables");

  function go(t: Tab) {
    setTab(t);
    setSearchParams(t === "payables" ? {} : { tab: t }, { replace: true });
  }

  const payables = useQuery({
    queryKey: ["dues", "payables"],
    queryFn:  () => api.get<{ data: PayablesResp }>("/supplier-payments/outstanding").then((r) => r.data.data),
    staleTime: 30_000,
  });
  const receivables = useQuery({
    queryKey: ["dues", "receivables"],
    queryFn:  () => api.get<{ data: ReceivablesResp }>("/customers/outstanding").then((r) => r.data.data),
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 border-b border-slate-200 flex-shrink-0" style={{ height: "52px" }}>
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Wallet className="w-4 h-4 text-blue-600" />
        </div>
        <h1 className="text-[18px] font-bold text-slate-900 leading-none">Dues</h1>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 border-b border-slate-200 bg-white flex-shrink-0">
        <TabBtn active={tab === "payables"} onClick={() => go("payables")}
          icon={ArrowUpCircle} label="Payables" sub="We owe suppliers" color="rose" />
        <TabBtn active={tab === "receivables"} onClick={() => go("receivables")}
          icon={ArrowDownCircle} label="Receivables" sub="Customers owe us" color="emerald" />
      </div>

      <div className="flex-1 overflow-auto min-h-0 p-4">
        {tab === "payables"
          ? <PayablesView q={payables} />
          : <ReceivablesView q={receivables} />}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label, sub, color }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; sub: string;
  color: "rose" | "emerald";
}) {
  return (
    <button onClick={onClick}
      className={cn("flex items-center gap-2 px-4 py-2.5 border-b-2 transition-colors",
        active
          ? color === "rose" ? "border-rose-500 text-rose-600" : "border-emerald-500 text-emerald-600"
          : "border-transparent text-slate-500 hover:text-slate-700")}>
      <Icon className="w-4 h-4" />
      <span className="text-left leading-tight">
        <span className="block text-[13px] font-semibold">{label}</span>
        <span className="block text-[10px] text-slate-400">{sub}</span>
      </span>
    </button>
  );
}

function StateWrap({ loading, error, empty, emptyText, children }: {
  loading: boolean; error: boolean; empty: boolean; emptyText: string; children: React.ReactNode;
}) {
  if (loading) return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (error)   return <div className="py-24 text-center"><AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" /><p className="text-red-500 text-[13px]">Couldn't load. Please refresh.</p></div>;
  if (empty)   return <div className="py-24 text-center"><FileX className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-500 text-[14px] font-medium">{emptyText}</p></div>;
  return <>{children}</>;
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: "rose" | "emerald" | "amber" | "slate" }) {
  const tones = {
    rose:    "bg-rose-50 border-rose-200 text-rose-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber:   "bg-amber-50 border-amber-200 text-amber-700",
    slate:   "bg-slate-50 border-slate-200 text-slate-700",
  }[tone];
  return (
    <div className={cn("rounded-xl border px-4 py-3", tones)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-[20px] font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function PayablesView({ q }: { q: ReturnType<typeof useQuery<PayablesResp>> }) {
  const d = q.data;
  return (
    <div className="space-y-4">
      {d && d.count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryCard label="Total payable" value={inr(d.totalOutstanding)} tone="rose" />
          <SummaryCard label="Overdue" value={inr(d.totalOverdue)} tone="amber" />
          <SummaryCard label="Suppliers" value={String(d.count)} tone="slate" />
        </div>
      )}
      <StateWrap loading={q.isLoading} error={q.isError} empty={!!d && d.count === 0}
        emptyText="No outstanding supplier dues — you're all paid up.">
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Supplier", "Purchased", "Paid", "Outstanding", "Overdue"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d?.suppliers.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5">
                    <p className="text-[13px] font-semibold text-slate-800">{s.name}</p>
                    {s.phone && <p className="text-[11px] text-slate-400 flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{s.phone}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-500 tabular-nums">{inr(s.totalPurchased)}</td>
                  <td className="px-4 py-2.5 text-[13px] text-slate-500 tabular-nums">{inr(s.totalPaid)}</td>
                  <td className="px-4 py-2.5 text-[14px] font-bold text-rose-600 tabular-nums">{inr(s.outstanding)}</td>
                  <td className="px-4 py-2.5">
                    {s.overdueAmount > 0
                      ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><AlertTriangle className="w-3 h-3" />{inr(s.overdueAmount)}</span>
                      : <span className="text-slate-300 text-[12px]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateWrap>
    </div>
  );
}

function ReceivablesView({ q }: { q: ReturnType<typeof useQuery<ReceivablesResp>> }) {
  const d = q.data;
  return (
    <div className="space-y-4">
      {d && d.count > 0 && (
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <SummaryCard label="Total receivable" value={inr(d.totalOutstanding)} tone="emerald" />
          <SummaryCard label="Customers" value={String(d.count)} tone="slate" />
        </div>
      )}
      <StateWrap loading={q.isLoading} error={q.isError} empty={!!d && d.count === 0}
        emptyText="No customer dues — no outstanding credit sales.">
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Customer", "Credit limit", "Outstanding", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d?.customers.map((c) => {
                const overLimit = c.creditLimit > 0 && c.creditUsed >= c.creditLimit;
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <p className="text-[13px] font-semibold text-slate-800">{c.name}</p>
                      {c.phone && <p className="text-[11px] text-slate-400 flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{c.phone}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-500 tabular-nums">{c.creditLimit > 0 ? inr(c.creditLimit) : "—"}</td>
                    <td className="px-4 py-2.5 text-[14px] font-bold text-emerald-600 tabular-nums">{inr(c.creditUsed)}</td>
                    <td className="px-4 py-2.5">
                      {overLimit && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"><AlertTriangle className="w-3 h-3" />Over limit</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </StateWrap>
    </div>
  );
}
