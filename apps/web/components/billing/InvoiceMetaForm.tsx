"use client";
import { useBillingStore } from "./useBillingStore";

const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CREDIT"] as const;
const PAYMENT_STATUSES = ["PAID", "PENDING", "PARTIAL"] as const;

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent";

export function InvoiceMetaForm() {
  const meta = useBillingStore((s) => s.meta);
  const setMeta = useBillingStore((s) => s.setMeta);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Patient Name
          </label>
          <input
            type="text"
            value={meta.customerName}
            onChange={(e) => setMeta({ customerName: e.target.value })}
            placeholder="Optional"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Phone
          </label>
          <input
            type="tel"
            value={meta.customerPhone}
            onChange={(e) => setMeta({ customerPhone: e.target.value })}
            placeholder="Optional"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Doctor Name
        </label>
        <input
          type="text"
          value={meta.doctorName}
          onChange={(e) => setMeta({ doctorName: e.target.value })}
          placeholder="Dr. (optional)"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Payment Mode
          </label>
          <select
            value={meta.paymentMode}
            onChange={(e) => setMeta({ paymentMode: e.target.value as typeof meta.paymentMode })}
            className={inputCls}
          >
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Status
          </label>
          <select
            value={meta.paymentStatus}
            onChange={(e) => setMeta({ paymentStatus: e.target.value as typeof meta.paymentStatus })}
            className={inputCls}
          >
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Notes
        </label>
        <textarea
          rows={2}
          value={meta.notes}
          onChange={(e) => setMeta({ notes: e.target.value })}
          placeholder="Optional notes..."
          className={`${inputCls} resize-none`}
        />
      </div>
    </div>
  );
}
