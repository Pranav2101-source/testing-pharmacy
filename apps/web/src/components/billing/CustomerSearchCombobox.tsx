"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { User, Phone, UserPlus, X, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api-client";
import { useBillingStore } from "./useBillingStore";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

type RepeatItem = {
  inventoryId: string; medicineName: string; hsnCode: string | null;
  schedule: string | null; packSize: string | null; location: string | null;
  batchNumber: string; expiryDate: string; mrp: number; gstRate: number;
  discount: number; quantity: number; availableStock: number;
  requestedQuantity: number; capped: boolean;
  saleUnit?: "PACK" | "LOOSE"; unitsPerPack?: number | null; baseUnit?: string | null;
  allowLooseSale?: boolean; looseUnits?: number;
};
type RepeatResp = {
  invoiceNumber: string; invoiceDate: string;
  items: RepeatItem[]; unavailable: { medicineName: string; reason: string }[];
};
import { CustomerModal } from "@/components/customers/CustomerModal";
import type { CustomerRecord } from "@/components/customers/CustomerModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type SearchResult = {
  id:              string;
  name:            string;
  phone:           string | null;
  email:           string | null;
  address:         string | null;
  customerType:    string;
  defaultDiscount: number;
  creditLimit:     number;
  creditUsed:      number;
  abhaNumber:      string | null;
  cardNumber:      string | null;
};

type DropdownPos = { top: number; left: number; width: number };

