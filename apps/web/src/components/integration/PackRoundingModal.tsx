import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Scissors, PackageCheck, X, Loader2 } from "lucide-react";
import type { ResolvedCart } from "@/lib/prescriptionToCart";

export type RoundedLine = ResolvedCart["roundedToPack"][number];

/** True for a line this modal can actually offer to fix — see prescriptionToCart.ts's own note
 *  on why a "Replace" substitute and a Schedule X medicine don't carry that option. */
function isCuttable(line: RoundedLine): boolean {
  return !!line.medicineId && !!line.unitsPerPack && line.unitsPerPack > 1
    && (line.schedule ?? "").trim().toUpperCase() !== "X";
}

/** Small inline shortcut badge — "Enter", "Shift+Enter", "Esc". Decorative, so screen readers
 *  read the button's own label and skip this; the real accessible action is still the click. */
function KeyHint({ children, onDark = false }: { children: string; onDark?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        "ml-1.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold tracking-wide " +
        (onDark ? "border-white/30 bg-white/10" : "border-slate-200 bg-slate-50 text-slate-500")
      }
    >
      {children}
    </span>
  );
}

/**
 * Stands in for the old {@code window.confirm(roundUpConfirmMessage(...))} — a native browser
 * dialog that could only ask "bill it this way?", so declining meant abandoning the whole
 * Bill/Draft action even when the real fix (turn loose selling on for this one medicine) was a
 * single click away.
 *
 * <p>Three real outcomes, not two: {@code onCutStrip} turns loose selling on for every cuttable
 * line here and re-resolves the cart so each one bills its EXACT prescribed count instead of a
 * rounded-up pack; {@code onBillAsPack} keeps today's behaviour (proceed with the pack-rounded
 * cart already computed); {@code onCancel} abandons the action entirely, same as Cancel always
 * did. A line the pharmacist cannot cut from here (a "Replace" substitute with no catalogue id,
 * or a Schedule X medicine that must legally stay sealed) is still named, just without the
 * button that would turn loose selling on for it.
 *
 * <h2>Keyboard-only</h2>
 * Every button here is a real {@code <button>}, so Tab/Shift+Tab already cycle between them and
 * a focused one already activates on Enter or Space — none of that needed writing. What was
 * actually missing for a mouse-free flow: nothing is focused the instant the modal opens (a bare
 * Enter press does nothing until the pharmacist Tabs somewhere first), there was no way to
 * dismiss with Escape, and reaching the SECOND option always cost a Tab first. All three are
 * fixed by autofocusing the primary action and handling Enter/Shift+Enter/Escape globally
 * while this is open — {@code preventDefault} on every Enter so this handler is the ONLY thing
 * that decides what fires, never racing a focused button's own native activation.
 */
export default function PackRoundingModal({
  lines,
  busy,
  onCutStrip,
  onBillAsPack,
  onCancel,
}: {
  lines: RoundedLine[];
  /** True while a chosen action (enabling loose selling + re-resolving) is in flight. */
  busy: boolean;
  onCutStrip: () => void;
  onBillAsPack: () => void;
  onCancel: () => void;
}) {
  const cuttable = lines.filter(isCuttable);
  const notCuttable = lines.filter((l) => !isCuttable(l));
  const many = lines.length > 1;
  // No cuttable line (every rounded line is a Replace-substitute or Schedule X) means there is
  // no "cut" button at all — Enter's job then falls to the only real action left besides Cancel.
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (busy) return; // a chosen action is already in flight — no new one can start
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Enter") return;
      // Decided entirely here, never left to whichever button happens to have focus — see the
      // class doc's "Keyboard-only" note on why every Enter is intercepted rather than some.
      e.preventDefault();
      if (e.shiftKey) {
        onBillAsPack();
      } else if (cuttable.length > 0) {
        onCutStrip();
      } else {
        onBillAsPack();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cuttable is derived fresh from
    // `lines` every render; re-subscribing on every keystroke-irrelevant render is unnecessary.
  }, [busy, onCutStrip, onBillAsPack, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4 relative border-b border-slate-100">
          <button
            onClick={onCancel}
            disabled={busy}
            title="Esc"
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors p-1 disabled:opacity-40"
          >
            <X className="w-4.5 h-4.5" />
          </button>
          <h2 className="text-[16px] font-bold text-slate-800 pr-6">
            {many ? "These medicines need a full strip" : "This medicine needs a full strip"}
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            {many ? "None of these can be cut here yet" : "This pharmacy can't cut this one yet"} — the prescribed
            amount falls short of a full pack. Cut a strip instead, or bill the full pack (the patient pays for
            the extra).
          </p>
        </div>

        <div className="px-5 py-4 space-y-2 max-h-64 overflow-y-auto">
          {lines.map((line, i) => (
            <div
              key={i}
              className="rounded-lg border border-slate-150 bg-slate-50 px-3 py-2.5"
            >
              <p className="text-[13.5px] font-semibold text-slate-800">{line.medicineName}</p>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Prescribed <span className="font-medium text-slate-700">{line.requested}</span> · would bill{" "}
                <span className="font-medium text-amber-700">{line.dispensed}</span> as a full pack
                {line.unitsPerPack ? ` of ${line.unitsPerPack}` : ""}
              </p>
              {!isCuttable(line) && (
                <p className="text-[11px] text-slate-400 mt-1">
                  {(line.schedule ?? "").trim().toUpperCase() === "X"
                    ? "Schedule X — must stay in its original pack"
                    : "Chosen as a substitute — open its own POS settings to enable loose selling"}
                </p>
              )}
            </div>
          ))}
        </div>

        {cuttable.length > 0 && (
          <div className="px-5 pb-1">
            <p className="text-[11px] text-slate-400">
              Cutting a strip turns loose selling ON for {cuttable.length === 1 ? "this medicine" : "these medicines"}{" "}
              at this pharmacy going forward — check the pack size shown above against a real strip before confirming.
            </p>
          </div>
        )}

        <div className="px-5 pb-5 pt-3 space-y-2">
          {cuttable.length > 0 && (
            <button
              ref={primaryRef}
              type="button"
              onClick={onCutStrip}
              disabled={busy}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-violet-600 text-white text-[13px] font-bold shadow-sm hover:bg-violet-700 active:scale-[0.98] transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
              Cut the strip — bill {cuttable.length === 1 ? "the exact amount" : "exact amounts"}
              {notCuttable.length > 0 ? " (where possible)" : ""}
              <KeyHint onDark>Enter ↵</KeyHint>
            </button>
          )}
          <button
            ref={cuttable.length === 0 ? primaryRef : undefined}
            type="button"
            onClick={onBillAsPack}
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
          >
            <PackageCheck className="w-4 h-4" />
            Bill as full pack{many ? "s" : ""} instead
            <KeyHint>{cuttable.length > 0 ? "Shift+Enter" : "Enter ↵"}</KeyHint>
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="w-full text-center text-[12px] text-slate-400 hover:text-slate-600 transition-colors py-1 disabled:opacity-50"
          >
            Cancel <span aria-hidden="true" className="text-slate-300">· Esc</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
