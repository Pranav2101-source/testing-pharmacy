import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import {
  Building2, User, Phone, Mail, Lock, Eye, EyeOff,
  ArrowRight, ArrowLeft, CheckCircle2, AlertCircle,
  MapPin, Hash, ChevronDown, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { storeTokens, storeUser, type StoredUser } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/api-client";
import {
  normalizeIndianMobile,
  sanitizePersonName,
  validateIndianMobile,
  validatePersonName,
} from "@pharmacy/utils";

const step1Schema = z.object({
  // A pharmacy is a business: "24x7 Medicos" and "A-1 Medical Store" are real shop
  // names, so this one keeps a length rule and nothing more.
  pharmacyName: z.string().trim().min(2, "Pharmacy name must be at least 2 characters"),
  // The owner is a person. Shared with the backend's @PersonName so the form and the
  // API agree on what a name is.
  ownerName: z.string()
    .min(2, "Owner name must be at least 2 characters")
    .superRefine((value, ctx) => {
      const message = validatePersonName(value, { label: "Owner name" });
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }),
  phone: z.string().superRefine((value, ctx) => {
    const message = validateIndianMobile(value);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }),
  city: z.string().optional(),
});

const step2Schema = z.object({
  email:    z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirm:  z.string(),
}).refine(d => d.password === d.confirm, { message: "Passwords do not match", path: ["confirm"] });

type FieldErr = Record<string, string>;

function pwStrength(pw: string) {
  const score = [pw.length >= 8, /[A-Z]/.test(pw), /[a-z]/.test(pw), /[0-9]/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
  const labels = ["", "Weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["", "bg-red-400", "bg-red-400", "bg-amber-400", "bg-yellow-400", "bg-emerald-500"];
  return { score, label: labels[score] ?? "Strong", color: colors[score] ?? "bg-emerald-500" };
}

function Field({ label, error, required, children, htmlFor }: {
  label: string; error?: string; required?: boolean; children: React.ReactNode; htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-slate-700">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

function Input({ icon: Icon, placeholder, value, onChange, type = "text", error, right, id, name }: {
  icon: React.ElementType; placeholder: string; value: string;
  onChange: (v: string) => void; type?: string; error?: boolean; right?: React.ReactNode;
  id?: string; name?: string;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2.5 px-3.5 py-3 rounded-xl border bg-white transition-all duration-150",
      error
        ? "border-red-300 focus-within:border-red-400"
        : "border-slate-200 focus-within:border-blue-500 focus-within:ring-3 focus-within:ring-blue-100"
    )}>
      <Icon className={cn("w-4 h-4 flex-shrink-0", error ? "text-red-400" : "text-slate-400")} strokeWidth={1.8} />
      <input
        id={id} name={name ?? id}
        type={type} placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
      />
      {right}
    </div>
  );
}

function Stepper({ current }: { current: 1 | 2 }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      <div className="flex items-center gap-2">
        <div className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all duration-200",
          current >= 1 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"
        )}>
          {current > 1 ? <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> : "1"}
        </div>
        <span className={cn("text-sm font-semibold transition-colors", current === 1 ? "text-slate-800" : "text-slate-400")}>
          Pharmacy Details
        </span>
      </div>
      <div className="flex-1 mx-3 h-px bg-slate-200 relative" style={{ minWidth: 32 }}>
        <div className="absolute inset-y-0 left-0 bg-blue-500 transition-all duration-300" style={{ width: current > 1 ? "100%" : "0%" }} />
      </div>
      <div className="flex items-center gap-2">
        <div className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all duration-200",
          current === 2 ? "bg-blue-600 text-white ring-4 ring-blue-100" : "bg-slate-100 text-slate-400"
        )}>2</div>
        <span className={cn("text-sm font-semibold transition-colors", current === 2 ? "text-slate-800" : "text-slate-400")}>
          Account Setup
        </span>
      </div>
    </div>
  );
}

