"use client";

import { useState } from "react";
import { X, Loader2, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type CustomerRecord = {
  id:              string;
  name:            string;
  phone:           string | null;
  email:           string | null;
  customerType:    string;
  defaultDiscount: number;
  creditLimit:     number;
  creditUsed:      number;
  abhaNumber?:     string | null;
  cardNumber?:     string | null;
  gender?:         string | null;
  dateOfBirth?:    string | null;
  address?:        string | null;
  notes?:          string | null;
};

type FormState = {
  firstName:       string;
  lastName:        string;
  phone:           string;
  email:           string;
  gender:          "MALE" | "FEMALE" | "";
  dateOfBirth:     string;
  abhaNumber:      string;
  cardNumber:      string;
  customerType:    "WALK_IN" | "REGISTERED" | "CORPORATE" | "CREDIT";
  defaultDiscount: string;
  creditLimit:     string;
  address:         string;
  notes:           string;
};

const TYPE_OPTIONS = [
  { value: "REGISTERED", label: "Registered" },
  { value: "WALK_IN",    label: "Walk-in" },
  { value: "CORPORATE",  label: "Corporate" },
  { value: "CREDIT",     label: "Credit" },
] as const;

function splitName(full: string): [string, string] {
  const idx = full.indexOf(" ");
  if (idx === -1) return [full, ""];
  return [full.slice(0, idx), full.slice(idx + 1)];
}

function toFormState(c?: CustomerRecord): FormState {
  if (!c) {
    return {
      firstName: "", lastName: "", phone: "", email: "",
      gender: "", dateOfBirth: "", abhaNumber: "", cardNumber: "",
      customerType: "REGISTERED", defaultDiscount: "0",
      creditLimit: "", address: "", notes: "",
    };
  }
  const [firstName, lastName] = splitName(c.name);
  return {
    firstName,
    lastName,
    phone:           c.phone           ?? "",
    email:           c.email           ?? "",
    gender:          (c.gender as FormState["gender"]) ?? "",
    dateOfBirth:     c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : "",
    abhaNumber:      c.abhaNumber  ?? "",
    cardNumber:      c.cardNumber  ?? "",
    customerType:    c.customerType as FormState["customerType"],
    defaultDiscount: String(c.defaultDiscount ?? 0),
    creditLimit:     c.creditLimit ? String(c.creditLimit) : "",
    address:         c.address ?? "",
    notes:           c.notes   ?? "",
  };
}

export function CustomerModal({
  customer,
  onClose,
  onSaved,
}: {
  customer?:  CustomerRecord;
  onClose:   () => void;
  onSaved:   (saved: CustomerRecord) => void;
}) {
  const isEdit = !!customer;
  const [form,        setForm]        = useState<FormState>(() => toFormState(customer));
  const [showAddress, setShowAddress] = useState(!!(customer?.address));
  const [showNotes,   setShowNotes]   = useState(!!(customer?.notes));
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  function field<K extends keyof FormState>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit() {
    if (!form.firstName.trim()) { setError("First name is required"); return; }

    setSubmitting(true);
    setError(null);

    const body = {
      name:            [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" "),
      phone:           form.phone.trim()       || undefined,
      email:           form.email.trim()       || undefined,
      gender:          form.gender             || undefined,
      dateOfBirth:     form.dateOfBirth        || undefined,
      abhaNumber:      form.abhaNumber.trim()  || undefined,
      cardNumber:      form.cardNumber.trim()  || undefined,
      customerType:    form.customerType,
      defaultDiscount: parseFloat(form.defaultDiscount) || 0,
      creditLimit:     parseFloat(form.creditLimit)     || 0,
      address:         form.address.trim()     || undefined,
      notes:           form.notes.trim()       || undefined,
    };

    try {
      const res = isEdit
        ? await api.patch<{ data: CustomerRecord }>(`/customers/${customer.id}`, body)
        : await api.post<{ data: CustomerRecord }>("/customers", body);
      onSaved(res.data.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } } };
      setError(e?.response?.data?.message ?? e?.response?.data?.error ?? "Failed to save customer");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
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
          <div>
            <p className="text-blue-200 text-[11px] font-semibold tracking-wide uppercase">
              {isEdit ? "Edit Customer" : "Verify Customer's Mobile with OTP &"}
            </p>
            <h2 className="text-white text-[18px] font-bold leading-snug">
              {isEdit ? customer.name : "Become a Preferred Pharmacy!"}
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 bg-white text-blue-700 font-bold text-[13px] px-5 py-2 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-60"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? "Save" : "Add"}
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

          {/* Row 1: Mobile + Verify + Email */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Mobile Number
              </label>
              <div className="flex items-center gap-2 border-b border-slate-300 focus-within:border-blue-500 pb-1 transition-colors">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={field("phone")}
                  placeholder="Mobile Number"
                  className="flex-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none"
                />
                <button
                  type="button"
                  className="text-[11px] font-bold text-blue-600 flex items-center gap-0.5 whitespace-nowrap hover:text-blue-800 transition-colors flex-shrink-0"
                >
                  Verify Mobile <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={field("email")}
                placeholder="Email Address"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Row 2: First Name + Last Name + Default Discount */}
          <div className="grid grid-cols-3 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.firstName}
                onChange={field("firstName")}
                placeholder="First Name"
                autoFocus={!isEdit}
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Last Name
              </label>
              <input
                type="text"
                value={form.lastName}
                onChange={field("lastName")}
                placeholder="Last Name"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Default Discount (%)
              </label>
              <input
                type="number"
                value={form.defaultDiscount}
                onChange={field("defaultDiscount")}
                min="0" max="100" step="0.5"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 bg-transparent focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Row 3: ABHA + DOB + Gender */}
          <div className="grid grid-cols-3 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                ABHA / IPD / OPD Number
              </label>
              <input
                type="text"
                value={form.abhaNumber}
                onChange={field("abhaNumber")}
                placeholder="Enter ABHA/IPD/OPD number"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Date of Birth
              </label>
              <input
                type="date"
                value={form.dateOfBirth}
                onChange={field("dateOfBirth")}
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div className="flex items-end gap-5 pb-1">
              {(["MALE", "FEMALE"] as const).map((g) => (
                <label key={g} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="radio"
                    name={`gender-${isEdit ? customer?.id : "new"}`}
                    value={g}
                    checked={form.gender === g}
                    onChange={() => setForm((f) => ({ ...f, gender: g }))}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-[13px] text-slate-700 group-hover:text-slate-900 transition-colors">
                    {g === "MALE" ? "Male" : "Female"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Row 4: Credit Limit + Card Number + Customer Type */}
          <div className="grid grid-cols-3 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Credit Limit
              </label>
              <input
                type="number"
                value={form.creditLimit}
                onChange={field("creditLimit")}
                placeholder="Ex. 2000"
                min="0"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Card / UHID Number
              </label>
              <input
                type="text"
                value={form.cardNumber}
                onChange={field("cardNumber")}
                placeholder="Loyalty card / UHID"
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Customer Type
              </label>
              <select
                value={form.customerType}
                onChange={field("customerType")}
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 bg-transparent focus:outline-none transition-colors cursor-pointer"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Optional: Address */}
          {!showAddress ? (
            <button
              type="button"
              onClick={() => setShowAddress(true)}
              className="text-[13px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
            >
              + Add Address
            </button>
          ) : (
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Address
              </label>
              <input
                type="text"
                value={form.address}
                onChange={field("address")}
                placeholder="Full address"
                autoFocus
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
              />
            </div>
          )}

          {/* Optional: Notes */}
          {!showNotes ? (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className={cn(
                "text-[13px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors",
                showAddress ? "mt-0" : ""
              )}
            >
              + Add Notes
            </button>
          ) : (
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={field("notes")}
                placeholder="Any notes about this customer..."
                rows={2}
                autoFocus
                className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors resize-none"
              />
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
