"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Keyboard, X, Search, Layers, Shuffle, Save, ScanBarcode } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A cheat sheet for a keyboard-first bill screen most of whose shortcuts otherwise
 * live only in tribal knowledge (or a scattered hint line per component — the search
 * box's own arrow-key flows have no on-screen hint anywhere). Opens on click or "?",
 * the same convention Gmail/Linear/Superhuman use. "/" is reserved for jumping into
 * search (BillingNewPage's global handler), so this panel deliberately does not
 * also bind "/" — one key, one job.
 */

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md border border-slate-300 bg-white text-[11px] font-mono font-bold text-slate-600 shadow-[0_1.5px_0_rgba(0,0,0,0.08)]">
      {children}
    </kbd>
  );
}

function Row({ keys, label }: { keys: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-[13px] text-slate-600">{label}</span>
      <div className="flex items-center gap-1 flex-shrink-0">{keys}</div>
    </div>
  );
}

function Group({
  icon: Icon, iconBg, iconColor, title, children,
}: {
  icon: React.ElementType; iconBg: string; iconColor: string; title: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn("w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0", iconBg)}>
          <Icon className={cn("w-3.5 h-3.5", iconColor)} strokeWidth={2} />
        </span>
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{title}</p>
      </div>
      {children}
    </div>
  );
}

export function KeyboardShortcutsPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "?" && !typing) { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === "Escape" && open) { setOpen(false); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts (?)"
        className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 rounded-lg px-2.5 py-1.5 transition-colors"
      >
        <Keyboard className="w-3.5 h-3.5" />
        <Kbd>?</Kbd>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[600] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1,    y: 0  }}
                exit={{   opacity: 0, scale: 0.96, y: 12  }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
              >
                <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-100 bg-gradient-to-br from-blue-50/80 to-white">
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-blue-200">
                      <Keyboard className="w-4.5 h-4.5 text-white" />
                    </span>
                    <div>
                      <h3 className="text-[15px] font-bold text-slate-900 leading-tight">Keyboard Shortcuts</h3>
                      <p className="text-[11px] text-slate-400">Bill faster without touching the mouse</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-slate-500" />
                  </button>
                </div>

                <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
                  <Group icon={Search} iconBg="bg-blue-100" iconColor="text-blue-600" title="Search & pick — medicine, doctor, Rx, customer">
                    <Row label="Jump into medicine search from anywhere" keys={<Kbd>/</Kbd>} />
                    <Row label="Navigate results" keys={<><Kbd>↑</Kbd><Kbd>↓</Kbd></>} />
                    <Row label="Select highlighted result" keys={<Kbd>↵</Kbd>} />
                    <Row label="Close the dropdown" keys={<Kbd>Esc</Kbd>} />
                  </Group>

                  <Group icon={Layers} iconBg="bg-violet-100" iconColor="text-violet-600" title="Batches & alternatives (from a medicine result)">
                    <Row label="Open the batch picker" keys={<Kbd>←</Kbd>} />
                    <Row label="Open alternatives" keys={<Kbd>→</Kbd>} />
                    <Row label="Navigate / select, once open" keys={<><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>↵</Kbd></>} />
                    <Row label="Flip Strip / loose (in the Qty box)" keys={<Kbd>L</Kbd>} />
                  </Group>

                  <Group icon={ScanBarcode} iconBg="bg-sky-100" iconColor="text-sky-600" title="Barcode scanning">
                    <Row label="Scan (auto-detected, or use Scan Barcode)" keys={<Kbd>↵</Kbd>} />
                    <div className="flex items-center justify-between gap-4 py-1.5">
                      <span className="text-[13px] text-slate-600">A recognised scan confirms with a beep</span>
                      <span className="text-[11px] text-slate-400 flex-shrink-0">🔊 no key</span>
                    </div>
                  </Group>

                  <Group icon={Save} iconBg="bg-emerald-100" iconColor="text-emerald-600" title="Save & bill">
                    <Row label="Save & Print" keys={<Kbd>F9</Kbd>} />
                    <Row label="Save & New" keys={<Kbd>F8</Kbd>} />
                    <Row label="Save as Draft" keys={<><Kbd>Ctrl</Kbd><Kbd>S</Kbd></>} />
                    <Row label="Set payment mode (Cash/UPI/Card/Credit)" keys={<><Kbd>Alt</Kbd><Kbd>1-4</Kbd></>} />
                    <Row label="Dismiss receipt → next bill" keys={<Kbd>Esc</Kbd>} />
                  </Group>

                  <Group icon={Shuffle} iconBg="bg-amber-100" iconColor="text-amber-600" title="This cheat sheet">
                    <Row label="Open / close" keys={<Kbd>?</Kbd>} />
                  </Group>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
