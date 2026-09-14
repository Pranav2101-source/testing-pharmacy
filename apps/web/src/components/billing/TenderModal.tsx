import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { api } from "@/lib/api-client";
import { Banknote, Smartphone, CreditCard, Clock3, PiggyBank, X } from "lucide-react";
import type { PaymentModeCode, Tender } from "./useBillingStore";
import { cn } from "@/lib/utils";

type ModeSpec = {
  code: PaymentModeCode;
  label: string;
  icon: React.ElementType;
  takesReference: boolean;
  /** Nothing can be charged to, or drawn from, an account with nobody attached to it. */
  needsCustomer: boolean;
};

const MODES: ModeSpec[] = [
  { code: "CASH",    label: "Cash",       icon: Banknote,   takesReference: false, needsCustomer: false },
  { code: "UPI",     label: "UPI",        icon: Smartphone, takesReference: true,  needsCustomer: false },
  { code: "CARD",    label: "Card",       icon: CreditCard, takesReference: true,  needsCustomer: false },
  { code: "CREDIT",  label: "On account", icon: Clock3,     takesReference: false, needsCustomer: true  },
  { code: "ADVANCE", label: "Advance",    icon: PiggyBank,  takesReference: false, needsCustomer: true  },
];

/** Money in, money out, in whole paise — so 0.1 + 0.2 never leaves a stray remainder. */
const paise = (rupees: number) => Math.round(rupees * 100);

/**
 * Splits one bill across several ways of paying.
 *
 * <p>The dialog's whole job is to make the legs add up to the bill before it will let
 * the cashier out, because the server refuses any split that does not — and refusing at
 * the counter, where the amounts can still be typed, is far kinder than refusing at save
 * time with a queue waiting.
 *
 * <p>Two legs move no money at the till, in opposite directions. "On account" is what the
 * customer will owe; "Advance" is money they already handed over on an earlier day, and is
 * capped at what is actually being held for them. Keeping both in the same list is what
 * lets the running total mean "every rupee of this bill is accounted for" rather than
 * "every rupee that happened to arrive".
 */
