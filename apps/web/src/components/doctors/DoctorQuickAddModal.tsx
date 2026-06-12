"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api-client";

export interface DoctorRecord {
  id:             string;
  name:           string;
  registrationNo: string | null;
  specialty:      string | null;
  clinic:         string | null;
  phone:          string | null;
  email:          string | null;
  address:        string | null;
  isActive:       boolean;
}

interface FormState {
  name:           string;
  registrationNo: string;
  specialty:      string;
  clinic:         string;
  phone:          string;
  email:          string;
  address:        string;
}

const BLANK: FormState = {
  name: "", registrationNo: "", specialty: "", clinic: "",
  phone: "", email: "", address: "",
};

export function DoctorQuickAddModal({
  initialName = "",
  onClose,
  onSaved,
}: {
  initialName?: string;
  onClose:      () => void;
  onSaved:      (saved: DoctorRecord) => void;
}) {
  const [form,       setForm]       = useState<FormState>({ ...BLANK, name: initialName });
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  function field<K extends keyof FormState>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) { setError("Doctor name is required"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        name:           form.name.trim(),
        registrationNo: form.registrationNo.trim() || undefined,
        specialty:      form.specialty.trim()      || undefined,
        clinic:         form.clinic.trim()         || undefined,
        phone:          form.phone.trim()          || undefined,
        email:          form.email.trim()          || undefined,
        address:        form.address.trim()        || undefined,
      };
      const res = await api.post<{ data: DoctorRecord }>("/doctors", body);
      onSaved(res.data.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } } };
      setError(e?.response?.data?.message ?? e?.response?.data?.error ?? "Failed to save doctor");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1,    opacity: 1, y: 0  }}
        exit={{   scale: 0.95, opacity: 0, y: 6  }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden"
      >
        {/* Header — matches CustomerModal blue */}
        <div className="bg-blue-700 px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-blue-200 text-[11px] font-semibold tracking-wide uppercase">
              Doctor Master
            </p>
            <h2 className="text-white text-[18px] font-bold leading-snug">Add New Doctor</h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 bg-white text-blue-700 font-bold text-[13px] px-5 py-2 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-60"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Add Doctor
            </button>
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(100vh-180px)]">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-2.5 rounded-lg overflow-hidden"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Row 1: Name + Registration No */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Doctor Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={field("name")}
                placeholder="Dr. Full Name"
                autoFocus
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Registration No.
              </label>
              <input
                type="text"
                value={form.registrationNo}
                onChange={field("registrationNo")}
                placeholder="MCI / State council no."
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Row 2: Specialty + Clinic */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Specialty
              </label>
              <input
                type="text"
                value={form.specialty}
                onChange={field("specialty")}
                placeholder="e.g. General Physician"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Clinic / Hospital
              </label>
              <input
                type="text"
                value={form.clinic}
                onChange={field("clinic")}
                placeholder="Clinic or hospital name"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Row 3: Phone + Email */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Phone
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={field("phone")}
                placeholder="Contact number"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={field("email")}
                placeholder="Email address"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Row 4: Address */}
          <div>
            <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
              Address
            </label>
            <input
              type="text"
              value={form.address}
              onChange={field("address")}
              placeholder="Clinic / home address"
              className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
