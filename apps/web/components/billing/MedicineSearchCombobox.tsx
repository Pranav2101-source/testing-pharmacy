"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Loader2, Pill, ChevronRight, ScanBarcode } from "lucide-react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { api } from "@/lib/api-client";
import { useBillingStore } from "./useBillingStore";
import { cn } from "@/lib/utils";
import type { MedicineSearchResult } from "@pharmacy/types";

type InventoryBatch = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  mrp: number;
  quantity: number;
  location?: string;
  medicine: { name: string; hsnCode: string | null; gstRate: number };
};

// Stagger for dropdown items
const dropdownVariants: Variants = {
  hidden: { opacity: 0, y: -6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
};
const itemVariants: Variants = {
  hidden:   { opacity: 0, y: -4 },
  visible:  { opacity: 1, y: 0, transition: { duration: 0.16, ease: "easeOut" } },
};

function SkeletonResult() {
  return (
    <li className="flex items-center gap-3 px-4 py-3 border-b border-slate-50">
      <div className="skeleton w-8 h-8 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-3/4 rounded-md" />
        <div className="skeleton h-2 w-1/2 rounded-md" />
      </div>
    </li>
  );
}

export function MedicineSearchCombobox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicineSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const addItem = useBillingStore((s) => s.addItem);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Barcode scanner detection — scanners fire chars < 50ms apart, then Enter
  const lastKeyTimeRef = useRef<number>(0);
  const barcodeCharCount = useRef<number>(0);
  const isBarcodeRef = useRef<boolean>(false);
  const [isBarcode, setIsBarcode] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const { data } = await api.get<{ data: MedicineSearchResult[] }>("/medicines/search", {
        params: { q, limit: 8 },
      });
      setResults(data.data);
      setOpen(data.data.length > 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = isBarcodeRef.current ? 60 : 300;
    timerRef.current = setTimeout(() => search(query), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, search]);

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  async function selectMedicine(med: MedicineSearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    isBarcodeRef.current = false;
    barcodeCharCount.current = 0;
    setIsBarcode(false);
    setAddingId(med.id);
    try {
      const { data } = await api.get<{ data: { items: InventoryBatch[] } }>("/inventory", {
        params: { search: med.name, inStock: true, limit: 1 },
      });
      const batch = data.data.items[0];
      if (!batch) {
        alert(`No stock available for ${med.name}`);
        return;
      }
      addItem({
        inventoryId: batch.id,
        medicineName: batch.medicine.name,
        hsnCode: batch.medicine.hsnCode,
        packSize: med.packSize ?? undefined,
        location: batch.location,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        mrp: batch.mrp,
        quantity: 1,
        discount: 0,
        gstRate: batch.medicine.gstRate,
      });
      inputRef.current?.focus();
    } catch { alert(`Failed to load inventory for ${med.name}`); }
    finally { setAddingId(null); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const now = Date.now();
    const diff = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;

    if (diff > 0 && diff < 50) {
      barcodeCharCount.current++;
      if (barcodeCharCount.current >= 4 && !isBarcodeRef.current) {
        isBarcodeRef.current = true;
        setIsBarcode(true);
      }
    } else {
      barcodeCharCount.current = 0;
      if (isBarcodeRef.current) {
        isBarcodeRef.current = false;
        setIsBarcode(false);
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const first = results[0];
      if (first) selectMedicine(first);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setIsBarcode(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      {/* ── Input row with focus glow ─────────────────────────── */}
      <motion.div
        animate={focused ? { backgroundColor: "rgba(219,234,254,0.6)" } : { backgroundColor: "transparent" }}
        transition={{ duration: 0.18 }}
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-none transition-shadow duration-200",
          focused && "shadow-[inset_0_-2px_0_0_rgba(37,99,235,0.4)]"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {loading || addingId ? (
            <motion.div key="loader" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin flex-shrink-0" />
            </motion.div>
          ) : isBarcode ? (
            <motion.div key="barcode" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
              <ScanBarcode className="w-6 h-6 text-emerald-500 flex-shrink-0" />
            </motion.div>
          ) : (
            <motion.div key="search" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
              <Search className="w-5 h-5 text-blue-400 flex-shrink-0" />
            </motion.div>
          )}
        </AnimatePresence>

        <input
          ref={inputRef}
          data-billing-search
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true); }}
          onBlur={() => setFocused(false)}
          placeholder="Search item here. (e.g 'gly' or 'g+99' or '8908009149206' or 'c,paracetamol')"
          className="flex-1 text-[15px] text-slate-700 placeholder-blue-400/70 bg-transparent focus:outline-none"
        />

        <AnimatePresence>
          {isBarcode && (
            <motion.span
              initial={{ opacity: 0, x: 6, scale: 0.85 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 6, scale: 0.85 }}
              className="text-[9px] font-bold text-emerald-600 uppercase tracking-wide flex-shrink-0 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"
            >
              Barcode
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Dropdown ──────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (loading || results.length > 0) && (
          <motion.ul
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute z-50 left-0 right-0 top-full bg-white border border-slate-200 rounded-xl shadow-card-lg overflow-hidden max-h-72 overflow-y-auto"
          >
            {loading && results.length === 0
              ? [0, 1, 2].map((i) => <SkeletonResult key={i} />)
              : results.map((med, i) => (
                  <motion.li
                    key={med.id}
                    variants={itemVariants}
                    onMouseDown={() => selectMedicine(med)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-slate-50 last:border-0 group",
                      "transition-colors duration-100",
                      i === 0 ? "bg-blue-50/50 hover:bg-blue-100/70" : "hover:bg-blue-50/50"
                    )}
                  >
                    <motion.div
                      whileHover={{ scale: 1.08, rotate: -4 }}
                      transition={{ type: "spring", stiffness: 500, damping: 28 }}
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                        i === 0 ? "bg-blue-100" : "bg-blue-50 group-hover:bg-blue-100"
                      )}
                    >
                      <Pill className="w-4 h-4 text-blue-500" />
                    </motion.div>

                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-slate-800 truncate">{med.name}</p>
                      <p className="text-[12px] text-slate-400 truncate">
                        {[
                          med.genericName,
                          med.manufacturer,
                          med.form && med.strength ? `${med.form} · ${med.strength}` : med.form,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {med.packSize && (
                        <span className="pill bg-slate-100 text-slate-500 text-[12px]">{med.packSize}</span>
                      )}
                      <span className="pill bg-blue-100 text-blue-600 text-[12px]">GST {med.gstRate}%</span>
                      {i === 0 && (
                        <span className="pill bg-emerald-100 text-emerald-600 uppercase tracking-wide">
                          ↵
                        </span>
                      )}
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-400 transition-colors" />
                    </div>
                  </motion.li>
                ))}
          </motion.ul>
        )}

        {open && !loading && results.length === 0 && query.trim() && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 left-0 right-0 top-full bg-white border border-slate-200 rounded-xl shadow-card-md px-4 py-5 text-center"
          >
            <p className="text-sm text-slate-500">
              No medicines found for <strong className="text-slate-700">&quot;{query}&quot;</strong>
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Try generic name, barcode, or manufacturer</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
