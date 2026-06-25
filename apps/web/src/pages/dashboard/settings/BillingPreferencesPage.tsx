import { motion, AnimatePresence } from "framer-motion";
import {
  Pin, PinOff, ChevronUp, ChevronDown, RotateCcw, Info,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useBillingPreferences,
  ACTION_DEF_MAP,
  ACTION_DEFS,
} from "@/lib/billingPreferences";
import type { ActionId, BillingActionPref } from "@/lib/billingPreferences";
import { useState } from "react";

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-bold text-slate-800">{title}</h2>
          {badge && (
            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
              {badge}
            </span>
          )}
        </div>
        <p className="text-[12px] text-slate-400 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ─── Action row ───────────────────────────────────────────────────────────────

function ActionRow({
  pref,
  index,
  total,
  canPin,
  showPinControl,
  onToggleEnabled,
  onTogglePinned,
  onMove,
}: {
  pref: BillingActionPref;
  index: number;
  total: number;
  canPin: boolean;
  showPinControl: boolean;
  onToggleEnabled: (id: ActionId) => void;
  onTogglePinned: (id: ActionId) => void;
  onMove: (id: ActionId, dir: "up" | "down") => void;
}) {
  const def = ACTION_DEF_MAP[pref.id];
  const Icon = def.icon;

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 350, damping: 28 }}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors",
        pref.enabled
          ? "bg-white border-slate-200 hover:border-slate-300"
          : "bg-slate-50 border-slate-150 opacity-60"
      )}
    >
      {/* Icon */}
      <span className={cn(
        "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-opacity",
        def.iconBg,
        !pref.enabled && "grayscale"
      )}>
        <Icon className={cn("w-4 h-4", def.iconColor)} strokeWidth={2} />
      </span>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn(
            "text-[13px] font-semibold leading-tight",
            pref.enabled ? "text-slate-800" : "text-slate-400"
          )}>
            {def.label}
          </p>
          {def.shortcut && (
            <kbd className="text-[9px] bg-slate-100 text-slate-400 rounded px-1.5 py-0.5 font-mono leading-none">
              {def.shortcut}
            </kbd>
          )}
          {showPinControl && pref.pinned && pref.enabled && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
              <Pin className="w-2.5 h-2.5" strokeWidth={2.5} />
              Pinned
            </span>
          )}
        </div>
        <p className={cn(
          "text-[11px] mt-0.5 leading-tight",
          pref.enabled ? "text-slate-400" : "text-slate-300"
        )}>
          {def.description}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Pin / Unpin — only for extended actions */}
        {showPinControl && pref.enabled && (
          <button
            onClick={() => onTogglePinned(pref.id)}
            disabled={!canPin && !pref.pinned}
            title={
              pref.pinned
                ? "Remove from Save dropdown"
                : canPin
                  ? "Pin to Save dropdown"
                  : "Save dropdown is full (max 5 pinned actions)"
            }
            className={cn(
              "flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2.5 py-1.5 border transition-colors",
              pref.pinned
                ? "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
                : canPin
                  ? "bg-white text-slate-400 border-slate-200 hover:bg-slate-50 hover:text-slate-600"
                  : "bg-white text-slate-200 border-slate-150 cursor-not-allowed"
            )}
          >
            {pref.pinned ? (
              <>
                <PinOff className="w-3 h-3" strokeWidth={2} />
                Unpin
              </>
            ) : (
              <>
                <Pin className="w-3 h-3" strokeWidth={2} />
                Pin
              </>
            )}
          </button>
        )}

        {/* Up / Down reorder */}
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => onMove(pref.id, "up")}
            disabled={index === 0}
            title="Move up"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronUp className="w-3 h-3" strokeWidth={2.5} />
          </button>
          <button
            onClick={() => onMove(pref.id, "down")}
            disabled={index === total - 1}
            title="Move down"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronDown className="w-3 h-3" strokeWidth={2.5} />
          </button>
        </div>

        {/* Enable / Disable toggle */}
        <button
          onClick={() => onToggleEnabled(pref.id)}
          title={pref.enabled ? "Disable action" : "Enable action"}
          className={cn(
            "relative w-9 h-5 rounded-full flex-shrink-0 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
            pref.enabled ? "bg-blue-600" : "bg-slate-200"
          )}
          role="switch"
          aria-checked={pref.enabled}
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 600, damping: 36 }}
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm",
              pref.enabled ? "left-[18px]" : "left-0.5"
            )}
          />
        </button>
      </div>
    </motion.div>
  );
}

// ─── Preview pill ─────────────────────────────────────────────────────────────

