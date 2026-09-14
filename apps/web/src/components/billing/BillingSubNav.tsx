import { memo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight, ChevronDown,
  Loader2, MoreHorizontal, Pin, Receipt,
  Banknote, Smartphone, CreditCard, Clock3, Split,
} from "lucide-react";
import { useBillingPreferences, ACTION_DEF_MAP } from "@/lib/billingPreferences";
import type { ActionId } from "@/lib/billingPreferences";
import type { PaymentModeCode, Tender } from "./useBillingStore";
import { cn } from "@/lib/utils";
import { KeyboardShortcutsPanel } from "./KeyboardShortcutsPanel";

// ─── Payment mode metadata ────────────────────────────────────────────────────

// Covers every mode a tender leg can carry, including ADVANCE — which the split pill
// has to be able to name even though it is deliberately absent from the one-key
// segmented control below: spending a deposit needs a customer and a balance to spend,
// neither of which a single button can check.
const PAY_LABELS: Record<PaymentModeCode, string> = {
  CASH: "Cash", UPI: "UPI", CARD: "Card", CREDIT: "Credit", ADVANCE: "Advance",
};
const PAY_ICONS: Record<"CASH" | "UPI" | "CARD" | "CREDIT", React.ElementType> = {
  CASH: Banknote, UPI: Smartphone, CARD: CreditCard, CREDIT: Clock3,
};
const PAY_SHORTCUTS: Record<string, string> = { CASH: "1", UPI: "2", CARD: "3", CREDIT: "4" };

// ─── SaveDropdown ─────────────────────────────────────────────────────────────