const STATES = [
  "Andhra Pradesh","Assam","Bihar","Chhattisgarh","Delhi","Goa","Gujarat","Haryana",
  "Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra",
  "Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim",
  "Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal",
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);

  const [pharmacyName, setPharmacyName] = useState("");
  const [ownerName,    setOwnerName]    = useState("");
  const [phone,        setPhone]        = useState("");
  const [city,         setCity]         = useState("");

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [showCf,   setShowCf]   = useState(false);

  const [showExtra,   setShowExtra]   = useState(false);
  const [gstin,       setGstin]       = useState("");
  const [drugLicense, setDrugLicense] = useState("");
  const [address,     setAddress]     = useState("");
  const [stateVal,    setStateVal]    = useState("");
  const [pincode,     setPincode]     = useState("");

  const [errors,     setErrors]     = useState<FieldErr>({});
  const [apiErr,     setApiErr]     = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success,    setSuccess]    = useState(false);

  const strength = pwStrength(password);

  function validateStep1() {
    const r = step1Schema.safeParse({ pharmacyName, ownerName, phone, city });
    if (r.success) { setErrors({}); return true; }
    const e: FieldErr = {};
    r.error.errors.forEach(err => { e[err.path[0] as string] = err.message; });
    setErrors(e); return false;
  }

  function validateStep2() {
    const r = step2Schema.safeParse({ email, password, confirm });
    if (r.success) { setErrors({}); return true; }
    const e: FieldErr = {};
    r.error.errors.forEach(err => { e[err.path[0] as string] = err.message; });
    setErrors(e); return false;
  }

  function handleNext() { if (validateStep1()) { setErrors({}); setStep(2); } }

  async function handleSubmit() {
    if (!validateStep2()) return;
    setApiErr(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // credentials: include is required so the browser stores the httpOnly
        // refresh-token cookie from the Set-Cookie response header.
        credentials: "include",
        body: JSON.stringify({
          pharmacyName, ownerName, phone, email, password,
          ...(city        && { city }),
          ...(gstin       && { gstin }),
          ...(drugLicense && { drugLicense }),
          ...(address     && { address }),
          ...(stateVal    && { state: stateVal }),
          ...(pincode     && { pincode }),
        }),
      });
      const json = await res.json() as {
        success: boolean; data?: { accessToken: string; user: StoredUser }; error?: string;
      };
      if (!json.success || !json.data) { setApiErr(json.error ?? "Registration failed."); return; }
      // Refresh token is in an httpOnly cookie set by the server. Store only the
      // access token in JS memory.
      storeTokens(json.data.accessToken);
      storeUser(json.data.user);
      setSuccess(true);
      setTimeout(() => navigate("/dashboard"), 800);
    } catch {
      setApiErr("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <div className="flex justify-end p-5">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1.5 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
          All Systems Operational
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-7">
            <h1 className="text-2xl font-black text-slate-900">Create your account</h1>
            <p className="text-slate-500 text-sm mt-1.5">Set up your pharmacy in under 2 minutes</p>
          </div>

          <Stepper current={step} />

          {apiErr && (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl mb-5">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
              <p className="text-sm text-red-600 font-medium">{apiErr}</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <Field label="Pharmacy Name" required error={errors.pharmacyName} htmlFor="reg-pharmacy-name">
                <Input id="reg-pharmacy-name" icon={Building2} placeholder="e.g. Radhika Medical Hall"
                  value={pharmacyName} onChange={setPharmacyName} error={!!errors.pharmacyName} />
              </Field>

              <Field label="Owner / Manager Name" required error={errors.ownerName} htmlFor="reg-owner-name">
                {/* Digits and symbols are dropped as they are typed, the same way the
                    mobile field below drops letters. */}
                <Input id="reg-owner-name" icon={User} placeholder="Full name"
                  value={ownerName} onChange={(v) => setOwnerName(sanitizePersonName(v))}
                  error={!!errors.ownerName} />
              </Field>

              <Field label="Mobile Number" required error={errors.phone} htmlFor="reg-phone">
                <div className={cn(
                  "flex items-center rounded-xl border overflow-hidden transition-all duration-150 bg-white",
                  errors.phone ? "border-red-300" : "border-slate-200 focus-within:border-blue-500 focus-within:ring-3 focus-within:ring-blue-100"
                )}>
                  <span className="flex items-center gap-1 px-3 py-3 border-r border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 flex-shrink-0 select-none">
                    🇮🇳 +91
                  </span>
                  <div className="flex items-center gap-2 px-3 flex-1">
                    <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
                    <input
                      id="reg-phone" name="phone"
                      type="tel" placeholder="98765 43210" value={phone}
                      // No maxLength: the browser applies it to the pasted text BEFORE
                      // onChange, so "+91 98765 43210" would arrive already chopped to
                      // "+91 98765 " and normalise to a 7-digit number. The normaliser
                      // does the capping instead, after the country code is stripped.
                      onChange={e => setPhone(normalizeIndianMobile(e.target.value))}
                      className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none py-0"
                    />
                  </div>
                </div>
              </Field>

              <Field label="City" error={errors.city} htmlFor="reg-city">
                <Input id="reg-city" icon={MapPin} placeholder="e.g. Ranchi" value={city} onChange={setCity} />
              </Field>

              <button
                type="button" onClick={handleNext}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-bold transition-colors duration-150 shadow-md shadow-blue-200 mt-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>

              <p className="text-center text-sm text-slate-400 mt-4">
                Already have an account?{" "}
                <Link to="/login" className="text-blue-600 hover:text-blue-700 font-semibold transition-colors">
                  Sign in
                </Link>
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Field label="Email Address" required error={errors.email} htmlFor="reg-email">
                <Input id="reg-email" icon={Mail} placeholder="you@pharmacy.com"
                  value={email} onChange={setEmail} type="email" error={!!errors.email} />
              </Field>

              <Field label="Password" required error={errors.password} htmlFor="reg-password">
                <Input
                  id="reg-password" icon={Lock} placeholder="Min. 8 characters"
                  value={password} onChange={setPassword}
                  type={showPw ? "text" : "password"} error={!!errors.password}
                  right={
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="text-slate-400 hover:text-slate-600 transition-colors">
                      {showPw ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
                    </button>
                  }
                />
                {password.length > 0 && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex gap-1 flex-1">
                      {[0,1,2,3,4].map(i => (
                        <div key={i} className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all duration-200", i < strength.score ? strength.color : "")}
                            style={{ width: i < strength.score ? "100%" : "0%" }} />
                        </div>
                      ))}
                    </div>
                    <span className={cn("text-[10px] font-bold",
                      strength.score >= 4 ? "text-emerald-600" : strength.score >= 3 ? "text-yellow-600" : "text-red-500"
                    )}>{strength.label}</span>
                  </div>
                )}
              </Field>

              <Field label="Confirm Password" required error={errors.confirm} htmlFor="reg-confirm">
                <Input
                  id="reg-confirm" icon={Lock} placeholder="Re-enter password"
                  value={confirm} onChange={setConfirm}
                  type={showCf ? "text" : "password"} error={!!errors.confirm}
                  right={
                    <button type="button" onClick={() => setShowCf(v => !v)}
                      className="text-slate-400 hover:text-slate-600 transition-colors">
                      {showCf ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
                    </button>
                  }
                />
              </Field>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button" onClick={() => setShowExtra(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors duration-150"
                >
                  <span>Optional: GST, Drug License, Address</span>
                  <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform duration-200", showExtra && "rotate-180")} />
                </button>
                {showExtra && (
                  <div className="border-t border-slate-200 p-4 space-y-3">
                    <Field label="GSTIN" htmlFor="reg-gstin">
                      <Input id="reg-gstin" icon={Hash} placeholder="22AAAAA0000A1Z5" value={gstin} onChange={setGstin} />
                    </Field>
                    <Field label="Drug License No." htmlFor="reg-drug-license">
                      <Input id="reg-drug-license" icon={Hash} placeholder="DL-XX-123456" value={drugLicense} onChange={setDrugLicense} />
                    </Field>
                    <Field label="Address" htmlFor="reg-address">
                      <Input id="reg-address" icon={MapPin} placeholder="Street, Area" value={address} onChange={setAddress} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="State" htmlFor="reg-state">
                        <div className="relative">
                          <select id="reg-state" name="state" value={stateVal} onChange={e => setStateVal(e.target.value)}
                            className="w-full appearance-none pl-3 pr-7 py-3 text-sm text-slate-700 bg-white border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-3 focus:ring-blue-100 outline-none transition-all">
                            <option value="">Select</option>
                            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>
                      </Field>
                      <Field label="Pincode" htmlFor="reg-pincode">
                        <input id="reg-pincode" name="pincode" type="text" maxLength={6} placeholder="834001" value={pincode}
                          onChange={e => setPincode(e.target.value.replace(/\D/g, ""))}
                          className="px-3.5 py-3 text-sm text-slate-700 bg-white border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-3 focus:ring-blue-100 outline-none w-full transition-all" />
                      </Field>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={() => { setStep(1); setErrors({}); setApiErr(null); }}
                  className="flex items-center gap-1.5 px-4 py-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors duration-150"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
                <button
                  type="button" onClick={handleSubmit}
                  disabled={submitting || success}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold transition-colors duration-150",
                    success    ? "bg-emerald-500 text-white"                         :
                    submitting ? "bg-blue-400 text-white cursor-not-allowed"         :
                                 "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-md shadow-blue-200"
                  )}
                >
                  {success ? (
                    <><CheckCircle2 className="w-4 h-4" /> Account created!</>
                  ) : submitting ? (
                    <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Creating…</>
                  ) : (
                    <>Create Account <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </div>

              <div className="flex items-start gap-3 mt-2 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <Shield className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                <div>
                  <p className="text-sm font-bold text-slate-700">Your data is safe with us</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    We follow industry best practices to keep your business information secure.
                  </p>
                </div>
              </div>

              <p className="text-center text-sm text-slate-400">
                Already have an account?{" "}
                <Link to="/login" className="text-blue-600 hover:text-blue-700 font-semibold transition-colors">
                  Sign in
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
