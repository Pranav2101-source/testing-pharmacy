import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The in-app replacement for {@code window.confirm()} — a real, styled dialog so a
 * destructive or consequential action reads as a deliberate step, not a browser
 * chrome pop-up. Keyboard-first, matching {@code PackRoundingModal}: the primary
 * action is auto-focused, Enter confirms, Escape cancels, and every Enter is
 * intercepted so nothing races a focused button's own activation.
 *
 * <p>Set {@code cancelLabel} to {@code null} for an acknowledge-only dialog (one
 * button) — e.g. "the thing is done, but read this first".
 */
export function ConfirmDialog({
  open,
  tone = "default",
  icon: Icon,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  tone?: "default" | "danger" | "warning";
  icon?: LucideIcon;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  /** null → acknowledge-only (no cancel button; Escape still calls onCancel). */
  cancelLabel?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (busy) return;
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onConfirm, onCancel]);

  const accent = {
    default: { ring: "bg-blue-50 text-blue-600", btn: "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-400" },
    danger:  { ring: "bg-red-50 text-red-600",   btn: "bg-red-600 hover:bg-red-700 focus-visible:ring-red-400" },
    warning: { ring: "bg-amber-50 text-amber-600", btn: "bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-400" },
  }[tone];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
          >
            <div className="px-5 pt-5 pb-4 flex gap-3.5">
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", accent.ring)}>
                {Icon ? <Icon className="w-4.5 h-4.5" /> : <AlertTriangle className="w-4.5 h-4.5" />}
              </div>
              <div className="min-w-0 pt-0.5">
                <h2 className="text-[15px] font-bold text-slate-900 leading-snug">{title}</h2>
                {body && <div className="mt-1.5 text-[12.5px] text-slate-500 leading-relaxed">{body}</div>}
              </div>
            </div>

            <div className="px-5 pb-5 pt-1 flex justify-end gap-2.5">
              {cancelLabel !== null && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
                >
                  {cancelLabel}
                </button>
              )}
              <button
                ref={primaryRef}
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className={cn(
                  "px-4 py-2 rounded-xl text-[13px] font-bold text-white shadow-sm transition-all active:scale-[0.98]",
                  "disabled:opacity-60 flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  accent.btn,
                )}
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
