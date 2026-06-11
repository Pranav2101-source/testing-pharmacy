"use client";

import { format } from "date-fns";
import { Calendar, Stethoscope, ChevronDown, FileText } from "lucide-react";
import { useBillingStore } from "./useBillingStore";
import { CustomerSearchCombobox } from "./CustomerSearchCombobox";

// Computed once per session — bill date never changes mid-session
const TODAY_LABEL = format(new Date(), "dd/MM/yyyy");

const BILLING_FOR_OPTIONS = ["Self", "Counter", "Credit", "Insurance"] as const;

function Divider() {
  return <div className="w-px self-stretch bg-slate-200 flex-shrink-0" />;
}

export function BillHeader() {
  const paymentStatus  = useBillingStore((s) => s.meta.paymentStatus);
  const doctorName     = useBillingStore((s) => s.meta.doctorName);
  const prescriptionId = useBillingStore((s) => s.meta.prescriptionId);
  const setMeta        = useBillingStore((s) => s.setMeta);

  return (
    <div
      className="flex items-stretch border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto no-scrollbar"
      style={{ minHeight: "var(--header-height, 60px)", maxHeight: "var(--header-height, 60px)" }}
    >

      {/* Bill Date — neutral, understated */}
      <div className="flex items-center gap-2.5 px-4 py-2 flex-shrink-0 min-w-[156px] bg-slate-50 border-r border-slate-200">
        <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1">
            Bill Date
          </p>
          <button className="flex items-center gap-1 group">
            <span className="text-[14px] font-bold text-slate-800 tabnum leading-none">
              {TODAY_LABEL}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-300 group-hover:text-slate-600 transition-colors" />
          </button>
        </div>
      </div>

      {/* Customer — visually dominant; this is the primary first action */}
      <div className="flex items-center px-3.5 py-2 flex-1 min-w-[280px] relative">
        <CustomerSearchCombobox />
      </div>

      <Divider />

      {/* Billing For */}
      <div className="flex items-center px-4 py-2 flex-shrink-0 min-w-[140px]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Billing for
          </p>
          <div className="relative flex items-center">
            <select
              value={
                paymentStatus === "PAID"    ? "Self"      :
                paymentStatus === "PENDING" ? "Credit"    :
                paymentStatus === "PARTIAL" ? "Insurance" : "Counter"
              }
              onChange={(e) => {
                const map: Record<string, "PAID" | "PENDING" | "PARTIAL"> = {
                  Self: "PAID", Counter: "PAID", Credit: "PENDING", Insurance: "PARTIAL",
                };
                setMeta({ paymentStatus: map[e.target.value] ?? "PAID" });
              }}
              className="text-[13px] font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer appearance-none pr-4 leading-none"
            >
              {BILLING_FOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 pointer-events-none absolute right-0" />
          </div>
        </div>
      </div>

      <Divider />

      {/* Doctor */}
      <div className="flex items-center gap-2.5 px-4 py-2 flex-1 min-w-[180px] input-glow glow-focus">
        <Stethoscope className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Doctor
          </p>
          <input
            type="text"
            value={doctorName}
            onChange={(e) => setMeta({ doctorName: e.target.value })}
            placeholder="Name / Lic No."
            autoComplete="off"
            className="w-full text-[13px] font-medium text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none leading-none"
          />
        </div>
      </div>

      <Divider />

      {/* Prescription / Rx No. */}
      <div className="flex items-center gap-2.5 px-4 py-2 flex-shrink-0 min-w-[160px] input-glow glow-focus">
        <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Rx No.
          </p>
          <input
            type="text"
            value={prescriptionId}
            onChange={(e) => setMeta({ prescriptionId: e.target.value })}
            placeholder="Prescription no."
            autoComplete="off"
            className="w-full text-[13px] font-medium text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none leading-none"
          />
        </div>
      </div>

    </div>
  );
}
