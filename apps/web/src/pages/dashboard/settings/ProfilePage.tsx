import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Camera, Save, Phone, Mail, MapPin,
  FileText, Hash, Loader2, CheckCircle2, User,
  Shield, AlertCircle, Pencil, BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { getStoredUser, storeUser } from "@/lib/auth";
import { invalidateInvoicePrintConfigCache } from "@/lib/useInvoicePrintConfig";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Field({
  label, icon: Icon, placeholder, value, onChange,
  type = "text", hint, readOnly, accent = "blue",
}: {
  label: string; icon: React.ElementType; placeholder: string;
  value: string; onChange?: (v: string) => void;
  type?: string; hint?: string; readOnly?: boolean;
  accent?: "blue" | "violet";
}) {
  const [focused, setFocused] = useState(false);
  const ringCls = accent === "violet"
    ? "border-violet-400 ring-1 ring-violet-200 shadow-sm"
    : "border-blue-400 ring-1 ring-blue-200 shadow-sm";
  const iconCls = accent === "violet" ? "text-violet-500" : "text-blue-500";

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
      <div className={cn(
        "flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border bg-white transition-all duration-150",
        readOnly ? "bg-slate-50 border-slate-100 cursor-not-allowed"
                 : focused ? ringCls : "border-slate-200 hover:border-slate-300",
      )}>
        <Icon className={cn("w-3.5 h-3.5 flex-shrink-0 transition-colors", focused && !readOnly ? iconCls : "text-slate-400")} strokeWidth={1.8} />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn(
            "flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none",
            readOnly && "text-slate-400 cursor-not-allowed",
          )}
        />
      </div>
      {hint && <p className="text-[10px] text-slate-400 leading-relaxed">{hint}</p>}
    </div>
  );
}

function SaveBtn({
  onClick, saving, saved, error, label = "Save Changes",
  accent = "blue",
}: {
  onClick: () => void; saving: boolean; saved: boolean;
  error?: string | null; label?: string; accent?: "blue" | "violet";
}) {
  const bg = accent === "violet"
    ? "bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300"
    : "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300";
  return (
    <div className="flex items-center gap-3">
      <AnimatePresence mode="wait">
        {saved && (
          <motion.span key="saved"
            initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
          </motion.span>
        )}
        {error && (
          <motion.span key="err"
            initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-[12px] font-medium text-red-500">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </motion.span>
        )}
      </AnimatePresence>
      <button onClick={onClick} disabled={saving}
        className={cn("flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white shadow-sm transition-all active:scale-[0.97]", bg)}>
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {label}
      </button>
    </div>
  );
}

function SectionCard({
  title, subtitle, accent = "blue", children,
}: {
  title: string; subtitle?: string; accent?: "blue" | "violet"; children: React.ReactNode;
}) {
  const bar = accent === "violet" ? "bg-violet-500" : "bg-blue-500";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
    >
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
        <div className={cn("w-1 h-5 rounded-full flex-shrink-0", bar)} />
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </motion.div>
  );
}

// ─── Role colour map ──────────────────────────────────────────────────────────

const ROLE_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  OWNER:   { label: "Owner",   cls: "bg-violet-50 text-violet-700 border-violet-200",  dot: "bg-violet-500"  },
  MANAGER: { label: "Manager", cls: "bg-blue-50   text-blue-700   border-blue-200",    dot: "bg-blue-500"    },
  CASHIER: { label: "Cashier", cls: "bg-slate-50  text-slate-600  border-slate-200",   dot: "bg-slate-400"   },
  STAFF:   { label: "Staff",   cls: "bg-slate-50  text-slate-600  border-slate-200",   dot: "bg-slate-400"   },
};

// ─── Avatar initials helper ───────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
}

// ─── Gradient for avatar based on name ───────────────────────────────────────

