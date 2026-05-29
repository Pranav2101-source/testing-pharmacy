"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { z } from "zod";
import {
  Building2, User, Phone, Mail, Lock, Eye, EyeOff,
  ArrowRight, ArrowLeft, CheckCircle2, AlertCircle,
  MapPin, Hash, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Validation schemas per step ──────────────────────────────
const step1Schema = z.object({
  pharmacyName: z.string().min(2, "Pharmacy name must be at least 2 characters"),
  ownerName:    z.string().min(2, "Owner name must be at least 2 characters"),
  phone:        z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  city:         z.string().optional(),
});

const step2Schema = z.object({
  email:    z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirm:  z.string(),
}).refine(d => d.password === d.confirm, {
  message: "Passwords do not match",
  path:    ["confirm"],
});

type Step1 = z.infer<typeof step1Schema>;
type Step2 = z.infer<typeof step2Schema>;
type FieldErr = Record<string, string>;

// ─── Password strength ────────────────────────────────────────
function pwStrength(pw: string) {
  const checks = [
    pw.length >= 8,
    /[A-Z]/.test(pw),
    /[a-z]/.test(pw),
    /[0-9]/.test(pw),
    /[^A-Za-z0-9]/.test(pw),
  ];
  const score = checks.filter(Boolean).length;
  const labels = ["", "Weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["", "bg-red-400", "bg-red-400", "bg-amber-400", "bg-yellow-400", "bg-emerald-500"];
  return { score, label: labels[score] ?? "Strong", color: colors[score] ?? "bg-emerald-500" };
}

// ─── Input field ──────────────────────────────────────────────
function Input({
  icon: Icon, placeholder, value, onChange, type = "text", disabled, error,
  right,
}: {
  icon:        React.ElementType;
  placeholder: string;
  value:       string;
  onChange:    (v: string) => void;
  type?:       string;
  disabled?:   boolean;
  error?:      boolean;
  right?:      React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={cn(
      "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all",
      error   ? "border-red-300 bg-white"  :
      focused ? "border-brand-400 ring-1 ring-brand-200 bg-white" :
                "border-slate-200 hover:border-slate-300 bg-white"
    )}>
      <Icon className={cn("w-4 h-4 flex-shrink-0", focused && !error ? "text-brand-500" : error ? "text-red-400" : "text-slate-400")} strokeWidth={1.8} />
      <input
        type={type} placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        disabled={disabled}
        className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none disabled:cursor-not-allowed"
      />
      {right}
    </div>
  );
}

function FieldWrap({ label, error, required, children }: {
  label: string; error?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-600">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />{error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Indian states ────────────────────────────────────────────
const STATES = [
  "Andhra Pradesh","Assam","Bihar","Chhattisgarh","Delhi","Goa","Gujarat",
  "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh",
  "Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab",
  "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh",
  "Uttarakhand","West Bengal",
];

// ─── Step indicator ───────────────────────────────────────────
function Steps({ current }: { current: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 mb-7">
      {([1, 2] as const).map((n) => (
        <div key={n} className="flex items-center gap-2">
          <div className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all",
            n < current  ? "bg-brand-600 text-white"          :
            n === current? "bg-brand-600 text-white ring-4 ring-brand-100" :
                           "bg-slate-100 text-slate-400"
          )}>
            {n < current ? <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> : n}
          </div>
          <span className={cn("text-xs font-semibold", n === current ? "text-slate-700" : "text-slate-400")}>
            {n === 1 ? "Pharmacy Details" : "Account Setup"}
          </span>
          {n < 2 && <div className={cn("w-8 h-0.5 rounded-full mx-1", n < current ? "bg-brand-500" : "bg-slate-200")} />}
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function RegisterPage() {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [pharmacyName, setPharmacyName] = useState("");
  const [ownerName,    setOwnerName]    = useState("");
  const [phone,        setPhone]        = useState("");
  const [city,         setCity]         = useState("");

  // Step 2 state
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [showCf,   setShowCf]   = useState(false);

  // Optional extras (step 2)
  const [showExtra,   setShowExtra]   = useState(false);
  const [gstin,       setGstin]       = useState("");
  const [drugLicense, setDrugLicense] = useState("");
  const [address,     setAddress]     = useState("");
  const [state,       setState_]      = useState("");
  const [pincode,     setPincode]     = useState("");

  const [errors,      setErrors]      = useState<FieldErr>({});
  const [apiErr,      setApiErr]      = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [success,     setSuccess]     = useState(false);

  const strength = pwStrength(password);

  // ── Step 1 validation ───────────────────────────────────────
  function validateStep1(): boolean {
    const result = step1Schema.safeParse({ pharmacyName, ownerName, phone, city });
    if (result.success) { setErrors({}); return true; }
    const e: FieldErr = {};
    result.error.errors.forEach(err => { e[err.path[0] as string] = err.message; });
    setErrors(e);
    return false;
  }

  // ── Step 2 validation ───────────────────────────────────────
  function validateStep2(): boolean {
    const result = step2Schema.safeParse({ email, password, confirm });
    if (result.success) { setErrors({}); return true; }
    const e: FieldErr = {};
    result.error.errors.forEach(err => { e[err.path[0] as string] = err.message; });
    setErrors(e);
    return false;
  }

  function handleNext() {
    if (validateStep1()) setStep(2);
  }

  async function handleSubmit() {
    if (!validateStep2()) return;
    setApiErr(null);
    setSubmitting(true);
    try {
      const payload = {
        pharmacyName, ownerName, phone, email, password,
        ...(city         ? { city }         : {}),
        ...(gstin        ? { gstin }        : {}),
        ...(drugLicense  ? { drugLicense }  : {}),
        ...(address      ? { address }      : {}),
        ...(state        ? { state }        : {}),
        ...(pincode      ? { pincode }      : {}),
      };

      const res  = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/auth/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const json = await res.json() as {
        success: boolean;
        data?:   { tokens: { accessToken: string } };
        error?:  string;
      };

      if (!json.success || !json.data) {
        setApiErr(json.error ?? "Registration failed. Please try again.");
        return;
      }

      localStorage.setItem("token", json.data.tokens.accessToken);
      document.cookie = `auth-token=${json.data.tokens.accessToken}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
      setSuccess(true);
      setTimeout(() => { window.location.href = "/dashboard"; }, 800);
    } catch {
      setApiErr("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-sm"
    >
      {/* Mobile logo */}
      <div className="flex items-center justify-center gap-2.5 mb-8 lg:hidden">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#0c1f5c,#1a3080)" }}>
          <span className="text-white font-black text-xl leading-none">+</span>
        </div>
        <div className="leading-none">
          <p className="font-extrabold text-slate-800 text-base">Checkup</p>
          <p className="text-slate-400 text-[10px] font-semibold tracking-widest uppercase">Pharmacy</p>
        </div>
      </div>

      {/* Heading */}
      <div className="mb-7">
        <h2 className="text-2xl font-black text-slate-800">Create your account</h2>
        <p className="text-sm text-slate-500 mt-1">Set up your pharmacy in under 2 minutes</p>
      </div>

      {/* Step indicator */}
      <Steps current={step} />

      {/* Form card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-card-md overflow-hidden">

        {/* API error */}
        <AnimatePresence>
          {apiErr && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
              className="overflow-hidden">
              <div className="flex items-start gap-2.5 px-5 py-3.5 bg-red-50 border-b border-red-100">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-sm text-red-600 font-medium">{apiErr}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">

          {/* ── STEP 1 ─────────────────────────────────────── */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
              className="p-7 space-y-4">

              <FieldWrap label="Pharmacy Name" required error={errors.pharmacyName}>
                <Input icon={Building2} placeholder="e.g. Radhika Medical Hall" value={pharmacyName} onChange={setPharmacyName} error={!!errors.pharmacyName} />
              </FieldWrap>

              <FieldWrap label="Owner / Manager Name" required error={errors.ownerName}>
                <Input icon={User} placeholder="Full name" value={ownerName} onChange={setOwnerName} error={!!errors.ownerName} />
              </FieldWrap>

              <FieldWrap label="Mobile Number" required error={errors.phone}>
                <div className={cn(
                  "flex items-center rounded-xl border transition-all overflow-hidden",
                  errors.phone ? "border-red-300" : "border-slate-200 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200"
                )}>
                  <span className="flex items-center gap-1.5 px-3 py-2.5 border-r border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 flex-shrink-0">
                    🇮🇳 +91
                  </span>
                  <div className="flex items-center gap-2 px-3 flex-1">
                    <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
                    <input
                      type="tel" placeholder="98765 43210" value={phone} maxLength={10}
                      onChange={e => setPhone(e.target.value.replace(/\D/g, ""))}
                      className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none py-2.5"
                    />
                  </div>
                </div>
              </FieldWrap>

              <FieldWrap label="City" error={errors.city}>
                <Input icon={MapPin} placeholder="e.g. Ranchi" value={city} onChange={setCity} />
              </FieldWrap>

              <button
                type="button" onClick={handleNext}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-sm font-bold text-white shadow-card-md transition-all mt-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* ── STEP 2 ─────────────────────────────────────── */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
              className="p-7 space-y-4">

              <FieldWrap label="Email Address" required error={errors.email}>
                <Input icon={Mail} placeholder="you@pharmacy.com" value={email} onChange={setEmail} type="email" error={!!errors.email} />
              </FieldWrap>

              <FieldWrap label="Password" required error={errors.password}>
                <Input
                  icon={Lock} placeholder="Min. 8 characters" value={password} onChange={setPassword}
                  type={showPw ? "text" : "password"} error={!!errors.password}
                  right={
                    <button type="button" onClick={() => setShowPw(v => !v)} className="text-slate-400 hover:text-slate-600 transition-colors">
                      {showPw ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
                    </button>
                  }
                />
                {/* Strength bar */}
                {password.length > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 mt-1">
                    <div className="flex gap-1 flex-1">
                      {[0,1,2,3,4].map(i => (
                        <div key={i} className="flex-1 h-1 rounded-full overflow-hidden bg-slate-100">
                          <motion.div animate={{ width: i < strength.score ? "100%" : "0%" }} transition={{ duration: 0.2 }}
                            className={cn("h-full rounded-full", strength.color)} />
                        </div>
                      ))}
                    </div>
                    <span className={cn("text-[10px] font-bold", strength.score >= 4 ? "text-emerald-600" : strength.score >= 3 ? "text-yellow-600" : "text-red-500")}>
                      {strength.label}
                    </span>
                  </motion.div>
                )}
              </FieldWrap>

              <FieldWrap label="Confirm Password" required error={errors.confirm}>
                <Input
                  icon={Lock} placeholder="Re-enter password" value={confirm} onChange={setConfirm}
                  type={showCf ? "text" : "password"} error={!!errors.confirm}
                  right={
                    <button type="button" onClick={() => setShowCf(v => !v)} className="text-slate-400 hover:text-slate-600 transition-colors">
                      {showCf ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
                    </button>
                  }
                />
              </FieldWrap>

              {/* Optional details accordion */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowExtra(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <span>Optional: GST, Drug License, Address</span>
                  <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", showExtra && "rotate-180")} />
                </button>
                <AnimatePresence>
                  {showExtra && (
                    <motion.div
                      initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-slate-200"
                    >
                      <div className="p-4 space-y-3">
                        <FieldWrap label="GSTIN">
                          <Input icon={Hash} placeholder="22AAAAA0000A1Z5" value={gstin} onChange={setGstin} />
                        </FieldWrap>
                        <FieldWrap label="Drug License No.">
                          <Input icon={Hash} placeholder="DL-XX-123456" value={drugLicense} onChange={setDrugLicense} />
                        </FieldWrap>
                        <FieldWrap label="Address">
                          <Input icon={MapPin} placeholder="Street, Area" value={address} onChange={setAddress} />
                        </FieldWrap>
                        <div className="grid grid-cols-2 gap-3">
                          <FieldWrap label="State">
                            <div className="relative">
                              <select
                                value={state} onChange={e => setState_(e.target.value)}
                                className="w-full appearance-none pl-3 pr-7 py-2.5 text-sm text-slate-700 bg-white border border-slate-200 rounded-xl focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
                              >
                                <option value="">Select</option>
                                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                            </div>
                          </FieldWrap>
                          <FieldWrap label="Pincode">
                            <input
                              type="text" maxLength={6} placeholder="834001" value={pincode}
                              onChange={e => setPincode(e.target.value.replace(/\D/g, ""))}
                              className="px-3 py-2.5 text-sm text-slate-700 bg-white border border-slate-200 rounded-xl focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none w-full"
                            />
                          </FieldWrap>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={() => { setStep(1); setErrors({}); setApiErr(null); }}
                  className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
                <motion.button
                  type="button" onClick={handleSubmit}
                  disabled={submitting || success}
                  whileHover={!submitting && !success ? { scale: 1.01 } : undefined}
                  whileTap={!submitting && !success ? { scale: 0.98 } : undefined}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all",
                    success    ? "bg-emerald-500 text-white"                        :
                    submitting ? "bg-brand-400 text-white cursor-not-allowed"       :
                                 "bg-brand-600 hover:bg-brand-700 text-white shadow-card-md"
                  )}
                >
                  {success ? (
                    <><CheckCircle2 className="w-4 h-4" /> Account created!</>
                  ) : submitting ? (
                    <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Creating…</>
                  ) : (
                    <>Create Account <ArrowRight className="w-4 h-4" /></>
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Login link */}
      <p className="text-center text-sm text-slate-500 mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-brand-600 hover:text-brand-700 font-bold transition-colors">
          Sign in
        </Link>
      </p>
    </motion.div>
  );
}
