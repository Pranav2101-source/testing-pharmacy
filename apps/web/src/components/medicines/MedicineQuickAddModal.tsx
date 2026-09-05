"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, FlaskConical } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { api, getErrorMessage } from "@/lib/api-client";
import { IconGridPicker } from "@/components/IconGridPicker";
import { PACKAGING_UNITS, PRODUCT_CATEGORIES } from "@/lib/product-taxonomy";

/**
 * The subset of a catalogue medicine that callers of this modal need back.
 * Structurally compatible with the purchases `Medicine` type
 * (`{ id, name, genericName, gstRate, hsnCode }`) so a freshly-created medicine
 * can be handed straight to the same `onSelect` a picked one goes through.
 */
export interface QuickAddedMedicine {
  id:           string;
  name:         string;
  genericName:  string | null;
  manufacturer: string | null;
  category:     string | null;
  gstRate:      number;
  hsnCode:      string | null;
  schedule:     string | null;
  form:         string | null;
  strength:     string | null;
  unit:         string | null;
}

/**
 * A pharmacy-local medicine (see PharmacyMedicine on the backend) — never written to
 * the shared catalogue. Same shape as {@link QuickAddedMedicine} minus `category`
 * (not a local-medicine field) so a "Save as Local Medicine" result can flow through
 * the same GRN-row-population code as a catalogue pick, just without a medicineId.
 */
export interface QuickAddedLocalMedicine {
  id:           string;
  name:         string;
  genericName:  string | null;
  manufacturer: string | null;
  gstRate:      number;
  hsnCode:      string | null;
  schedule:     string | null;
  form:         string | null;
  strength:     string | null;
  unit:         string | null;
}

// Match the lists in MedicinesPage.tsx — kept in sync by hand (short, stable).
const SCHEDULES   = ["OTC", "H", "H1", "X", "G"];
const FORMS       = ["tablet", "capsule", "syrup", "injection", "cream", "drops", "sachet", "gel", "powder", "inhaler", "suspension", "lotion", "ointment", "patch", "spray"];
const GST_RATES   = [0, 5, 12, 18];
const DEFAULT_GST = 12;

interface FormState {
  name:         string;
  manufacturer: string;
  genericName:  string;
  category:     string;
  form:         string;
  unit:         string;
  strength:     string;
  hsnCode:      string;
  schedule:     string;
}

/**
 * Create a medicine without leaving the GRN / PO flow. A distributor invoice
 * routinely lists products not yet in the catalogue; before this, an unmatched
 * line was a hard wall (leave → Medicines page → add → come back).
 *
 * Two modes:
 *  - {@code "global"} (default) hits `POST /api/v1/medicines` — writes the SHARED
 *    catalogue (open to any authenticated user; dedupes on name+manufacturer with
 *    a 409). A trimmed version of the full MedicinesPage form.
 *  - {@code "local"} hits `POST /api/v1/purchases/local-medicines` — writes a
 *    pharmacy-scoped identity ONLY (see PharmacyMedicine on the backend), never
 *    the shared catalogue. Used by GRN receiving so an unrecognized medicine on
 *    an invoice never blocks the GRN or pollutes the platform-wide catalogue with
 *    a one-off/mistyped entry; it's matched to the real catalogue automatically,
 *    later, in the background.
 */
