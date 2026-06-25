

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Lock, CheckCircle2, X, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Password strength ────────────────────────────────────────
interface StrengthResult {
  score:  number; // 0–4
  label:  string;
  color:  string;
  checks: { label: string; ok: boolean }[];
}

function getStrength(password: string): StrengthResult {
  const checks = [
    { label: "At least 8 characters",               ok: password.length >= 8               },
    { label: "Contains uppercase letter",            ok: /[A-Z]/.test(password)             },
    { label: "Contains lowercase letter",            ok: /[a-z]/.test(password)             },
    { label: "Contains a number",                    ok: /[0-9]/.test(password)             },
    { label: "Contains special character (!@#$...)", ok: /[^A-Za-z0-9]/.test(password)     },
  ];
  const score = checks.filter((c) => c.ok).length;

  const map: Record<number, { label: string; color: string }> = {
    0: { label: "Too weak",  color: "bg-red-400"    },
    1: { label: "Weak",      color: "bg-red-400"    },
    2: { label: "Fair",      color: "bg-amber-400"  },
    3: { label: "Good",      color: "bg-yellow-400" },
    4: { label: "Strong",    color: "bg-emerald-400"},
    5: { label: "Very strong",color:"bg-emerald-500"},
  };

  const label = map[score]?.label ?? "Too weak";
  const color = map[score]?.color ?? "bg-red-400";
  return { score, label, color, checks };
}

// ─── Password field ───────────────────────────────────────────
function PasswordField({
  label,
  placeholder,
  value,
  onChange,
  hint,
}: {
  label:       string;
  placeholder: string;
  value:       string;
  onChange:    (v: string) => void;
  hint?:       string;
}) {
  const [show,    setShow]    = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-600">{label}</label>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white transition-all duration-150",
          focused
            ? "border-brand-400 shadow-glow-blue ring-1 ring-brand-200"
            : "border-slate-200 hover:border-slate-300"
        )}
      >
        <Lock
          className={cn("w-3.5 h-3.5 flex-shrink-0", focused ? "text-brand-500" : "text-slate-400")}
          strokeWidth={1.8}
        />
        <input
          type={show ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show
            ? <EyeOff className="w-3.5 h-3.5" strokeWidth={1.8} />
            : <Eye    className="w-3.5 h-3.5" strokeWidth={1.8} />
          }
        </button>
      </div>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function ChangePasswordPage() {
  const [current,  setCurrent]  = useState("");
  const [next,     setNext]     = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [state,    setState_]   = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errMsg,   _setErrMsg]  = useState("");

  const strength    = getStrength(next);
  const matchOk     = next.length > 0 && next === confirm;
  const matchFail   = confirm.length > 0 && next !== confirm;
  const canSubmit   = current.length > 0 && strength.score >= 3 && matchOk;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setState_("loading");
    // TODO: wire up to API PATCH /auth/change-password
    setTimeout(() => {
      setState_("success");
      setCurrent(""); setNext(""); setConfirm("");
      setTimeout(() => setState_("idle"), 3500);
    }, 1200);
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-lg mx-auto px-6 py-8 space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-lg font-bold text-slate-800">Change Password</h1>
        <p className="text-sm text-slate-400 mt-0.5">Choose a strong password to keep your account secure</p>
      </div>

      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden"
      >
        {/* Form body */}
        <div className="p-6 space-y-5">

          {/* Current password */}
          <PasswordField
            label="Current Password"
            placeholder="Enter your current password"
            value={current}
            onChange={setCurrent}
            hint="Required to verify your identity"
          />

          <div className="border-t border-slate-100" />

          {/* New password */}
          <PasswordField
            label="New Password"
            placeholder="Enter a new password"
            value={next}
            onChange={setNext}
          />

          {/* Strength bar */}
          <AnimatePresence>
            {next.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3 overflow-hidden"
              >
                {/* Bar */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex-1 h-1.5 rounded-full overflow-hidden bg-slate-100">
                        <motion.div
                          animate={{ width: i < strength.score ? "100%" : "0%" }}
                          transition={{ duration: 0.25, delay: i * 0.04 }}
                          className={cn("h-full rounded-full", strength.color)}
                        />
                      </div>
                    ))}
                  </div>
                  <span className={cn(
                    "text-[10px] font-bold min-w-[60px] text-right",
                    strength.score >= 4 ? "text-emerald-600" :
                    strength.score >= 3 ? "text-yellow-600"  :
                    strength.score >= 2 ? "text-amber-600"   : "text-red-500"
                  )}>
                    {strength.label}
                  </span>
                </div>

                {/* Checklist */}
                <div className="grid grid-cols-2 gap-1.5">
                  {strength.checks.map(({ label, ok }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      {ok
                        ? <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" strokeWidth={2.2} />
                        : <X           className="w-3 h-3 text-slate-300 flex-shrink-0"    strokeWidth={2}   />
                      }
                      <span className={cn("text-[10px]", ok ? "text-slate-600" : "text-slate-400")}>{label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Confirm password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600">Confirm New Password</label>
            <div className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white transition-all duration-150",
              matchFail   ? "border-red-400 ring-1 ring-red-200"     :
              matchOk     ? "border-emerald-400 ring-1 ring-emerald-200" :
                            "border-slate-200 hover:border-slate-300"
            )}>
              <Lock className={cn("w-3.5 h-3.5 flex-shrink-0",
                matchFail ? "text-red-400" : matchOk ? "text-emerald-500" : "text-slate-400"
              )} strokeWidth={1.8} />
              <input
                type="password"
                placeholder="Re-enter new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
              />
              <AnimatePresence mode="wait">
                {matchOk && (
                  <motion.span key="ok" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
                  </motion.span>
                )}
                {matchFail && (
                  <motion.span key="fail" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                    <X className="w-3.5 h-3.5 text-red-400" strokeWidth={2} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {matchFail && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-[10px] text-red-500 font-medium"
                >
                  Passwords do not match
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-4">
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.8} />
            You'll be signed out of all other devices
          </p>
          <button
            type="submit"
            disabled={!canSubmit || state === "loading"}
            className={cn(
              "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-75 min-w-[150px] justify-center",
              state === "success"
                ? "bg-emerald-500 text-white"
                : canSubmit
                ? "bg-brand-600 hover:bg-brand-700 active:scale-[0.97] text-white shadow-card-md"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            )}
          >
            {state === "loading" ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Updating…
              </span>
            ) : state === "success" ? (
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Password Updated!
              </span>
            ) : (
              "Update Password"
            )}
          </button>
        </div>

        {/* Error message */}
        <AnimatePresence>
          {errMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="px-6 pb-4"
            >
              <p className="text-xs text-red-500 font-medium">{errMsg}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.form>
    </div>
    </div>
  );
}
