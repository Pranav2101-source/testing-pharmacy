import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Camera, Save, Phone, Mail, MapPin,
  FileText, User, BadgeCheck, Hash, Loader2, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { invalidateInvoicePrintConfigCache } from "@/lib/useInvoicePrintConfig";
import { getStoredUser, storeUser } from "@/lib/auth";

// ─── Reusable field ───────────────────────────────────────────────────────────

function Field({
  label, icon: Icon, placeholder, value, onChange,
  type = "text", hint, required, readOnly,
}: {
  label: string; icon: React.ElementType; placeholder: string;
  value: string; onChange?: (v: string) => void;
  type?: string; hint?: string; required?: boolean; readOnly?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-600">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white transition-all duration-150",
        readOnly ? "bg-slate-50 border-slate-100 cursor-not-allowed" :
        focused ? "border-brand-400 shadow-glow-blue ring-1 ring-brand-200" : "border-slate-200 hover:border-slate-300"
      )}>
        <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", focused ? "text-brand-500" : "text-slate-400")} strokeWidth={1.8} />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          readOnly={readOnly}
          onChange={e => onChange?.(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn(
            "flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none",
            readOnly && "text-slate-400 cursor-not-allowed",
          )}
        />
      </div>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

type PharmacyForm = {
  name: string; phone: string; email: string; gstin: string;
  drugLicense: string; address: string; city: string;
  state: string; pincode: string;
};

const EMPTY_FORM: PharmacyForm = {
  name: "", phone: "", email: "", gstin: "", drugLicense: "",
  address: "", city: "", state: "", pincode: "",
};

export default function PharmacyProfilePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [form,        setForm]        = useState<PharmacyForm>(EMPTY_FORM);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const set = (key: keyof PharmacyForm) => (v: string) =>
    setForm(prev => ({ ...prev, [key]: v }));

  // ── Load ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get("/pharmacy")
      .then(({ data }) => {
        const p = data.data;
        setForm({
          name:        p.name        ?? "",
          phone:       p.phone       ?? "",
          email:       p.email       ?? "",
          gstin:       p.gstin       ?? "",
          drugLicense: p.drugLicense ?? "",
          address:     p.address     ?? "",
          city:        p.city        ?? "",
          state:       p.state       ?? "",
          pincode:     p.pincode     ?? "",
        });
      })
      .catch(() => {/* network issue — user can still type and save */})
      .finally(() => setLoading(false));
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.name.trim()) { setError("Pharmacy name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.put("/pharmacy", form);
      // Bust the print config cache so next bill print reflects new pharmacy data
      invalidateInvoicePrintConfigCache();
      // Sync pharmacyName in localStorage so TopNav and useCurrentUser reflect
      // the new name immediately without requiring a page reload.
      const stored = getStoredUser();
      if (stored && form.name.trim()) {
        storeUser({ ...stored, pharmacyName: form.name.trim() });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-800">Pharmacy Profile</h1>
            <p className="text-sm text-slate-400 mt-0.5">Basic details shown on invoices and in reports</p>
          </div>
          <div className="flex items-center gap-3">
            <AnimatePresence>
              {saved && (
                <motion.span
                  initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600"
                >
                  <CheckCircle2 className="w-4 h-4" />Saved
                </motion.span>
              )}
            </AnimatePresence>
            {error && <span className="text-[12px] text-red-500">{error}</span>}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300 text-white shadow-card-md transition-all active:scale-[0.97]"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </button>
          </div>
        </div>

        {/* Logo upload */}
        <Section title="Pharmacy Logo" subtitle="Shown on invoices and receipts">
          <div className="flex items-center gap-6">
            <div
              onClick={() => fileRef.current?.click()}
              className="relative w-20 h-20 rounded-2xl border-2 border-dashed border-slate-200 hover:border-brand-400 bg-slate-50 hover:bg-brand-50 flex items-center justify-center cursor-pointer transition-all group overflow-hidden"
            >
              {logoPreview ? (
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
              <button onClick={() => fileRef.current?.click()} className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors">
                Upload Logo
              </button>
              <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 2MB. Recommended: 200×200px</p>
              {logoPreview && (
                <button onClick={() => setLogoPreview(null)} className="text-xs text-red-400 hover:text-red-500 mt-1 block">
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
              <Field label="Pharmacy Name" icon={Building2} placeholder="e.g. Radhika Medical Hall" value={form.name} onChange={set("name")} required />
            </div>
            <Field label="Phone Number"    icon={Phone}    placeholder="+91 98765 43210"    value={form.phone}       onChange={set("phone")}  required />
            <Field label="Email Address"   icon={Mail}     placeholder="pharmacy@email.com"  value={form.email}       onChange={set("email")}  type="email" />
            <Field label="GSTIN"           icon={Hash}     placeholder="22AAAAA0000A1Z5"     value={form.gstin}       onChange={set("gstin")}  hint="15-digit GST Identification Number" />
            <Field label="Drug License No" icon={FileText} placeholder="DL-RJ-123456"        value={form.drugLicense} onChange={set("drugLicense")} hint="As per State Pharmacy Council" />
          </div>
        </Section>

        {/* Address */}
        <Section title="Address" subtitle="Physical location of your pharmacy">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Address" icon={MapPin} placeholder="Shop No., Street / Road, Area" value={form.address} onChange={set("address")} required />
            </div>
            <Field label="City"    icon={MapPin} placeholder="Mumbai"     value={form.city}    onChange={set("city")}    required />
            <Field label="State"   icon={MapPin} placeholder="Maharashtra" value={form.state}   onChange={set("state")}   required />
            <Field label="Pincode" icon={MapPin} placeholder="400001"     value={form.pincode} onChange={set("pincode")} required />
          </div>
        </Section>

        {/* Staff details — local only, no backend yet */}
        <Section title="Pharmacist Details" subtitle="Registered pharmacist on record (stored locally)">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Pharmacist Name" icon={User} placeholder="Full name" value="" onChange={() => {}} />
            </div>
            <Field label="Registration Number"  icon={BadgeCheck} placeholder="e.g. PH-MH-12345"             value="" onChange={() => {}} hint="As issued by State Pharmacy Council" />
            <Field label="State Pharmacy Council" icon={Building2} placeholder="e.g. Maharashtra Pharmacy Council" value="" onChange={() => {}} />
          </div>
          <p className="text-[11px] text-slate-400 mt-3">Pharmacist details will be stored in a future release.</p>
        </Section>

      </div>
    </div>
  );
}