const TYPE_LABELS: Record<string, string> = {
  WALK_IN:    "Walk-in",
  REGISTERED: "Registered",
  CORPORATE:  "Corporate",
  CREDIT:     "Credit",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CustomerSearchCombobox() {
  // Selective selectors — only re-renders when customer-related meta changes,
  // not on every cart item add / qty update / discount change.
  const customerId              = useBillingStore((s) => s.meta.customerId);
  const customerName            = useBillingStore((s) => s.meta.customerName);
  const customerPhone           = useBillingStore((s) => s.meta.customerPhone);
  const customerDefaultDiscount = useBillingStore((s) => s.meta.customerDefaultDiscount);
  const setMeta                 = useBillingStore((s) => s.setMeta);
  const addItem                 = useBillingStore((s) => s.addItem);
  const toast                   = useToast();

  const [repeating,    setRepeating]    = useState(false);
  const [query,        setQuery]        = useState("");
  const [debouncedQ,   setDebouncedQ]   = useState("");   // 300 ms behind query
  const [open,         setOpen]         = useState(false);
  const [activeIndex,  setActiveIndex]  = useState(0);
  const [showModal,    setShowModal]    = useState(false);
  const [pos,          setPos]          = useState<DropdownPos>({ top: 0, left: 0, width: 320 });
  const [creditInfo,   setCreditInfo]   = useState<{ used: number; limit: number } | null>(null);

  const anchorRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const rafRef      = useRef<number | null>(null);        // RAF handle for recalc throttle

  // ── 300 ms search debounce ────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // ── RAF-throttled position calculation ───────────────────────────────────
  // Batches rapid scroll/resize events to at most one setState per animation frame.
  const recalc = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!anchorRef.current) return;
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 320) });
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    recalc();
    window.addEventListener("scroll", recalc, true);  // capture = catches nested scrolls
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [open, recalc]);

  // ── Click-outside → close (portal-aware) ─────────────────────────────────
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !dropdownRef.current?.contains(t)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // ── Search — fires on debouncedQ, not raw query ───────────────────────────
  const { data, isFetching } = useQuery({
    queryKey:        ["customer-search", debouncedQ],
    queryFn:         async () => {
      const res = await api.get<{ data: { items: SearchResult[] } }>(
        `/customers/search?q=${encodeURIComponent(debouncedQ)}&limit=8`,
      );
      return res.data.data;
    },
    enabled:         debouncedQ.length >= 1,
    placeholderData: (prev) => prev,
    staleTime:       30_000,   // cache results 30 s — same query won't re-hit the API
    gcTime:          120_000,  // keep in memory 2 min while typing back/forth
  });

  const results    = data?.items ?? [];
  const totalItems = results.length + 1;

  // ── Keyboard navigation ───────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { recalc(); setOpen(true); setActiveIndex(0); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, totalItems - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < results.length && results[activeIndex]) selectCustomer(results[activeIndex]!);
      else { setOpen(false); setShowModal(true); }
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function selectCustomer(c: SearchResult | CustomerRecord) {
    setMeta({
      customerId:              c.id,
      customerName:            c.name,
      customerPhone:           c.phone ?? "",
      customerAddress:         (c as SearchResult).address ?? "",
      abha:                    (c as SearchResult).abhaNumber ?? "",
      customerDefaultDiscount: c.defaultDiscount,
      billDiscountPct:         c.defaultDiscount,
    });
    const used  = (c as SearchResult).creditUsed  ?? 0;
    const limit = (c as SearchResult).creditLimit ?? 0;
    setCreditInfo(used > 0 || limit > 0 ? { used, limit } : null);
    setQuery("");
    setOpen(false);
  }

  // Load the customer's most recent bill into the cart, re-resolved to current
  // stock (see billing.service.getRepeatCart). "COUNTER"/walk-in has no history.
  async function repeatLastBill() {
    if (!customerId || customerId === "COUNTER" || repeating) return;
    setRepeating(true);
    try {
      const { data } = await api.get<{ data: RepeatResp }>(`/billing/repeat/${customerId}`);
      const r = data.data;
      for (const it of r.items) {
        const loose = it.saleUnit === "LOOSE";
        addItem({
          inventoryId:    it.inventoryId,
          medicineName:   it.medicineName,
          hsnCode:        it.hsnCode,
          schedule:       it.schedule,
          packSize:       it.packSize ?? undefined,
          location:       it.location ?? undefined,
          batchNumber:    it.batchNumber,
          expiryDate:     it.expiryDate,
          mrp:            it.mrp,
          quantity:       it.quantity,
          discount:       it.discount,
          gstRate:        it.gstRate,
          // Unreserved sealed packs — for a loose line the store rebuilds the piece
          // ceiling as availableStock*unitsPerPack + looseUnits.
          availableStock: it.availableStock,
          // A regular loose order comes back as loose (quantity is pieces); a pack line
          // for a loose-capable medicine still carries the fields so the toggle shows.
          saleUnit:       loose ? "LOOSE" : "PACK",
          unitsPerPack:   it.unitsPerPack ?? undefined,
          baseUnit:       it.baseUnit ?? undefined,
          allowLooseSale: it.allowLooseSale ?? loose,
          looseUnits:     it.looseUnits ?? 0,
        });
      }
      if (r.items.length > 0) {
        toast.success(`Loaded ${r.items.length} item${r.items.length !== 1 ? "s" : ""} from ${r.invoiceNumber}`);
      }
      const capped = r.items.filter((i) => i.capped);
      if (capped.length > 0) toast.warning(`Reduced to available stock: ${capped.map((i) => i.medicineName).join(", ")}`);
      if (r.unavailable.length > 0) toast.warning(`Out of stock, skipped: ${r.unavailable.map((u) => u.medicineName).join(", ")}`);
      if (r.items.length === 0 && r.unavailable.length > 0) toast.error("None of the last bill's items are in stock right now.");
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) toast.info("No previous bill found for this customer.");
      else toast.error(getErrorMessage(err, "Couldn't load the last bill. Please try again."));
    } finally {
      setRepeating(false);
    }
  }

  function clearCustomer() {
    setMeta({
      customerId:              "",
      customerName:            "",
      customerPhone:           "",
      customerAddress:         "",
      abha:                    "",
      customerDefaultDiscount: 0,
      billDiscountPct:         0,
    });
    setCreditInfo(null);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 10);
  }

  // ── Selected state ────────────────────────────────────────────────────────
  if (customerId) {
    const creditUsed  = creditInfo?.used  ?? 0;
    const creditLimit = creditInfo?.limit ?? 0;
    const overLimit   = creditLimit > 0 && creditUsed >= creditLimit;
    const hasCredit   = creditUsed > 0;

    return (
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <motion.div
          initial={{ scale: 0, rotate: -15 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
          className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-[13px] flex-shrink-0 shadow-sm"
        >
          {customerName.charAt(0).toUpperCase()}
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-slate-800 leading-tight truncate">{customerName}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {customerPhone && (
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Phone className="w-2.5 h-2.5" />{customerPhone}
              </span>
            )}
            {customerDefaultDiscount > 0 && (
              <span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded-full leading-none">
                {customerDefaultDiscount}% off
              </span>
            )}
            {hasCredit && (
              <span className={cn(
                "flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                overLimit ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
              )}>
                <AlertCircle className="w-2.5 h-2.5" />
                ₹{creditUsed.toLocaleString("en-IN")} outstanding
                {creditLimit > 0 && (
                  <span className="opacity-70"> / ₹{creditLimit.toLocaleString("en-IN")}</span>
                )}
              </span>
            )}
          </div>
        </div>
        <button onClick={repeatLastBill} disabled={repeating}
          title="Load this customer's most recent bill into the cart"
          className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 font-semibold transition-colors flex-shrink-0 disabled:opacity-60">
          {repeating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Repeat last bill
        </button>
        <button onClick={clearCustomer} title="Remove customer"
          className="flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-red-500 font-semibold transition-colors flex-shrink-0">
          <X className="w-3 h-3" /> Clear
        </button>
      </div>
    );
  }

  // ── Search state ──────────────────────────────────────────────────────────
  return (
    <>
      <div ref={anchorRef} className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-white" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { const v = e.target.value; setQuery(v); recalc(); setOpen(v.trim().length > 0); setActiveIndex(0); }}
            onFocus={() => { recalc(); if (query.trim()) setOpen(true); }}
            onKeyDown={handleKeyDown}
            placeholder="Customer Mobile / Name / Card Number"
            autoComplete="off"
            className="w-full text-[14px] font-medium text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none leading-tight"
          />
        </div>
      </div>

      {/* ── Floating dropdown via portal ─────────────────────────────────────── */}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={dropdownRef}
              key="customer-dropdown"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{   opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.13, ease: "easeOut" }}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
              className="bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            >
              {isFetching && (
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-50 text-[12px] text-slate-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                  Searching…
                </div>
              )}

              {!isFetching && results.length === 0 && debouncedQ && (
                <div className="px-4 py-2.5 text-[12px] text-slate-400 border-b border-slate-50">
                  No customers found for &ldquo;{debouncedQ}&rdquo;
                </div>
              )}

              {results.map((c, i) => (
                <button
                  key={c.id}
                  onMouseDown={(e) => { e.preventDefault(); selectCustomer(c); }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-50",
                    activeIndex === i ? "bg-blue-50" : "hover:bg-slate-50",
                  )}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-[12px] flex-shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {c.phone && <span className="text-[11px] text-slate-400">{c.phone}</span>}
                      <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-1.5 py-0.5 rounded-full leading-none">
                        {TYPE_LABELS[c.customerType] ?? c.customerType}
                      </span>
                      {c.defaultDiscount > 0 && (
                        <span className="text-[10px] text-green-600 font-bold">{c.defaultDiscount}% off</span>
                      )}
                      {c.creditUsed > 0 && (
                        <span className="text-[10px] text-amber-600 font-medium">₹{c.creditUsed} due</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}

              <button
                onMouseDown={(e) => { e.preventDefault(); setOpen(false); setShowModal(true); }}
                onMouseEnter={() => setActiveIndex(results.length)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                  activeIndex === results.length ? "bg-blue-50" : "hover:bg-slate-50",
                )}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <UserPlus className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-blue-700">Add New Customer</p>
                  <p className="text-[11px] text-slate-400">Save Paper &amp; Share Invoice on WhatsApp.</p>
                </div>
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {showModal && (
        <CustomerModal
          onClose={() => setShowModal(false)}
          onSaved={(saved) => { selectCustomer(saved); setShowModal(false); }}
        />
      )}
    </>
  );
}
