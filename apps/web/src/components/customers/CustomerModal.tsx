"use client";

import { useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  isClean,
  normalizeIndianMobile,
  sanitizePersonName,
  validateEmail,
  validateIndianMobile,
  validatePersonName,
} from "@pharmacy/utils";
import { api, getErrorMessage } from "@/lib/api-client";
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
  state?:          string | null;
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
  state:           string;
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

type FieldErrors = Partial<Record<"firstName" | "lastName" | "phone" | "email", string | null>>;

/** Inline message under a field. Renders nothing when the field is fine. */
function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-[11px] text-red-600 font-medium mt-1">
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      {message}
    </p>
  );
}

function toFormState(c?: CustomerRecord): FormState {
  if (!c) {
    return {
      firstName: "", lastName: "", phone: "", email: "",
      gender: "", dateOfBirth: "", abhaNumber: "", cardNumber: "",
      customerType: "REGISTERED", defaultDiscount: "0",
      creditLimit: "", address: "", state: "", notes: "",
    };
  }
  const [firstName, lastName] = splitName(c.name);
  return {
    firstName,
    lastName,
    // Records created before the phone rule existed can hold "+91 98765 43210" or
    // "98765-43210". Normalising on open lets those save again untouched instead of
    // stopping the pharmacist with an error about a number they never typed.
    phone:           normalizeIndianMobile(c.phone ?? ""),
    email:           c.email           ?? "",
    gender:          (c.gender as FormState["gender"]) ?? "",
    dateOfBirth:     c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : "",
    abhaNumber:      c.abhaNumber  ?? "",
    cardNumber:      c.cardNumber  ?? "",
    customerType:    c.customerType as FormState["customerType"],
    defaultDiscount: String(c.defaultDiscount ?? 0),
    creditLimit:     c.creditLimit ? String(c.creditLimit) : "",
    address:         c.address ?? "",
    state:           c.state   ?? "",
    notes:           c.notes   ?? "",
  };
}

/**
 * A walk-in often has no number to give. Demanding one anyway produces worse data
 * than an empty field — staff type "0000000000" and the pharmacy ends up with a
 * thousand customers sharing a phone number. Every other type is being deliberately
 * registered, so a contact number is the point.
 *
 * Mirrors @PhoneRequiredUnlessWalkIn on CustomerRequest; the two must agree.
 */
function phoneIsRequired(customerType: FormState["customerType"]): boolean {
  return customerType !== "WALK_IN";
}

/**
 * Every rule the form enforces, in one place, so submit and blur cannot disagree
 * about whether a value is acceptable. Mirrors the constraints on CustomerRequest.
 */