function SaveDropdownPreview({ pinnedActions }: { pinnedActions: BillingActionPref[] }) {
  const visible = pinnedActions.slice(0, 5);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-lg p-1.5 w-52 space-y-0.5">
      {visible.length === 0 ? (
        <p className="text-[11px] text-slate-300 text-center py-3">No pinned actions</p>
      ) : (
        visible.map((pref) => {
          const def = ACTION_DEF_MAP[pref.id];
          const Icon = def.icon;
          return (
            <div key={pref.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-50">
              <span className={cn("w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0", def.iconBg)}>
                <Icon className={cn("w-3 h-3", def.iconColor)} strokeWidth={2} />
              </span>
              <span className="text-[12px] font-semibold text-slate-700 flex-1 truncate">{def.label}</span>
              {def.shortcut && (
                <kbd className="text-[9px] bg-slate-100 text-slate-400 rounded px-1 py-0.5 font-mono leading-none">{def.shortcut}</kbd>
              )}
            </div>
          );
        })
      )}
      <div className="mx-2 border-t border-slate-100" />
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl">
        <span className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
          <span className="text-[9px] font-bold text-slate-400">···</span>
        </span>
        <span className="text-[11px] text-slate-400 font-medium">More Actions</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BillingPreferencesPage() {
  const {
    sortedActions,
    pinnedActions,
    moreActions,
    toggleEnabled,
    togglePinned,
    moveAction,
    resetToDefaults,
  } = useBillingPreferences();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [saved, setSaved] = useState(false);

  const corePinned     = pinnedActions.filter((a) => ACTION_DEF_MAP[a.id].category === "core");
  const extendedPinned = pinnedActions.filter((a) => ACTION_DEF_MAP[a.id].category === "extended");
  const totalPinned    = pinnedActions.length;
  const canPin         = totalPinned < 5;

  const allExtended = sortedActions.filter((a) => ACTION_DEF_MAP[a.id].category === "extended");
  const coreActions = sortedActions.filter((a) => ACTION_DEF_MAP[a.id].category === "core");

  const handleToggleEnabled = (id: ActionId) => {
    toggleEnabled(id);
    flashSaved();
  };
  const handleTogglePinned = (id: ActionId) => {
    togglePinned(id);
    flashSaved();
  };
  const handleMove = (id: ActionId, dir: "up" | "down") => {
    moveAction(id, dir);
    flashSaved();
  };

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function handleReset() {
    resetToDefaults();
    setShowResetConfirm(false);
    flashSaved();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">Billing Preferences</h1>
            <p className="text-[13px] text-slate-400 mt-1">
              Configure which save actions appear in the billing screen and how they are ordered.
              Changes take effect immediately for all staff on this device.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <AnimatePresence>
              {saved && (
                <motion.span
                  initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Saved
                </motion.span>
              )}
            </AnimatePresence>

            {!showResetConfirm ? (
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to defaults
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-slate-500">Reset all preferences?</span>
                <button
                  onClick={handleReset}
                  className="text-[12px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Yes, reset
                </button>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="text-[12px] text-slate-500 hover:text-slate-700 px-2 py-1.5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
          <p className="text-[12px] text-blue-700 leading-relaxed">
            <strong>Pinned actions</strong> appear directly in the Save dropdown for one-click access.
            Unpinned-but-enabled actions are available under <strong>More Actions</strong>.
            Disabled actions are hidden from the billing screen entirely.
            The Save dropdown supports up to <strong>5 pinned actions</strong>.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Left: config panels */}
          <div className="xl:col-span-2 space-y-6">

            {/* Save Dropdown — core actions */}
            <section className="bg-slate-50 rounded-2xl p-5">
              <SectionHeader
                title="Save Dropdown — Core Actions"
                description="These actions are always available in the Save dropdown. You can disable them but not remove them entirely."
                badge="Always pinned"
              />
              <div className="space-y-2">
                {coreActions.map((pref, i) => (
                  <ActionRow
                    key={pref.id}
                    pref={pref}
                    index={i}
                    total={coreActions.length}
                    canPin={canPin}
                    showPinControl={false}
                    onToggleEnabled={handleToggleEnabled}
                    onTogglePinned={handleTogglePinned}
                    onMove={handleMove}
                  />
                ))}
              </div>
            </section>

            {/* More Actions */}
            <section className="bg-slate-50 rounded-2xl p-5">
              <SectionHeader
                title="More Actions"
                description={`Extended actions visible under "+ More Actions". Pin up to ${5 - corePinned.length - extendedPinned.length} more to the Save dropdown (${totalPinned}/5 pinned).`}
              />
              <div className="space-y-2">
                {allExtended.map((pref, i) => (
                  <ActionRow
                    key={pref.id}
                    pref={pref}
                    index={i}
                    total={allExtended.length}
                    canPin={canPin}
                    showPinControl
                    onToggleEnabled={handleToggleEnabled}
                    onTogglePinned={handleTogglePinned}
                    onMove={handleMove}
                  />
                ))}
              </div>
            </section>
          </div>

          {/* Right: live preview */}
          <aside className="xl:col-span-1">
            <div className="sticky top-6 space-y-4">
              <div className="bg-slate-50 rounded-2xl p-5">
                <p className="text-[13px] font-bold text-slate-700 mb-1">Save Dropdown Preview</p>
                <p className="text-[11px] text-slate-400 mb-4">
                  Live preview of how the Save dropdown will look in the billing screen.
                </p>
                <SaveDropdownPreview pinnedActions={pinnedActions} />
              </div>

              {/* Summary stats */}
              <div className="bg-slate-50 rounded-2xl p-5 space-y-3">
                <p className="text-[13px] font-bold text-slate-700">Summary</p>
                <div className="space-y-2">
                  {[
                    {
                      label: "Pinned in Save dropdown",
                      value: `${pinnedActions.length} / 5`,
                      color: pinnedActions.length >= 5 ? "text-amber-600" : "text-emerald-600",
                    },
                    {
                      label: "In More Actions panel",
                      value: moreActions.length,
                      color: "text-blue-600",
                    },
                    {
                      label: "Disabled / hidden",
                      value: sortedActions.filter((a) => !a.enabled).length,
                      color: "text-slate-400",
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between text-[12px]">
                      <span className="text-slate-500">{label}</span>
                      <span className={cn("font-bold", color)}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Keyboard shortcuts reference */}
              <div className="bg-slate-50 rounded-2xl p-5 space-y-2">
                <p className="text-[13px] font-bold text-slate-700 mb-3">Keyboard Shortcuts</p>
                {ACTION_DEFS.filter((d) => d.shortcut).map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-[12px]">
                    <span className="text-slate-500">{d.label}</span>
                    <kbd className="text-[9px] bg-white border border-slate-200 text-slate-500 rounded px-2 py-1 font-mono shadow-sm">
                      {d.shortcut}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
