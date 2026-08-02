import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, EyeOff, ArrowLeft, ArrowRight, AlertCircle, CheckCircle2, ShieldCheck, LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, getErrorMessage } from "@/lib/api-client";

/** Mirrors the @Size(min = 8) on the backend's ResetPasswordRequest. Keep in sync. */
const MIN_LENGTH = 8;

type State = "idle" | "loading" | "done" | "error";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // AuthService builds the link as `${APP_URL}/reset-password?token=<raw token>`.
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [status,   setStatus]   = useState<State>("idle");
  const [errMsg,   setErrMsg]   = useState("");
  const [touched,  setTouched]  = useState(false);

  const tooShort  = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch  = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= MIN_LENGTH && password === confirm;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;

    setStatus("loading");
    setErrMsg("");

    try {
      await api.post("/auth/reset-password", { token, password });
      setStatus("done");
      // The reset bumps the user's token version server-side, invalidating every
      // existing session, so there's nothing to carry over — send them to sign in.
      setTimeout(() => navigate("/login"), 2600);
    } catch (err) {
      // The backend returns "Invalid or expired reset link" for a bad or stale
      // token; surface it verbatim rather than inventing a vaguer message.
      setErrMsg(getErrorMessage(err, "Could not reset your password. Please try again."));
      setStatus("error");
    }
  }

  // A link with no token can't be acted on at all — don't show a form that is
  // guaranteed to fail on submit.
  if (!token) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm text-center"
        >
          <div className="w-16 h-16 rounded-3xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center mx-auto mb-6">
            <LinkIcon className="w-7 h-7 text-amber-500" strokeWidth={1.6} />
          </div>
          <h2 className="text-2xl font-black text-slate-800">This link is incomplete</h2>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            The reset link is missing its token. Some email apps trim long links —
            try copying the whole address, or request a fresh one.
          </p>
          <Link
            to="/forgot-password"
            className="mt-7 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold shadow-card-md transition-all"
          >
            Request a new link <ArrowRight className="w-4 h-4" />
          </Link>
          <div className="flex justify-center mt-6">
            <Link to="/login" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600 font-semibold transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm"
      >
        <div className="flex items-center justify-center gap-2.5 mb-8 lg:hidden">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#0c1f5c,#1a3080)" }}>
            <span className="text-white font-black text-xl leading-none">+</span>
          </div>
          <div className="leading-none">
            <p className="font-extrabold text-slate-800 text-base">Checkup</p>
            <p className="text-slate-400 text-[10px] font-semibold tracking-widest uppercase">Pharmacy</p>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {status !== "done" && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-7">
                <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center mb-4">
                  <Lock className="w-6 h-6 text-brand-600" strokeWidth={1.6} />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Choose a new password</h2>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  Pick something at least {MIN_LENGTH} characters long. You&apos;ll be signed
                  out everywhere else.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-card-md p-7 space-y-5">
                <AnimatePresence>
                  {status === "error" && errMsg && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl"
                    >
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
                      <div>
                        <p className="text-sm text-red-600 font-medium">{errMsg}</p>
                        <Link to="/forgot-password" className="text-[11px] text-red-500 hover:text-red-700 font-bold underline underline-offset-2">
                          Request a new link
                        </Link>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="reset-password" className="text-xs font-semibold text-slate-600">
                    New Password <span className="text-red-400">*</span>
                  </label>
                  <div className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all",
                    touched && tooShort
                      ? "border-red-300 bg-white"
                      : "border-slate-200 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200 bg-white"
                  )}>
                    <Lock className={cn("w-4 h-4 flex-shrink-0", touched && tooShort ? "text-red-400" : "text-slate-400")} strokeWidth={1.8} />
                    <input
                      id="reset-password"
                      name="password"
                      type={showPw ? "text" : "password"}
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={e => { setPassword(e.target.value); if (status === "error") setStatus("idle"); }}
                      onBlur={() => setTouched(true)}
                      autoComplete="new-password"
                      className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
                    </button>
                  </div>
                  <AnimatePresence>
                    {touched && tooShort && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-1 text-[11px] text-red-500 font-medium"
                      >
                        <AlertCircle className="w-3 h-3" /> Must be at least {MIN_LENGTH} characters
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="reset-confirm" className="text-xs font-semibold text-slate-600">
                    Confirm Password <span className="text-red-400">*</span>
                  </label>
                  <div className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all",
                    mismatch
                      ? "border-red-300 bg-white"
                      : "border-slate-200 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200 bg-white"
                  )}>
                    <Lock className={cn("w-4 h-4 flex-shrink-0", mismatch ? "text-red-400" : "text-slate-400")} strokeWidth={1.8} />
                    <input
                      id="reset-confirm"
                      name="confirmPassword"
                      type={showPw ? "text" : "password"}
                      placeholder="Re-enter your new password"
                      value={confirm}
                      onChange={e => { setConfirm(e.target.value); if (status === "error") setStatus("idle"); }}
                      autoComplete="new-password"
                      className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
                    />
                    {canSubmit && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" strokeWidth={2} />}
                  </div>
                  <AnimatePresence>
                    {mismatch && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-1 text-[11px] text-red-500 font-medium"
                      >
                        <AlertCircle className="w-3 h-3" /> Passwords don&apos;t match
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                <motion.button
                  type="submit"
                  disabled={status === "loading" || !canSubmit}
                  whileHover={status !== "loading" && canSubmit ? { scale: 1.01 } : undefined}
                  whileTap={status !== "loading" && canSubmit ? { scale: 0.98 } : undefined}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-200",
                    status === "loading" || !canSubmit
                      ? "bg-brand-400 text-white cursor-not-allowed"
                      : "bg-brand-600 hover:bg-brand-700 text-white shadow-card-md"
                  )}
                >
                  {status === "loading" ? (
                    <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Updating…</>
                  ) : (
                    <>Update Password <ArrowRight className="w-4 h-4" /></>
                  )}
                </motion.button>
              </form>

              <div className="flex justify-center mt-6">
                <Link
                  to="/login"
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600 font-semibold transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
                </Link>
              </div>
            </motion.div>
          )}

          {status === "done" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1,    y: 0  }}
              transition={{ duration: 0.3, type: "spring", stiffness: 280, damping: 26 }}
              className="text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 20 }}
                className="w-20 h-20 rounded-3xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center mx-auto mb-6"
              >
                <ShieldCheck className="w-9 h-9 text-emerald-500" strokeWidth={1.5} />
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <h2 className="text-2xl font-black text-slate-800">Password updated</h2>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  You can now sign in with your new password. Taking you there…
                </p>
              </motion.div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="flex justify-center mt-7">
                <Link
                  to="/login"
                  className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-bold transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Go to Sign In now
                </Link>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