export const SaveDropdown = memo(function SaveDropdown({
  onAction,
  submitting,
  hasItems,
}: {
  onAction: (id: ActionId) => void;
  submitting: boolean;
  hasItems: boolean;
}) {
  const { pinnedActions, moreActions } = useBillingPreferences();
  const [showDrop, setShowDrop] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
      setShowDrop(false);
      setShowMore(false);
    }
  }, []);

  const handleAction = useCallback((id: ActionId) => {
    setShowDrop(false);
    setShowMore(false);
    onAction(id);
  }, [onAction]);

  const primaryId: ActionId = pinnedActions[0]?.id ?? "save_print";
  const primaryDef = ACTION_DEF_MAP[primaryId];

  return (
    <div ref={wrapRef} className="relative flex items-stretch" onBlur={handleBlur}>
      {/* Primary save button */}
      <button
        onClick={() => hasItems && onAction(primaryId)}
        disabled={submitting || !hasItems}
        title={`${primaryDef.label}${primaryDef.shortcut ? ` (${primaryDef.shortcut})` : ""}`}
        className={cn(
          "flex items-center gap-1.5 text-[13px] font-bold px-4 py-2 rounded-l-lg transition-colors active:scale-[0.98]",
          hasItems ? "bg-purple-700 hover:bg-purple-800 text-white" : "bg-purple-300 text-white cursor-not-allowed",
        )}
      >
        {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Save
        {primaryDef.shortcut && (
          <kbd className={cn(
            "text-[9px] rounded px-1 py-0.5 font-mono leading-none ml-0.5",
            hasItems ? "bg-white/20 text-white/70" : "bg-white/10 text-white/40",
          )}>
            {primaryDef.shortcut}
          </kbd>
        )}
      </button>

      {/* Dropdown chevron */}
      <button
        onClick={() => { if (!hasItems) return; setShowMore(false); setShowDrop((v) => !v); }}
        aria-haspopup="menu"
        aria-expanded={showDrop}
        className={cn(
          "flex items-center justify-center px-1.5 rounded-r-lg border-l transition-colors",
          hasItems
            ? "bg-purple-700 hover:bg-purple-800 text-white border-purple-600"
            : "bg-purple-300 text-white border-purple-200 cursor-not-allowed",
        )}
      >
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-150", showDrop && "rotate-180")} />
      </button>

      {/* Main dropdown */}
      <AnimatePresence>
        {showDrop && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: -4,  scale: 0.97 }}
            transition={{ duration: 0.13, ease: "easeOut" }}
            className="absolute top-full right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-2xl z-40 overflow-hidden"
            style={{ minWidth: "220px", boxShadow: "0 20px 48px -8px rgba(0,0,0,0.20), 0 4px 16px -4px rgba(0,0,0,0.10)" }}
          >
            {/* Pinned actions */}
            {pinnedActions.length > 0 && (
              <div className="p-1.5 space-y-0.5">
                {pinnedActions.map((pref) => {
                  const def  = ACTION_DEF_MAP[pref.id];
                  const Icon = def.icon;
                  return (
                    <button
                      key={pref.id}
                      role="menuitem"
                      onClick={() => handleAction(pref.id)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[12px] text-slate-700 hover:bg-slate-50 transition-colors group"
                    >
                      <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", def.iconBg)}>
                        <Icon className={cn("w-3.5 h-3.5", def.iconColor)} strokeWidth={2} />
                      </span>
                      <span className="font-semibold flex-1 text-left">{def.label}</span>
                      {def.shortcut && (
                        <kbd className="text-[10px] font-mono bg-slate-100 text-slate-400 rounded px-1.5 py-0.5">{def.shortcut}</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* More actions */}
            {moreActions.length > 0 && (
              <div className="border-t border-slate-100">
                <button
                  onClick={() => setShowMore((v) => !v)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-[11px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                  <span>More actions</span>
                  <ChevronDown className={cn("w-3 h-3 ml-auto transition-transform", showMore && "rotate-180")} />
                </button>
                <AnimatePresence>
                  {showMore && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="px-1.5 pb-1.5 space-y-0.5">
                        {moreActions.map((pref) => {
                          const def  = ACTION_DEF_MAP[pref.id];
                          const Icon = def.icon;
                          return (
                            <button
                              key={pref.id}
                              role="menuitem"
                              onClick={() => handleAction(pref.id)}
                              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[12px] text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", def.iconBg)}>
                                <Icon className={cn("w-3.5 h-3.5", def.iconColor)} strokeWidth={2} />
                              </span>
                              <span className="font-semibold flex-1 text-left">{def.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Manage link */}
            <div className="mx-3 mb-2 border-t border-slate-100 pt-1.5">
              <Link
                to="/dashboard/settings/billing"
                onClick={() => { setShowDrop(false); setShowMore(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Pin className="w-3 h-3" strokeWidth={1.8} />
                Pin / manage actions
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── BillingSubNav ────────────────────────────────────────────────────────────

export const BillingSubNav = memo(function BillingSubNav({
  onAction,
  submitting,
  hasItems,
  paymentMode,
  onPaymentMode,
  tenders,
  onSplitPayment,
  isInterstate,
  onInterstate,
  lifa,
  onLifaToggle,
  strategySaving = false,
  strategyLocked = false,
}: {
  onAction:      (id: ActionId) => void;
  submitting:    boolean;
  hasItems:      boolean;
  /** Any leg mode can end up here as the dominant one, ADVANCE included. */
  paymentMode:   PaymentModeCode;
  /** Narrower than `paymentMode` on purpose: only the four one-key modes are selectable. */
  onPaymentMode: (m: "CASH" | "UPI" | "CARD" | "CREDIT") => void;
  /** The legs this bill is split across; empty means the single mode above covers it. */
  tenders:       Tender[];
  onSplitPayment: () => void;
  isInterstate:  boolean;
  onInterstate:  (v: boolean) => void;
  /** Persisted pharmacy setting (default LILA/FEFO) — the backend engine orders batches, this just reflects it. */
  lifa:          boolean;
  onLifaToggle:  () => void;
  /** True while the setting is being saved. */
  strategySaving?: boolean;
  /** True when the current user may not change shop policy (cashier / pharmacist). */
  strategyLocked?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 flex-shrink-0 border-b border-slate-200 bg-white"
      style={{ height: "var(--subnav-height, 44px)" }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5">
        <Link to="/dashboard/billing" className="flex items-center gap-1.5 text-[13px] text-slate-400 font-medium hover:text-blue-600 transition-colors">
          <Receipt className="w-3.5 h-3.5" strokeWidth={1.8} />
          Sales
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
        <span className="text-[14px] text-slate-800 font-bold">New Bill</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <KeyboardShortcutsPanel />

        <div className="h-5 w-px bg-slate-200 mx-0.5" />

        {/* LIFA / LILA — pharmacy-wide batch-selection strategy. The backend
            dispensing engine decides the actual batch order for every flow; this
            toggles the saved setting (owners/managers only). */}
        <div className="flex items-center gap-1.5 group/lifa">
          <button
            onClick={onLifaToggle}
            disabled={strategyLocked || strategySaving}
            title={strategyLocked
              ? `Batch strategy: ${lifa ? "LIFA — newest batch first" : "LILA/FEFO — oldest batch first (default)"}. Only an owner or manager can change this.`
              : lifa
                ? "LIFA — newest received batch dispensed first. Click to switch back to LILA/FEFO (recommended)."
                : "LILA / FEFO — oldest (soonest-expiring) batch dispensed first. The safe default. Click to switch to LIFA."}
            className={cn(
              "text-[12px] font-bold px-2.5 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1",
              (strategyLocked || strategySaving) && "opacity-60 cursor-not-allowed",
              lifa
                ? "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100"
                : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
            )}
          >
            {strategySaving && <Loader2 className="w-3 h-3 animate-spin" />}
            {lifa ? "LIFA" : "LILA"}
          </button>
          <span className="hidden group-hover/lifa:block text-[10px] text-slate-400 font-medium whitespace-nowrap">
            {lifa ? "newest batch first" : "oldest batch first (default)"}
          </span>
        </div>

        <div className="h-5 w-px bg-slate-200 mx-0.5" />

        {/* Payment mode — segmented control. Replaced by a summary while the bill is
            split, because no single segment is true of a bill paid two ways, and a
            highlighted "Cash" on a half-UPI bill is a worse answer than none. */}
        {tenders.length > 0 ? (
          <button
            onClick={onSplitPayment}
            title="Edit the payment split (F7)"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-bold
                       bg-violet-50 text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100
                       transition-colors duration-100"
          >
            <Split className="w-3.5 h-3.5" strokeWidth={2.3} />
            {tenders.map((t) => `${PAY_LABELS[t.mode]} ₹${t.amount}`).join("  +  ")}
          </button>
        ) : (
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            {(["CASH", "UPI", "CARD", "CREDIT"] as const).map((m) => {
              const Icon   = PAY_ICONS[m];
              const active = paymentMode === m;
              return (
                <button
                  key={m}
                  onClick={() => onPaymentMode(m)}
                  title={`${PAY_LABELS[m]} (Alt+${PAY_SHORTCUTS[m]})`}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all duration-100",
                    active
                      ? "bg-white text-blue-700 shadow-sm ring-1 ring-blue-200/80"
                      : "text-slate-500 hover:text-slate-700 hover:bg-white/60",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={active ? 2.3 : 1.8} />
                  {PAY_LABELS[m]}
                </button>
              );
            })}
            <button
              onClick={onSplitPayment}
              title="Split this bill across more than one way of paying (F7)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-bold
                         text-slate-500 hover:text-violet-700 hover:bg-white/60 transition-all duration-100"
            >
              <Split className="w-3.5 h-3.5" strokeWidth={1.8} />
              Split
            </button>
          </div>
        )}

        {/* Tax regime toggle */}
        <button
          onClick={() => onInterstate(!isInterstate)}
          title={isInterstate
            ? "Interstate — IGST applies. Click to switch to intra-state (CGST+SGST)"
            : "Intra-state — CGST+SGST. Click to switch to interstate (IGST)"}
          className={cn(
            "text-[12px] font-bold border rounded-lg px-3 py-1.5 transition-colors",
            isInterstate
              ? "bg-violet-600 text-white border-violet-600 hover:bg-violet-700"
              : "text-slate-600 border-slate-200 bg-slate-100 hover:bg-slate-200",
          )}
        >
          {isInterstate ? "IGST" : "CGST+SGST"}
        </button>

        <div className="h-5 w-px bg-slate-200 mx-0.5" />

        <SaveDropdown onAction={onAction} submitting={submitting} hasItems={hasItems} />
      </div>
    </div>
  );
});