export function TenderModal({
  total,
  initial,
  hasCustomer,
  customerId,
  advanceAvailable = 0,
  onClose,
  onConfirm,
}: {
  total: number;
  initial: Tender[];
  /** Whether a customer is attached — nothing can go on account without one to bill. */
  hasCustomer: boolean;
  /** The attached customer, used to re-read their deposit when this opens. */
  customerId?: string;
  /** Deposit held for the attached customer, as last known; the ceiling on the Advance leg. */
  advanceAvailable?: number;
  onClose: () => void;
  onConfirm: (tenders: Tender[]) => void;
}) {
  // Amounts are held as strings so a half-typed "1" on the way to "100" does not get
  // normalised out from under the cursor.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const t of initial) seed[t.mode] = String(t.amount);
    return seed;
  });
  const [references, setReferences] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const t of initial) if (t.reference) seed[t.mode] = t.reference;
    return seed;
  });

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { firstFieldRef.current?.focus(); firstFieldRef.current?.select(); }, []);

  // The deposit figure carried in on the bill is only as fresh as the moment the
  // customer was picked — and that can be a long time ago, or another session
  // entirely: a parked draft resumed the next morning, a bill built from "repeat last
  // bill", or a second till that spent the same deposit in between. Re-read it when
  // this dialog opens, which is the one moment the number actually has to be right.
  //
  // Seeded with what the bill already knew so the field is usable immediately; the
  // fetch only ever corrects it. A failure leaves the seed in place — the server
  // enforces the real ceiling under the customer's row lock regardless.
  const [liveAdvance, setLiveAdvance] = useState(advanceAvailable);
  useEffect(() => {
    if (!customerId || customerId === "COUNTER") return;
    let cancelled = false;
    api.get(`/customers/${customerId}/balances`)
      .then((r) => { if (!cancelled) setLiveAdvance(Number(r.data.data.advance) || 0); })
      .catch(() => { /* keep the seeded figure; the server still has the last word */ });
    return () => { cancelled = true; };
  }, [customerId]);

  const legs = useMemo(
    () => MODES
      .map((m) => ({ mode: m.code, amount: Number(amounts[m.code] ?? "") || 0, reference: references[m.code]?.trim() }))
      .filter((l) => l.amount > 0),
    [amounts, references],
  );

  const allocated = legs.reduce((sum, l) => sum + paise(l.amount), 0);
  const remaining = paise(total) - allocated;
  const balanced = remaining === 0 && legs.length > 0;

  const modesNeedingCustomer = new Set(MODES.filter((m) => m.needsCustomer).map((m) => m.code));
  const needsCustomerLeg = !hasCustomer && legs.some((l) => modesNeedingCustomer.has(l.mode));

  // Checked here as well as on the server, which is where it is actually enforced under
  // the customer's row lock. Refusing at the counter, where the number can still be
  // retyped, beats refusing at save time with a queue waiting.
  const advanceLeg = paise(Number(amounts.ADVANCE ?? "") || 0);
  const advanceCap = paise(liveAdvance);
  const overAdvance = advanceLeg > advanceCap;

  const blocked = !balanced || needsCustomerLeg || overAdvance;

  function setAmount(mode: PaymentModeCode, value: string) {
    // Digits and at most one decimal point; a stray minus would flip a leg into a refund.
    if (value !== "" && !/^\d*\.?\d{0,2}$/.test(value)) return;
    setAmounts((prev) => ({ ...prev, [mode]: value }));
  }

  /**
   * Drop whatever is still unaccounted for into this leg — the common last keystroke.
   * Clamped for Advance: filling it past the deposit would produce a split the server
   * is certain to reject, which is a worse outcome than under-filling it.
   */
  function fillRemainder(mode: PaymentModeCode) {
    const current = paise(Number(amounts[mode] ?? "") || 0);
    const target = mode === "ADVANCE"
      ? Math.min(current + remaining, advanceCap)
      : current + remaining;
    setAmount(mode, target <= 0 ? "" : String(target / 100));
  }

  function confirm() {
    if (blocked) return;
    onConfirm(legs.map((l) => ({ mode: l.mode, amount: l.amount, reference: l.reference || undefined })));
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirm(); }
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        exit={{   opacity: 0, scale: 0.96, y: 12  }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="bg-slate-800 px-5 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">Split payment</p>
            <h3 className="text-white text-[17px] font-bold leading-tight mt-0.5">
              Bill total ₹{total.toFixed(2)}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 mt-0.5" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {MODES.map((m, index) => {
            const Icon = m.icon;
            // Advance is offered only when there is something to draw from — an enabled
            // field over a zero balance is an invitation to a rejected bill.
            const disabled = (m.needsCustomer && !hasCustomer)
              || (m.code === "ADVANCE" && advanceCap <= 0);
            return (
              <div key={m.code} className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 w-32 shrink-0">
                    <Icon className={cn("w-4 h-4", disabled ? "text-slate-300" : "text-slate-500")} />
                    <span className={cn("text-[13px] font-semibold", disabled ? "text-slate-300" : "text-slate-700")}>
                      {m.label}
                    </span>
                  </div>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]">₹</span>
                    <input
                      ref={index === 0 ? firstFieldRef : undefined}
                      inputMode="decimal"
                      disabled={disabled}
                      value={amounts[m.code] ?? ""}
                      onChange={(e) => setAmount(m.code, e.target.value)}
                      placeholder="0.00"
                      aria-label={`${m.label} amount`}
                      className="w-full border border-slate-200 rounded-lg pl-7 pr-3 py-2 text-[14px] font-semibold text-right
                                 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400
                                 disabled:bg-slate-50 disabled:text-slate-300"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={disabled || remaining === 0}
                    onClick={() => fillRemainder(m.code)}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-700 disabled:text-slate-300 w-14 text-left"
                  >
                    Rest
                  </button>
                </div>
                {m.takesReference && (Number(amounts[m.code] ?? "") || 0) > 0 && (
                  <input
                    value={references[m.code] ?? ""}
                    onChange={(e) => setReferences((prev) => ({ ...prev, [m.code]: e.target.value }))}
                    placeholder={m.code === "UPI" ? "UPI transaction id (optional)" : "Approval code (optional)"}
                    aria-label={`${m.label} reference`}
                    className="w-full ml-32 border border-slate-200 rounded-lg px-3 py-1.5 text-[12px]
                               focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    style={{ width: "calc(100% - 8rem)" }}
                  />
                )}
                {m.code === "ADVANCE" && hasCustomer && (
                  <p className="ml-32 text-[11px] text-slate-400">
                    {advanceCap > 0
                      ? `₹${liveAdvance.toFixed(2)} held on deposit`
                      : "No deposit held for this customer"}
                  </p>
                )}
              </div>
            );
          })}

          <div className={cn(
            "flex items-center justify-between rounded-xl px-4 py-3 mt-1",
            balanced ? "bg-emerald-50" : "bg-amber-50",
          )}>
            <span className={cn("text-[12px] font-bold uppercase tracking-wide",
              balanced ? "text-emerald-700" : "text-amber-700")}>
              {remaining === 0 ? "Fully allocated" : remaining > 0 ? "Still to allocate" : "Over-allocated by"}
            </span>
            <span className={cn("text-[15px] font-bold tabular-nums",
              balanced ? "text-emerald-700" : "text-amber-700")}>
              ₹{Math.abs(remaining / 100).toFixed(2)}
            </span>
          </div>

          {needsCustomerLeg && (
            <p className="text-[12px] text-rose-600 font-medium">
              Put a customer on this bill before charging any of it to an account or a deposit — both belong to somebody.
            </p>
          )}

          {overAdvance && (
            <p className="text-[12px] text-rose-600 font-medium">
              Only ₹{liveAdvance.toFixed(2)} is held on deposit — ₹{(advanceLeg / 100).toFixed(2)} cannot be drawn from it.
            </p>
          )}
        </div>

        <div className="px-5 py-4 bg-slate-50 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onConfirm([])}
            className="text-[13px] font-semibold text-slate-500 hover:text-slate-700"
          >
            Clear split
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={blocked}
              className="px-4 py-2 rounded-lg text-[13px] font-bold text-white bg-blue-600 hover:bg-blue-700
                         disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Apply split
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
