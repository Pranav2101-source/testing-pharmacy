import { useState, useEffect, useRef } from "react";
import { Search, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Medicine } from "../types";

export function MedicineCombobox({ onSelect, onClearError }: { onSelect: (m: Medicine) => void; onClearError?: () => void }) {
  const [q, setQ]             = useState("");
  const [results, setResults] = useState<Medicine[]>([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden h-9 bg-white">
        <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) onClearError?.(); }} placeholder="Search medicine name…"
          className="flex-1 px-3 text-[13px] placeholder-slate-400 focus:outline-none h-full bg-transparent" />
        {loading ? <Loader2 className="w-3.5 h-3.5 text-slate-400 mx-2.5 animate-spin" /> : <Search className="w-3.5 h-3.5 text-slate-400 mx-2.5" />}
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden">
          {results.length > 0 ? results.map((m) => (
            <button key={m.id} type="button" onClick={() => { onSelect(m); setQ(""); setOpen(false); }}
              className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0">
              <p className="text-[13px] font-semibold text-slate-800">{m.name}</p>
              {m.genericName && <p className="text-[11px] text-slate-400">{m.genericName}</p>}
              <p className="text-[10px] text-slate-300">GST {m.gstRate}%{m.hsnCode ? ` · HSN ${m.hsnCode}` : ""}</p>
            </button>
          )) : (
            <div className="px-3.5 py-3 text-center">
              <p className="text-[13px] font-semibold text-slate-500">No medicine found for "{q}"</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Go to <span className="font-semibold">Medicines</span> page to add it to the catalog first.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
