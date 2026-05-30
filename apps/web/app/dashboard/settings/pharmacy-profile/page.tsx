"use client";

import { useState, useRef } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  Camera,
  Save,
  Phone,
  Mail,
  MapPin,
  FileText,
  User,
  BadgeCheck,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── reusable field ───────────────────────────────────────────
function Field({
  label,
  icon: Icon,
  placeholder,
  value,
  onChange,
  type = "text",
  hint,
  required,
}: {
  label: string;
  icon: React.ElementType;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-600">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white transition-all duration-150",
          focused
            ? "border-brand-400 shadow-glow-blue ring-1 ring-brand-200"
            : "border-slate-200 hover:border-slate-300"
        )}
      >
        <Icon
          className={cn("w-3.5 h-3.5 flex-shrink-0", focused ? "text-brand-500" : "text-slate-400")}
          strokeWidth={1.8}
        />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
        />
      </div>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── section card ─────────────────────────────────────────────
function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-100">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </motion.div>
  );
}

// ─── page ─────────────────────────────────────────────────────
export default function PharmacyProfilePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saved, setSaved]             = useState(false);

  // Pharmacy fields
  const [pharmacyName,  setPharmacyName]  = useState("");
  const [phone,         setPhone]         = useState("");
  const [email,         setEmail]         = useState("");
  const [gstin,         setGstin]         = useState("");
  const [drugLicense,   setDrugLicense]   = useState("");
  const [addressLine1,  setAddressLine1]  = useState("");
  const [addressLine2,  setAddressLine2]  = useState("");
  const [city,          setCity]          = useState("");
  const [state,         setState]         = useState("");
  const [pincode,       setPincode]       = useState("");

  // Owner fields
  const [ownerName,  setOwnerName]  = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPAN,   setOwnerPAN]   = useState("");

  // Pharmacist fields
  const [pharmName,    setPharmName]    = useState("");
  const [pharmRegNo,   setPharmRegNo]   = useState("");
  const [pharmCouncil, setPharmCouncil] = useState("");

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLogoPreview(url);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Pharmacy Profile</h1>
          <p className="text-sm text-slate-400 mt-0.5">Basic details about your pharmacy and owner</p>
        </div>
        <button
          onClick={handleSave}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-75 active:scale-[0.97]",
            saved
              ? "bg-emerald-500 text-white"
              : "bg-brand-600 hover:bg-brand-700 text-white shadow-card-md"
          )}
        >
          <Save className="w-3.5 h-3.5" />
          {saved ? "Saved!" : "Save Changes"}
        </button>
      </div>

      {/* Logo upload */}
      <Section title="Pharmacy Logo" subtitle="Shown on invoices and receipts">
        <div className="flex items-center gap-6">
          <div
            onClick={() => fileRef.current?.click()}
            className="relative w-20 h-20 rounded-2xl border-2 border-dashed border-slate-200 hover:border-brand-400 bg-slate-50 hover:bg-brand-50 flex items-center justify-center cursor-pointer transition-all group overflow-hidden"
          >
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Building2 className="w-8 h-8 text-slate-300 group-hover:text-brand-400 transition-colors" strokeWidth={1.4} />
            )}
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl">
              <Camera className="w-5 h-5 text-white" />
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              Upload Logo
            </button>
            <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 2MB. Recommended: 200×200px</p>
            {logoPreview && (
              <button
                onClick={() => setLogoPreview(null)}
                className="text-xs text-red-400 hover:text-red-500 mt-1"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* Pharmacy details */}
      <Section title="Pharmacy Details" subtitle="Core registration and contact information">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Pharmacy Name" icon={Building2} placeholder="e.g. Radhika Medical Hall" value={pharmacyName} onChange={setPharmacyName} required />
          </div>
          <Field label="Phone Number"    icon={Phone}     placeholder="+91 98765 43210"  value={phone}       onChange={setPhone}       required />
          <Field label="Email Address"   icon={Mail}      placeholder="pharmacy@email.com" value={email}     onChange={setEmail}       type="email" />
          <Field label="GSTIN"           icon={Hash}      placeholder="22AAAAA0000A1Z5"    value={gstin}     onChange={setGstin}       hint="15-digit GST Identification Number" />
          <Field label="Drug License No" icon={FileText}  placeholder="DL-RJ-123456"       value={drugLicense} onChange={setDrugLicense} hint="As per State Pharmacy Council" />
        </div>
      </Section>

      {/* Address */}
      <Section title="Address" subtitle="Physical location of your pharmacy">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Address Line 1" icon={MapPin} placeholder="Shop No., Street / Road" value={addressLine1} onChange={setAddressLine1} required />
          </div>
          <div className="col-span-2">
            <Field label="Address Line 2" icon={MapPin} placeholder="Landmark, Area (optional)" value={addressLine2} onChange={setAddressLine2} />
          </div>
          <Field label="City"    icon={MapPin} placeholder="Ranchi"     value={city}    onChange={setCity}    required />
          <Field label="State"   icon={MapPin} placeholder="Jharkhand"  value={state}   onChange={setState}   required />
          <Field label="Pincode" icon={MapPin} placeholder="834001"     value={pincode} onChange={setPincode} required />
        </div>
      </Section>

      {/* Owner details */}
      <Section title="Owner Details" subtitle="Primary account holder information">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Owner Full Name" icon={User} placeholder="Full name as per PAN card" value={ownerName} onChange={setOwnerName} required />
          </div>
          <Field label="Owner Phone"  icon={Phone} placeholder="+91 98765 43210"  value={ownerPhone} onChange={setOwnerPhone} />
          <Field label="Owner Email"  icon={Mail}  placeholder="owner@email.com"  value={ownerEmail} onChange={setOwnerEmail} type="email" />
          <div className="col-span-2">
            <Field label="PAN Number" icon={Hash} placeholder="ABCDE1234F" value={ownerPAN} onChange={setOwnerPAN} hint="10-digit Permanent Account Number" />
          </div>
        </div>
      </Section>

      {/* Pharmacist details */}
      <Section title="Pharmacist Details" subtitle="Registered pharmacist on record">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Pharmacist Name"          icon={User}        placeholder="Full name"                      value={pharmName}    onChange={setPharmName}    required />
          </div>
          <Field label="Registration Number"        icon={BadgeCheck}  placeholder="e.g. PH-RJ-12345"               value={pharmRegNo}   onChange={setPharmRegNo}   hint="As issued by State Pharmacy Council" />
          <Field label="State Pharmacy Council"     icon={Building2}   placeholder="e.g. Jharkhand Pharmacy Council" value={pharmCouncil} onChange={setPharmCouncil} />
        </div>
      </Section>

    </div>
    </div>
  );
}
