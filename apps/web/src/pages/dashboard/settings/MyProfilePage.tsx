import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Mail, Save, Loader2, CheckCircle2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { getStoredUser, storeUser } from "@/lib/auth";

function Field({
  label, icon: Icon, value, onChange, readOnly, hint, type = "text",
}: {
  label: string; icon: React.ElementType; value: string;
  onChange?: (v: string) => void; readOnly?: boolean; hint?: string; type?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-600">{label}</label>
      <div className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white transition-all duration-150",
        readOnly ? "bg-slate-50 border-slate-100 cursor-not-allowed" :
        focused ? "border-brand-400 ring-1 ring-brand-200" : "border-slate-200 hover:border-slate-300",
      )}>
        <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", focused ? "text-brand-500" : "text-slate-400")} strokeWidth={1.8} />
        <input
          type={type}
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
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

export default function MyProfilePage() {
  const stored = getStoredUser();

  const [name,    setName]    = useState(stored?.name    ?? "");
  const [email]               = useState(stored?.email   ?? "");
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Refresh from API on mount to pick up any server-side changes
  useEffect(() => {
    api.get("/auth/me")
      .then(({ data }) => {
        const u = data.data;
        setName(u.name ?? "");
      })
      .catch(() => { /* use localStorage values as fallback */ });
  }, []);

  async function handleSave() {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch("/auth/me", { name: name.trim() });
      const updated = data.data;
      // Sync localStorage → fires auth:change → TopNav updates instantly
      const current = getStoredUser();
      if (current) {
        storeUser({ ...current, name: updated.name });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-800">My Profile</h1>
            <p className="text-sm text-slate-400 mt-0.5">Your personal account details</p>
          </div>
          <div className="flex items-center gap-3">
            <AnimatePresence>
              {saved && (
                <motion.span
                  initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600"
                >
                  <CheckCircle2 className="w-4 h-4" /> Saved
                </motion.span>
              )}
            </AnimatePresence>
            {error && <span className="text-[12px] text-red-500">{error}</span>}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300 text-white shadow-sm transition-all active:scale-[0.97]"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </button>
          </div>
        </div>

        {/* Avatar */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 flex items-center justify-center shadow-inner flex-shrink-0 select-none">
            <span className="text-white font-black text-[22px] leading-none">
              {name.split(" ").map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?"}
            </span>
          </div>
          <div>
            <p className="text-[15px] font-bold text-slate-800">{name || "—"}</p>
            <p className="text-[12px] text-slate-400 mt-0.5">{email}</p>
            <span className="mt-1.5 inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 uppercase tracking-wide">
              {stored?.role ?? ""}
            </span>
          </div>
        </div>

        {/* Fields */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <p className="text-sm font-bold text-slate-800">Personal Details</p>
          </div>
          <div className="p-6 space-y-4">
            <Field label="Full Name" icon={User} value={name} onChange={setName} />
            <Field
              label="Email Address" icon={Mail} value={email} readOnly
              hint="Email cannot be changed here. Contact your administrator."
            />
          </div>
        </div>

        {/* Security note */}
        <div className="flex items-start gap-3 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200">
          <Shield className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" strokeWidth={1.8} />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            To change your password, use the <strong className="text-slate-700">Change Password</strong> section in the sidebar.
          </p>
        </div>

      </div>
    </div>
  );
}