function validateAll(f: FormState): FieldErrors {
  return {
    firstName: validatePersonName(f.firstName, { label: "First name" }),
    lastName:  validatePersonName(f.lastName, { label: "Last name", required: false }),
    phone:     validateIndianMobile(f.phone, { required: phoneIsRequired(f.customerType) }),
    email:     validateEmail(f.email),
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
  const [showAddress, setShowAddress] = useState(!!(customer?.address || customer?.state));
  const [showNotes,   setShowNotes]   = useState(!!(customer?.notes));
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [errors,      setErrors]      = useState<FieldErrors>({});

  function field<K extends keyof FormState>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  /**
   * Sanitised fields clear their own error the moment the value becomes valid.
   * Leaving "First name is required" on screen while someone is actively typing
   * their name reads as though the form is still refusing them.
   */
  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key as keyof FieldErrors] ? { ...e, [key]: null } : e));
  }

  /**
   * Validate one field on blur, so problems surface before the Add button is hit.
   * The value is taken from the event rather than from `form`, because tabbing away
   * immediately after the last keystroke can run this handler against the render
   * that has not seen that keystroke yet.
   */
  function blur(key: keyof FieldErrors) {
    return (e: React.FocusEvent<HTMLInputElement>) =>
      setErrors((prev) => ({ ...prev, [key]: validateAll({ ...form, [key]: e.target.value })[key] }));
  }

  async function handleSubmit() {
    const found = validateAll(form);
    setErrors(found);
    if (!isClean(found)) {
      // The Add button lives in the header and the fields scroll under it, so the
      // offending field can be off screen — say something rather than appear dead.
      setError("Please correct the highlighted fields below.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const body = {
      name:            [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" "),
      // Send the bare digits — the column is matched on directly when looking a
      // customer up at the counter, so one person must not exist under two spellings.
      phone:           normalizeIndianMobile(form.phone) || undefined,
      email:           form.email.trim()       || undefined,
      gender:          form.gender             || undefined,
      dateOfBirth:     form.dateOfBirth        || undefined,
      abhaNumber:      form.abhaNumber.trim()  || undefined,
      cardNumber:      form.cardNumber.trim()  || undefined,
      customerType:    form.customerType,
      defaultDiscount: parseFloat(form.defaultDiscount) || 0,
      creditLimit:     parseFloat(form.creditLimit)     || 0,
      address:         form.address.trim()     || undefined,
      state:           form.state.trim()       || undefined,
      notes:           form.notes.trim()       || undefined,
    };

    try {
      const res = isEdit
        ? await api.patch<{ data: CustomerRecord }>(`/customers/${customer.id}`, body)
        : await api.post<{ data: CustomerRecord }>("/customers", body);
      onSaved(res.data.data);
    } catch (err: unknown) {
      // getErrorMessage unwraps the API's error envelope and falls back to the
      // network-level reason, so a failure never surfaces as a bare "Failed to save".
      setError(getErrorMessage(err, "Failed to save customer"));
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
            {/* Was "Verify Customer's Mobile with OTP &" over a field that was neither
                verified nor required. Promising an OTP step that does not exist is a
                worse defect than the missing validation it sat above. */}
            <p className="text-blue-200 text-[11px] font-semibold tracking-wide uppercase">
              {isEdit ? "Edit Customer" : "New Customer"}
            </p>
            <h2 className="text-white text-[18px] font-bold leading-snug">
              {isEdit ? customer.name : "Add a new customer"}
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

          {/* Row 1: Mobile + Email */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Mobile Number
                {phoneIsRequired(form.customerType)
                  ? <span className="text-red-500"> *</span>
                  : <span className="text-slate-400 normal-case font-medium"> (optional for walk-ins)</span>}
              </label>
              <div className={cn(
                "flex items-center gap-2 border-b pb-1 transition-colors",
                errors.phone ? "border-red-400" : "border-slate-300 focus-within:border-blue-500",
              )}>
                <span className="text-[13px] text-slate-400 select-none flex-shrink-0">+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={form.phone}
                  // Letters simply do not appear, and a pasted "+91 98765 43210"
                  // becomes the number. No maxLength — it would chop a pasted value
                  // before the country code could be stripped off it.
                  onChange={(e) => setField("phone", normalizeIndianMobile(e.target.value))}
                  onBlur={blur("phone")}
                  placeholder="98765 43210"
                  className="flex-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none"
                />
              </div>
              <FieldError message={errors.phone} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={field("email")}
                onBlur={blur("email")}
                placeholder="Email Address"
                className={cn(
                  "w-full border-b pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors",
                  errors.email ? "border-red-400" : "border-slate-300 focus:border-blue-500",
                )}
              />
              <FieldError message={errors.email} />
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
                // Digits and symbols are dropped as they are typed, so a name can
                // never reach the payload with a "2" in it.
                onChange={(e) => setField("firstName", sanitizePersonName(e.target.value))}
                onBlur={blur("firstName")}
                placeholder="First Name"
                autoFocus={!isEdit}
                className={cn(
                  "w-full border-b pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors",
                  errors.firstName ? "border-red-400" : "border-slate-300 focus:border-blue-500",
                )}
              />
              <FieldError message={errors.firstName} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                Last Name
              </label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setField("lastName", sanitizePersonName(e.target.value))}
                onBlur={blur("lastName")}
                placeholder="Last Name"
                className={cn(
                  "w-full border-b pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors",
                  errors.lastName ? "border-red-400" : "border-slate-300 focus:border-blue-500",
                )}
              />
              <FieldError message={errors.lastName} />
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
                // Changing the type changes whether the phone is required, so its
                // error is recomputed here — otherwise switching to Walk-in would
                // leave a stale "Mobile number is required" on a field that no
                // longer needs one.
                onChange={(e) => {
                  const customerType = e.target.value as FormState["customerType"];
                  setForm((f) => ({ ...f, customerType }));
                  setErrors((prev) => ({
                    ...prev,
                    phone: validateAll({ ...form, customerType }).phone,
                  }));
                }}
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
            <div className="grid grid-cols-3 gap-5">
              <div className="col-span-2">
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
              <div>
                <label className="block text-[11px] font-bold text-blue-700 mb-1.5 uppercase tracking-wide">
                  State
                </label>
                <input
                  type="text"
                  value={form.state}
                  onChange={field("state")}
                  placeholder="Maharashtra"
                  className="w-full border-b border-slate-300 focus:border-blue-500 pb-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none transition-colors"
                />
              </div>
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