export function MedicineQuickAddModal({
  mode = "global",
  initialName = "",
  defaultGstRate,
  onClose,
  onSaved,
  onSavedLocal,
}: {
  mode?:           "global" | "local";
  initialName?:    string;
  defaultGstRate?: number;
  onClose:         () => void;
  /** Required when {@code mode} is "global" (the default). */
  onSaved?:        (m: QuickAddedMedicine) => void;
  /** Required when {@code mode} is "local". */
  onSavedLocal?:   (m: QuickAddedLocalMedicine) => void;
}) {
  const [form, setForm] = useState<FormState>({
    name: initialName, manufacturer: "", genericName: "", category: "", form: "",
    unit: "", strength: "", hsnCode: "", schedule: "",
  });
  const [gstRate,    setGstRate]    = useState<number>(
    defaultGstRate != null && GST_RATES.includes(defaultGstRate) ? defaultGstRate : DEFAULT_GST,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const set = (key: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  async function handleSubmit() {
    if (!form.name.trim()) { setError("Medicine name is required"); return; }

    setSubmitting(true);
    setError(null);
    try {
      if (mode === "local") {
        const body = {
          name:         form.name.trim(),
          manufacturer: form.manufacturer.trim() || undefined,
          genericName:  form.genericName.trim()  || undefined,
          form:         form.form                || undefined,
          unit:         form.unit.trim()         || undefined,
          strength:     form.strength.trim()      || undefined,
          hsnCode:      form.hsnCode.trim()       || undefined,
          schedule:     form.schedule            || undefined,
          gstRate,
        };
        const res = await api.post<{ data: QuickAddedLocalMedicine }>("/purchases/local-medicines", body);
        onSavedLocal!(res.data.data);
      } else {
        const body = {
          name:         form.name.trim(),
          manufacturer: form.manufacturer.trim() || undefined,
          genericName:  form.genericName.trim()  || undefined,
          category:     form.category.trim()     || undefined,
          form:         form.form                || undefined,
          unit:         form.unit.trim()         || undefined,
          strength:     form.strength.trim()      || undefined,
          hsnCode:      form.hsnCode.trim()       || undefined,
          schedule:     form.schedule            || undefined,
          gstRate,
        };
        const res = await api.post<{ data: QuickAddedMedicine }>("/medicines", body);
        onSaved!(res.data.data);
      }
    } catch (err: unknown) {
      // The 409 "A medicine with this name and manufacturer already exists" is
      // already human-readable — surface it and let the user change the
      // manufacturer or cancel and pick the existing one.
      setError(getErrorMessage(err, mode === "local" ? "Failed to save local medicine" : "Failed to add medicine"));
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors";

  // z-[200] (not the usual z-[9999]): IconGridPicker's own popup is z-[250] and
  // must stack ABOVE this modal. Same z as SupplierFormModal, which is also
  // opened from inside the GRN/PO ModalShell.
  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1,    opacity: 1, y: 0  }}
        exit={{   scale: 0.95, opacity: 0, y: 6  }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-blue-700 px-6 py-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <FlaskConical className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-blue-200 text-[11px] font-semibold tracking-wide uppercase">
                {mode === "local" ? "This Pharmacy Only" : "Medicine Catalogue"}
              </p>
              <h2 className="text-white text-[18px] font-bold leading-snug">
                {mode === "local" ? "Save as Local Medicine" : "Add New Medicine"}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 bg-white text-blue-700 font-bold text-[13px] px-5 py-2 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-60"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {mode === "local" ? "Save as Local" : "Add Medicine"}
            </button>
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 grid grid-cols-2 gap-4 overflow-y-auto max-h-[calc(100vh-180px)]">
          {error && (
            <div className="col-span-2 bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-2.5 rounded-lg">
              {error}
            </div>
          )}

          {mode === "local" && (
            <div className="col-span-2 bg-blue-50 border border-blue-100 text-blue-700 text-[12px] px-4 py-2.5 rounded-lg">
              This never touches the shared medicine catalogue — it's saved for your pharmacy only, and matched to the
              catalogue automatically in the background once a confident match is found.
            </div>
          )}

          <div className="col-span-2">
            <QLabel>Medicine Name <span className="text-red-500">*</span></QLabel>
            <input autoFocus value={form.name} onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Dolo 650" className={inputCls} />
          </div>

          <div>
            <QLabel>Generic Name / Salt</QLabel>
            <input value={form.genericName} onChange={(e) => set("genericName")(e.target.value)}
              placeholder="e.g. Paracetamol" className={inputCls} />
          </div>
          <div>
            <QLabel>Manufacturer</QLabel>
            <input value={form.manufacturer} onChange={(e) => set("manufacturer")(e.target.value)}
              placeholder="e.g. Micro Labs" className={inputCls} />
          </div>

          {mode !== "local" && (
            <div>
              <QLabel>Category / Type</QLabel>
              <IconGridPicker value={form.category} onChange={set("category")}
                options={PRODUCT_CATEGORIES} title="Product Category" placeholder="Select category" />
            </div>
          )}
          <div className={mode === "local" ? "col-span-2" : undefined}>
            <QLabel>Form</QLabel>
            <select value={form.form} onChange={(e) => set("form")(e.target.value)}
              className={cn(inputCls, "capitalize")}>
              <option value="">Select form</option>
              {FORMS.map((f) => <option key={f} value={f} className="capitalize">{f}</option>)}
            </select>
          </div>

          <div>
            <QLabel>Packaging</QLabel>
            <IconGridPicker value={form.unit} onChange={set("unit")}
              options={PACKAGING_UNITS} title="Packaging Type" placeholder="Select packaging" />
          </div>
          <div>
            <QLabel>Strength</QLabel>
            <input value={form.strength} onChange={(e) => set("strength")(e.target.value)}
              placeholder="e.g. 650mg" className={inputCls} />
          </div>

          <div>
            <QLabel>Schedule</QLabel>
            <select value={form.schedule} onChange={(e) => set("schedule")(e.target.value)} className={inputCls}>
              <option value="">— None —</option>
              {SCHEDULES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <QLabel>HSN Code</QLabel>
            <input value={form.hsnCode} onChange={(e) => set("hsnCode")(e.target.value)}
              placeholder="8-digit HSN" className={inputCls} />
          </div>

          <div className="col-span-2">
            <QLabel>GST Rate</QLabel>
            <div className="flex gap-2">
              {GST_RATES.map((r) => (
                <button key={r} type="button" onClick={() => setGstRate(r)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-[13px] font-semibold border transition-colors",
                    gstRate === r
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "bg-white border-slate-200 text-slate-600 hover:border-blue-300",
                  )}>
                  {r}%
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function QLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">{children}</label>;
}
