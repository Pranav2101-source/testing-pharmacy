"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Stethoscope, ChevronDown, FileText, X, UserPlus } from "lucide-react";
import { useBillingStore } from "./useBillingStore";
import { CustomerSearchCombobox } from "./CustomerSearchCombobox";
import { DoctorQuickAddModal } from "@/components/doctors/DoctorQuickAddModal";
import type { DoctorRecord } from "@/components/doctors/DoctorQuickAddModal";
import { api } from "@/lib/api-client";

// Computed once per session — bill date never changes mid-session
const TODAY_LABEL = format(new Date(), "dd/MM/yyyy");

interface DoctorHint { id: string; name: string; specialty: string | null; registrationNo: string | null; }
type DropdownPos = { top: number; left: number; width: number };

function DoctorCombobox({ value, onChange }: { value: string; onChange: (name: string, doctorId?: string) => void }) {
  const [query,     setQuery]     = useState(value);
  const [open,      setOpen]      = useState(false);
  const [hints,     setHints]     = useState<DoctorHint[]>([]);
  const [searched,  setSearched]  = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pos,       setPos]       = useState<DropdownPos>({ top: 0, left: 0, width: 260 });
  const anchorRef  = useRef<HTMLDivElement>(null);
  const dropRef    = useRef<HTMLDivElement>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef     = useRef<number | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const recalc = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!anchorRef.current) return;
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 280) });
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    recalc();
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [open, recalc]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !dropRef.current?.contains(t)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    onChange(v, "");   // free-text: no doctorId
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length < 1) { setHints([]); setSearched(false); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ data: DoctorHint[] }>(
          `/doctors?search=${encodeURIComponent(v)}&limit=6`,
        );
        const list = data.data ?? [];
        setHints(list);
        setSearched(true);
        setOpen(true);   // always open after a search so "no results" is visible
        recalc();
      } catch { setHints([]); setSearched(false); setOpen(false); }
    }, 220);
  }

  function pick(d: DoctorHint) {
    onChange(d.name, d.id);   // pass id so the FK is stored
    setQuery(d.name);
    setOpen(false);
  }

  function clear() {
    onChange("", "");          // clear both name and id
    setQuery("");
    setHints([]);
    setSearched(false);
    setOpen(false);
  }

  return (
    <>
      <div ref={anchorRef} className="relative flex items-center gap-1 w-full">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Name / Lic No."
          autoComplete="off"
          className="w-full text-[13px] font-medium text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none leading-none"
        />
        {query && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={dropRef}
              key="doctor-dropdown"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{   opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.13, ease: "easeOut" }}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
              className="bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            >
              {hints.length === 0 && searched && (
                <div className="px-4 py-2.5 text-[12px] text-slate-400 border-b border-slate-50">
                  No doctors found for &ldquo;{query}&rdquo;
                </div>
              )}
              {hints.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pick(d); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-slate-50"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-[12px] flex-shrink-0">
                    {d.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{d.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {d.specialty && (
                        <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-1.5 py-0.5 rounded-full leading-none">
                          {d.specialty}
                        </span>
                      )}
                      {d.registrationNo && (
                        <span className="text-[10px] text-slate-400">#{d.registrationNo}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setOpen(false); setShowModal(true); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <UserPlus className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-blue-700">Add to Doctor Master</p>
                  <p className="text-[11px] text-slate-400">Save doctor details for future prescriptions.</p>
                </div>
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {showModal && (
        <DoctorQuickAddModal
          initialName={query}
          onClose={() => setShowModal(false)}
          onSaved={(saved: DoctorRecord) => {
            onChange(saved.name, saved.id);
            setQuery(saved.name);
            setShowModal(false);
          }}
        />
      )}
    </>
  );
}

const BILLING_FOR_OPTIONS = ["Self", "Counter", "Credit", "Insurance"] as const;

function Divider() {
  return <div className="w-px self-stretch bg-slate-200 flex-shrink-0" />;
}

export function BillHeader() {
  const paymentStatus  = useBillingStore((s) => s.meta.paymentStatus);
  const doctorName     = useBillingStore((s) => s.meta.doctorName);
  const prescriptionId = useBillingStore((s) => s.meta.prescriptionId);
  const setMeta        = useBillingStore((s) => s.setMeta);

  function handleDoctorChange(name: string, doctorId?: string) {
    setMeta({ doctorName: name, doctorId: doctorId ?? "" });
  }

  return (
    <div
      className="flex items-stretch border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto no-scrollbar"
      style={{ minHeight: "var(--header-height, 60px)", maxHeight: "var(--header-height, 60px)" }}
    >

      {/* Bill Date — neutral, understated */}
      <div className="flex items-center gap-2.5 px-4 py-2 flex-shrink-0 min-w-[156px] bg-slate-50 border-r border-slate-200">
        <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1">
            Bill Date
          </p>
          <button className="flex items-center gap-1 group">
            <span className="text-[14px] font-bold text-slate-800 tabnum leading-none">
              {TODAY_LABEL}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-300 group-hover:text-slate-600 transition-colors" />
          </button>
        </div>
      </div>

      {/* Customer — visually dominant; this is the primary first action */}
      <div className="flex items-center px-3.5 py-2 flex-1 min-w-[280px] relative">
        <CustomerSearchCombobox />
      </div>

      <Divider />

      {/* Billing For */}
      <div className="flex items-center px-4 py-2 flex-shrink-0 min-w-[140px]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Billing for
          </p>
          <div className="relative flex items-center">
            <select
              value={
                paymentStatus === "PAID"    ? "Self"      :
                paymentStatus === "PENDING" ? "Credit"    :
                paymentStatus === "PARTIAL" ? "Insurance" : "Counter"
              }
              onChange={(e) => {
                const map: Record<string, "PAID" | "PENDING" | "PARTIAL"> = {
                  Self: "PAID", Counter: "PAID", Credit: "PENDING", Insurance: "PARTIAL",
                };
                setMeta({ paymentStatus: map[e.target.value] ?? "PAID" });
              }}
              className="text-[13px] font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer appearance-none pr-4 leading-none"
            >
              {BILLING_FOR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 pointer-events-none absolute right-0" />
          </div>
        </div>
      </div>

      <Divider />

      {/* Doctor */}
      <div className="flex items-center gap-2.5 px-4 py-2 flex-1 min-w-[180px] input-glow glow-focus">
        <Stethoscope className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Doctor
          </p>
          <DoctorCombobox
            value={doctorName}
            onChange={handleDoctorChange}
          />
        </div>
      </div>

      <Divider />

      {/* Prescription / Rx No. */}
      <div className="flex items-center gap-2.5 px-4 py-2 flex-shrink-0 min-w-[160px] input-glow glow-focus">
        <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none mb-1.5">
            Rx No.
          </p>
          <input
            type="text"
            value={prescriptionId}
            onChange={(e) => setMeta({ prescriptionId: e.target.value })}
            placeholder="Prescription no."
            autoComplete="off"
            className="w-full text-[13px] font-medium text-slate-800 placeholder-slate-300 bg-transparent focus:outline-none leading-none"
          />
        </div>
      </div>

    </div>
  );
}
