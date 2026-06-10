import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, ArrowLeft, ArrowRight, AlertCircle, Send, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type State = "idle" | "loading" | "sent" | "error";

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState("");
  const [status,  setStatus]  = useState<State>("idle");
  const [errMsg,  setErrMsg]  = useState("");
  const [touched, setTouched] = useState(false);

  const emailValid = /\S+@\S+\.\S+/.test(email);
  const showErr    = touched && !emailValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!emailValid) return;

    setStatus("loading");
    setErrMsg("");

    try {
      await new Promise(r => setTimeout(r, 1200));
      setStatus("sent");
    } catch {
      setErrMsg("Something went wrong. Please try again.");
      setStatus("error");
    }
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
          {status !== "sent" && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-7">
                <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center mb-4">
                  <Mail className="w-6 h-6 text-brand-600" strokeWidth={1.6} />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Forgot password?</h2>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  Enter your registered email and we&apos;ll send you a reset link.
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
                      <p className="text-sm text-red-600 font-medium">{errMsg}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="forgot-email" className="text-xs font-semibold text-slate-600">
                    Email Address <span className="text-red-400">*</span>
                  </label>
                  <div className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all",
                    showErr
                      ? "border-red-300 bg-white"
                      : "border-slate-200 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200 bg-white"
                  )}>
                    <Mail className={cn("w-4 h-4 flex-shrink-0", showErr ? "text-red-400" : "text-slate-400")} strokeWidth={1.8} />
                    <input
                      id="forgot-email"
                      name="email"
                      type="email"
                      placeholder="you@pharmacy.com"
                      value={email}
                      onChange={e => { setEmail(e.target.value); if (status === "error") setStatus("idle"); }}
                      onBlur={() => setTouched(true)}
                      autoComplete="email"
                      className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
                    />
                    {emailValid && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" strokeWidth={2} />}
                  </div>
                  <AnimatePresence>
                    {showErr && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-1 text-[11px] text-red-500 font-medium"
                      >
                        <AlertCircle className="w-3 h-3" /> Enter a valid email address
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                <motion.button
                  type="submit"
                  disabled={status === "loading"}
                  whileHover={status !== "loading" ? { scale: 1.01 } : undefined}
                  whileTap={status !== "loading" ? { scale: 0.98 } : undefined}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-200",
                    status === "loading"
                      ? "bg-brand-400 text-white cursor-not-allowed"
                      : "bg-brand-600 hover:bg-brand-700 text-white shadow-card-md"
                  )}
                >
                  {status === "loading" ? (
                    <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Sending…</>
                  ) : (
                    <>Send Reset Link <ArrowRight className="w-4 h-4" /></>
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

          {status === "sent" && (
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
                <Send className="w-9 h-9 text-emerald-500" strokeWidth={1.5} />
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <h2 className="text-2xl font-black text-slate-800">Check your email</h2>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">We&apos;ve sent a password reset link to</p>
                <p className="text-sm font-bold text-brand-600 mt-1">{email}</p>
              </motion.div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
                className="mt-7 bg-white rounded-2xl border border-slate-200 shadow-card p-5 text-left space-y-3">
                {["Check your inbox (and spam folder)", "Click the link in the email", "Set a new password"].map((step, i) => (
                  <div key={step} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-600 text-[11px] font-black flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <span className="text-sm text-slate-600">{step}</span>
                  </div>
                ))}
              </motion.div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="mt-6 space-y-3">
                <button
                  onClick={() => { setStatus("idle"); setTouched(false); }}
                  className="text-sm text-slate-500 hover:text-brand-600 font-semibold transition-colors"
                >
                  Didn&apos;t receive it? Send again
                </button>
                <div className="flex justify-center">
                  <Link
                    to="/login"
                    className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-bold transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
                  </Link>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
