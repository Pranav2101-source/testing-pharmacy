import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, Loader2, Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { api } from "@/lib/api-client";
import { MedicineQuickAddModal } from "@/components/medicines/MedicineQuickAddModal";
import type { Medicine } from "../types";

type MenuPos = {
  left: number; width: number; maxHeight: number;
  top?: number; bottom?: number;
};

export function MedicineCombobox({ onSelect, onClearError, allowQuickAdd = true, gstRateHint }: {
  onSelect: (m: Medicine) => void;
  onClearError?: () => void;
  /** Show "+ Add to catalogue" in the empty state (default true). */
  allowQuickAdd?: boolean;
  /** Pre-fills the GST rate in the quick-add form — pass the line row's current rate. */
  gstRateHint?: number;
}) {
  const [q, setQ]             = useState("");
  const [results, setResults] = useState<Medicine[]>([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The dropdown is portalled to <body> and position:fixed — the GRN/PO modal
  // body is an `overflow-y-auto` box that would otherwise clip a dropdown opened
  // from a field low in the form (and the same for the per-row picker inside the
  // items table). Keep it glued to the input and flip it above when there's more
  // room up than down.
  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const down = spaceBelow >= spaceAbove;
    const maxHeight = Math.max(140, Math.min(288, (down ? spaceBelow : spaceAbove) - 12));
    setMenuPos(down
      ? { left: r.left, width: r.width, maxHeight, top: r.bottom + 4 }
      : { left: r.left, width: r.width, maxHeight, bottom: window.innerHeight - r.top + 4 });
  }, []);

  useEffect(() => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/medicines/search", { params: { q, limit: 8 } });
        setResults(data.data);
        setOpen(true);
      } catch {/* */} finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // While open, track the input's position (modal body scroll, window resize).
  useEffect(() => {
    if (!open) { setMenuPos(null); return; }
    reposition();
    const onMove = () => reposition();
    window.addEventListener("scroll", onMove, true); // capture — catch scroll on any ancestor
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, results, reposition]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function pick(m: Medicine) { onSelect(m); setQ(""); setOpen(false); }
  function openQuickAdd() { setQuickAddOpen(true); setOpen(false); }

  const menu = open && menuPos && createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed", left: menuPos.left, width: menuPos.width,
        maxHeight: menuPos.maxHeight, top: menuPos.top, bottom: menuPos.bottom, zIndex: 100,
      }}
      className="bg-white border border-slate-200 rounded-xl shadow-xl overflow-y-auto"
    >
      {results.length > 0 ? (
        <>
          {results.map((m) => (
            <button key={m.id} type="button" onClick={() => pick(m)}
              className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0">
              <p className="text-[13px] font-semibold text-slate-800">{m.name}</p>
              {m.genericName && <p className="text-[11px] text-slate-400">{m.genericName}</p>}
              <p className="text-[10px] text-slate-300">GST {m.gstRate}%{m.hsnCode ? ` · HSN ${m.hsnCode}` : ""}</p>
            </button>
          ))}
          {allowQuickAdd && q.trim().length >= 2 && (
            <button type="button" onClick={openQuickAdd}
              className="w-full flex items-center gap-1.5 px-3.5 py-2.5 text-[12px] font-semibold text-blue-600 hover:bg-blue-50 transition-colors border-t border-slate-100">
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />Not here? Add "{q.trim()}" to catalogue
            </button>
          )}
        </>
      ) : (
        <div className="px-3.5 py-3">
          <p className="text-[13px] font-semibold text-slate-500 text-center">No medicine found for "{q}"</p>
          {allowQuickAdd ? (
            <button type="button" onClick={openQuickAdd}
              className="mt-2 w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold py-2 rounded-lg transition-colors">
              <Plus className="w-3.5 h-3.5" />Add "{q.trim()}" to catalogue
            </button>
          ) : (
            <p className="text-[11px] text-slate-400 mt-0.5 text-center">Go to <span className="font-semibold">Medicines</span> page to add it to the catalog first.</p>
          )}
        </div>
      )}
    </div>,
    document.body,
  );

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden h-9 bg-white">
        <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) onClearError?.(); }} placeholder="Search medicine name…"
          className="flex-1 px-3 text-[13px] placeholder-slate-400 focus:outline-none h-full bg-transparent" />
        {loading ? <Loader2 className="w-3.5 h-3.5 text-slate-400 mx-2.5 animate-spin" /> : <Search className="w-3.5 h-3.5 text-slate-400 mx-2.5" />}
      </div>

      {menu}

      <AnimatePresence>
        {quickAddOpen && (
          <MedicineQuickAddModal
            initialName={q.trim()}
            defaultGstRate={gstRateHint}
            onClose={() => setQuickAddOpen(false)}
            onSaved={(m) => {
              onSelect(m);
              setQuickAddOpen(false);
              setQ(""); setOpen(false); setResults([]);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
