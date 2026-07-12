"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Check, ChevronDown, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaxonomyOption } from "@/lib/product-taxonomy";

// A tap-friendly popup grid for choosing from a small preset list (packaging
// unit, product category, …). Bigger targets and icon+label recognition beat a
// native <select> at the counter. The underlying value stays a plain string:
// presets are the fast path, but "Other" keeps free-text entry so no existing
// value is ever lost or blocked.

export function IconGridPicker({
  value,
  onChange,
  options,
  title,
  placeholder = "Select…",
  columns = 3,
  triggerClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: TaxonomyOption[];
  title: string;
  placeholder?: string;
  columns?: number;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const trimmed = value.trim();
  const selected = trimmed
    ? options.find((o) => o.value.toLowerCase() === trimmed.toLowerCase()) ?? null
    : null;
  const isCustom = Boolean(trimmed) && !selected;

  const SelectedIcon = selected?.Icon;

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setCustomMode(false);
  }

  function openPicker() {
    setCustomValue(isCustom ? trimmed : "");
    setCustomMode(false);
    setOpen(true);
  }

  return (
    <>
      {/* Trigger — styled to match the form's Input/Select controls */}
      <button
        type="button"
        onClick={openPicker}
        className={cn(
          "w-full flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white text-left transition-colors hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400",
          triggerClassName,
        )}
      >
        {SelectedIcon ? (
          <SelectedIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
        ) : isCustom ? (
          <Pencil className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        ) : null}
        <span className={cn("flex-1 truncate", trimmed ? "text-slate-800" : "text-slate-400")}>
          {selected?.label ?? (trimmed || placeholder)}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
      </button>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[250] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <div>
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Choose</p>
                    <h3 className="font-bold text-slate-900 text-[15px]">{title}</h3>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-slate-500" />
                  </button>
                </div>

                {/* Grid */}
                <div className="p-4">
                  <div
                    className="grid gap-2.5"
                    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                  >
                    {options.map((opt) => {
                      const active = selected?.value === opt.value;
                      const Icon = opt.Icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => choose(opt.value)}
                          title={opt.hint}
                          className={cn(
                            "relative flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 py-4 px-2 transition-all",
                            active
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-100 bg-slate-50/60 hover:border-blue-200 hover:bg-blue-50/40",
                          )}
                        >
                          {active && (
                            <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                            </span>
                          )}
                          <Icon className={cn("w-6 h-6", active ? "text-blue-600" : "text-slate-500")} />
                          <span className={cn("text-[12px] font-semibold text-center leading-tight", active ? "text-blue-700" : "text-slate-600")}>
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Other / free-text — keeps arbitrary values enterable */}
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    {customMode || isCustom ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={customValue}
                          onChange={(e) => setCustomValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (customValue.trim()) choose(customValue.trim()); } }}
                          placeholder="Type a custom value…"
                          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => customValue.trim() && choose(customValue.trim())}
                          disabled={!customValue.trim()}
                          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-colors disabled:opacity-50"
                        >
                          Set
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setCustomMode(true); setCustomValue(""); }}
                        className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-blue-600 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        Other — enter manually
                      </button>
                    )}
                  </div>

                  {trimmed && (
                    <button
                      type="button"
                      onClick={() => choose("")}
                      className="mt-3 text-[11px] font-medium text-slate-400 hover:text-red-500 transition-colors"
                    >
                      Clear selection
                    </button>
                  )}
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