const AVATAR_GRADIENTS = [
  "from-violet-500 to-indigo-600",
  "from-blue-500 to-cyan-500",
  "from-emerald-500 to-teal-600",
  "from-orange-500 to-rose-500",
  "from-pink-500 to-fuchsia-600",
];
function avatarGradient(name: string) {
  const code = (name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0);
  return AVATAR_GRADIENTS[code % AVATAR_GRADIENTS.length];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type PharmacyData = {
  name: string; phone: string; email: string; gstin: string;
  drugLicense: string; address: string; city: string; state: string;
  pincode: string; logoUrl: string | null; logoSignedUrl: string | null;
};

const EMPTY: PharmacyData = {
  name: "", phone: "", email: "", gstin: "", drugLicense: "",
  address: "", city: "", state: "", pincode: "", logoUrl: null, logoSignedUrl: null,
};

export default function ProfilePage() {
  const stored      = getStoredUser();
  const logoFileRef = useRef<HTMLInputElement>(null);

  // ── User state ────────────────────────────────────────────────────────────
  const [userName,    setUserName]    = useState(stored?.name    ?? "");
  const [userEmail]                   = useState(stored?.email   ?? "");
  const [userRole]                    = useState(stored?.role    ?? "");
  const [userSaving,  setUserSaving]  = useState(false);
  const [userSaved,   setUserSaved]   = useState(false);
  const [userError,   setUserError]   = useState<string | null>(null);

  // ── Pharmacy state ────────────────────────────────────────────────────────
  const [pharmacy,        setPharmacy]        = useState<PharmacyData>(EMPTY);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [logoPreview,     setLogoPreview]     = useState<string | null>(null);
  const [pharmaSaving,    setPharmaSaving]    = useState(false);
  const [pharmaSaved,     setPharmaSaved]     = useState(false);
  const [pharmaError,     setPharmaError]     = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.get("/auth/me").catch(() => null),
      api.get("/pharmacy").catch(() => null),
    ]).then(([userRes, pharmRes]) => {
      if (userRes) {
        const u = userRes.data?.data;
        if (u?.name) setUserName(u.name);
      }
      if (pharmRes) {
        const p = pharmRes.data?.data;
        if (p) {
          setPharmacy({
            name:         p.name         ?? "",
            phone:        p.phone        ?? "",
            email:        p.email        ?? "",
            gstin:        p.gstin        ?? "",
            drugLicense:  p.drugLicense  ?? "",
            address:      p.address      ?? "",
            city:         p.city         ?? "",
            state:        p.state        ?? "",
            pincode:      p.pincode      ?? "",
            logoUrl:      p.logoUrl      ?? null,
            logoSignedUrl: p.logoSignedUrl ?? null,
          });
        }
      }
    }).finally(() => setLoading(false));
  }, []);

  // ── Save user profile ─────────────────────────────────────────────────────
  async function handleSaveUser() {
    if (!userName.trim()) { setUserError("Name is required."); return; }
    setUserSaving(true); setUserError(null);
    try {
      const { data } = await api.patch("/auth/me", { name: userName.trim() });
      const current = getStoredUser();
      if (current) storeUser({ ...current, name: data.data.name });
      setUserSaved(true);
      setTimeout(() => setUserSaved(false), 2500);
    } catch {
      setUserError("Failed to save. Please try again.");
    } finally {
      setUserSaving(false);
    }
  }

  // ── Save pharmacy profile (uploads logo first if pending) ─────────────────
  async function handleSavePharmacy() {
    if (!pharmacy.name.trim()) { setPharmaError("Pharmacy name is required."); return; }
    setPharmaSaving(true); setPharmaError(null);
    try {
      let newLogoUrl = pharmacy.logoUrl;

      if (pendingLogoFile) {
        const fd = new FormData();
        fd.append("file", pendingLogoFile);
        const { data: upData } = await api.post<{ data: { fileUrl: string; signedUrl: string | null } }>(
          "/uploads/pharmacy-logo", fd,
        );
        newLogoUrl = upData.data.fileUrl;
        setPharmacy((p) => ({ ...p, logoUrl: newLogoUrl, logoSignedUrl: upData.data.signedUrl }));
        setPendingLogoFile(null);
      }

      await api.put("/pharmacy", {
        name:        pharmacy.name,
        phone:       pharmacy.phone,
        email:       pharmacy.email,
        gstin:       pharmacy.gstin,
        drugLicense: pharmacy.drugLicense,
        address:     pharmacy.address,
        city:        pharmacy.city,
        state:       pharmacy.state,
        pincode:     pharmacy.pincode,
        logoUrl:     newLogoUrl,
      });

      invalidateInvoicePrintConfigCache();

      const current = getStoredUser();
      if (current && pharmacy.name.trim()) {
        storeUser({ ...current, pharmacyName: pharmacy.name.trim() });
      }

      setPharmaSaved(true);
      setTimeout(() => setPharmaSaved(false), 2500);
    } catch {
      setPharmaError("Failed to save. Please try again.");
    } finally {
      setPharmaSaving(false);
    }
  }

  // ── Logo file picker ──────────────────────────────────────────────────────
  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setPendingLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function removeLogo() {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setPendingLogoFile(null);
    setLogoPreview(null);
    setPharmacy((p) => ({ ...p, logoUrl: null, logoSignedUrl: null }));
  }

  const setP = (k: keyof PharmacyData) => (v: string) =>
    setPharmacy((prev) => ({ ...prev, [k]: v }));

  const displayLogo  = logoPreview ?? pharmacy.logoSignedUrl;
  const roleCfg      = ROLE_CFG[userRole] ?? ROLE_CFG["STAFF"] ?? { label: "Staff", cls: "bg-slate-50 text-slate-600 border-slate-200", dot: "bg-slate-400" };
  const grad         = avatarGradient(userName);

  // ── Skeleton ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50">
        <div className="h-44 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-500 animate-pulse" />
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-white rounded-2xl border border-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">

      {/* ── Hero banner ───────────────────────────────────────────────────── */}
      <div className="relative bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-500 overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-white/5 rounded-full pointer-events-none" />
        <div className="absolute -bottom-10 left-40 w-40 h-40 bg-white/5 rounded-full pointer-events-none" />
        <div className="absolute top-4 right-1/3 w-20 h-20 bg-white/5 rounded-full pointer-events-none" />

        <div className="relative max-w-4xl mx-auto px-6 py-8 flex items-center gap-6">
          {/* User avatar */}
          <div className={cn(
            "w-20 h-20 rounded-2xl bg-gradient-to-br flex items-center justify-center flex-shrink-0",
            "shadow-lg border-2 border-white/30 select-none", grad,
          )}>
            <span className="text-white font-black text-2xl leading-none">{initials(userName)}</span>
          </div>

          {/* User info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black text-white truncate">{userName || "—"}</h1>
            <p className="text-white/70 text-sm mt-0.5 truncate">{userEmail}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={cn(
                "inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border uppercase tracking-wider",
                roleCfg.cls,
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", roleCfg.dot)} />
                {roleCfg.label}
              </span>
              {pharmacy.name && (
                <>
                  <span className="text-white/40 text-xs">·</span>
                  <span className="text-white/70 text-xs font-medium truncate">{pharmacy.name}</span>
                </>
              )}
            </div>
          </div>

          {/* Pharmacy logo in hero — clickable to change */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <div
              onClick={() => logoFileRef.current?.click()}
              title="Click to change pharmacy logo"
              className={cn(
                "w-16 h-16 rounded-xl border-2 border-white/30 flex items-center justify-center",
                "cursor-pointer hover:border-white/60 transition-all group overflow-hidden relative",
                displayLogo ? "bg-white" : "bg-white/15 backdrop-blur-sm",
              )}
            >
              {displayLogo ? (
                <img src={displayLogo} alt="Logo" className="w-full h-full object-contain p-1" />
              ) : (
                <Building2 className="w-7 h-7 text-white/60 group-hover:text-white/90 transition-colors" strokeWidth={1.5} />
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="w-4 h-4 text-white" />
              </div>
            </div>
            <p className="text-white/50 text-[9px] font-medium uppercase tracking-wider">
              {displayLogo ? "Change logo" : "Add logo"}
            </p>
          </div>

          <input ref={logoFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleLogoChange} />
        </div>

        {/* Bottom wave */}
        <div className="h-4 bg-slate-50" style={{
          clipPath: "ellipse(55% 100% at 50% 100%)",
          marginTop: "-1px",
        }} />
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 pb-8 space-y-5" style={{ marginTop: "-1rem" }}>

        {/* ── Personal Account ─────────────────────────────────────────── */}
        <SectionCard
          title="Personal Account"
          subtitle="Your login identity — name visible to colleagues"
          accent="violet"
        >
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Full Name" icon={User} placeholder="Your full name"
                value={userName} onChange={setUserName} accent="violet"
              />
              <Field
                label="Email Address" icon={Mail} placeholder=""
                value={userEmail} readOnly
                hint="Email cannot be changed here. Contact your administrator."
                accent="violet"
              />
            </div>

            {/* Role badge + security note */}
            <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
              <div className="flex items-center gap-2">
                <BadgeCheck className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.8} />
                <span className="text-[11px] text-slate-500">Your role:</span>
                <span className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border",
                  roleCfg.cls,
                )}>
                  {roleCfg.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <Shield className="w-3 h-3" strokeWidth={1.8} />
                Change password via the sidebar
              </div>
            </div>

            <div className="flex justify-end pt-1 border-t border-slate-100">
              <SaveBtn
                onClick={handleSaveUser} saving={userSaving} saved={userSaved}
                error={userError} label="Save Account" accent="violet"
              />
            </div>
          </div>
        </SectionCard>

        {/* ── Pharmacy Identity ─────────────────────────────────────────── */}
        <SectionCard
          title="Pharmacy Identity"
          subtitle="Displayed on invoices, receipts and printed reports"
          accent="blue"
        >
          <div className="space-y-5">
            {/* Logo management row */}
            <div className="flex items-center gap-5 p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div
                onClick={() => logoFileRef.current?.click()}
                className={cn(
                  "w-16 h-16 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer",
                  "hover:border-blue-400 hover:bg-blue-50 transition-all group overflow-hidden relative flex-shrink-0",
                  displayLogo ? "border-blue-200 bg-white" : "border-slate-200 bg-white",
                )}
              >
                {displayLogo ? (
                  <img src={displayLogo} alt="Logo" className="w-full h-full object-contain p-1" />
                ) : (
                  <Building2 className="w-6 h-6 text-slate-300 group-hover:text-blue-400 transition-colors" strokeWidth={1.5} />
                )}
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                  <Pencil className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  {pendingLogoFile ? pendingLogoFile.name : (pharmacy.logoUrl ? "Logo uploaded" : "No logo yet")}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">PNG, JPG, WebP · max 2 MB · 200×200 px recommended</p>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => logoFileRef.current?.click()}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    {displayLogo ? "Replace" : "Upload logo"}
                  </button>
                  {displayLogo && (
                    <button onClick={removeLogo} className="text-[11px] text-red-400 hover:text-red-500 transition-colors">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Pharmacy fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Field
                  label="Pharmacy Name" icon={Building2} placeholder="e.g. Gita Medical Hall"
                  value={pharmacy.name} onChange={setP("name")} accent="blue"
                />
              </div>
              <Field label="Phone Number"    icon={Phone}    placeholder="+91 98765 43210"  value={pharmacy.phone}       onChange={setP("phone")}       accent="blue" />
              <Field label="Email Address"   icon={Mail}     placeholder="pharmacy@email.com" value={pharmacy.email}       onChange={setP("email")}       type="email" accent="blue" />
              <Field label="GSTIN"           icon={Hash}     placeholder="22AAAAA0000A1Z5"  value={pharmacy.gstin}       onChange={setP("gstin")}       hint="15-digit GST Identification Number" accent="blue" />
              <Field label="Drug License No" icon={FileText} placeholder="DL-MH-123456"     value={pharmacy.drugLicense} onChange={setP("drugLicense")} hint="As per State Pharmacy Council" accent="blue" />
            </div>

            {/* Address sub-section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.8} />
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Address</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Field label="Street Address" icon={MapPin} placeholder="Shop No., Street / Road, Area" value={pharmacy.address} onChange={setP("address")} accent="blue" />
                </div>
                <Field label="City"    icon={MapPin} placeholder="Mumbai"      value={pharmacy.city}    onChange={setP("city")}    accent="blue" />
                <Field label="State"   icon={MapPin} placeholder="Maharashtra" value={pharmacy.state}   onChange={setP("state")}   accent="blue" />
                <Field label="Pincode" icon={MapPin} placeholder="400001"      value={pharmacy.pincode} onChange={setP("pincode")} accent="blue" />
              </div>
            </div>

            <div className="flex justify-end pt-1 border-t border-slate-100">
              <SaveBtn
                onClick={handleSavePharmacy} saving={pharmaSaving} saved={pharmaSaved}
                error={pharmaError} label="Save Pharmacy" accent="blue"
              />
            </div>
          </div>
        </SectionCard>

      </div>
    </div>
  );
}
