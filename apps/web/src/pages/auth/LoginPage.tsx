import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, AlertCircle, ArrowRight, CheckCircle2, Shield, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { storeUser, type StoredUser } from "@/lib/auth";
import { api } from "@/lib/api-client";

const schema = z.object({
  email:    z.string().email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const [showPw,  setShowPw]  = useState(false);
  const [apiErr,  setApiErr]  = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: Form) {
    setApiErr(null);
    try {
      // Use the shared axios instance so interceptors (401 redirect, error
      // normalisation) apply here too — replacing the previous raw fetch call.
      const res = await api.post<{ data: { tokens: { accessToken: string }; user: StoredUser } }>(
        "/auth/login",
        data,
      );
      const { tokens, user } = res.data.data;
      localStorage.setItem("token", tokens.accessToken);
      document.cookie = `auth-token=${tokens.accessToken}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
      storeUser(user);
      setSuccess(true);
      setTimeout(() => navigate("/dashboard"), 600);
    } catch (err) {
      // axios normalises the backend error message onto err.message via the
      // response interceptor, so we don't need to dig into err.response.data.
      setApiErr(
        (err as { message?: string }).message ?? "Network error — please try again.",
      );
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
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0  }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[400px]"
        >
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
              <span className="text-white font-black text-3xl leading-none select-none">+</span>
            </div>
          </div>

          <div className="text-center mb-7">
            <h1 className="text-2xl font-black text-slate-900">Welcome back</h1>
            <p className="text-slate-500 text-sm mt-1.5">Sign in to continue to your pharmacy account</p>
          </div>

          <AnimatePresence>
            {apiErr && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl mb-5"
              >
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-sm text-red-600 font-medium">{apiErr}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-4 mb-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-sm font-semibold text-slate-700">Email address</label>
              <div className={cn(
                "flex items-center gap-2.5 px-3.5 py-3 rounded-xl border bg-white transition-all",
                errors.email
                  ? "border-red-300 focus-within:border-red-400"
                  : "border-slate-200 focus-within:border-blue-500 focus-within:ring-3 focus-within:ring-blue-100"
              )}>
                <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
                <input
                  {...register("email")}
                  id="login-email"
                  type="email"
                  placeholder="you@pharmacy.com"
                  autoComplete="email"
                  className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
                />
              </div>
              {errors.email && (
                <p className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.email.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-sm font-semibold text-slate-700">Password</label>
                <Link to="/forgot-password" className="text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className={cn(
                "flex items-center gap-2.5 px-3.5 py-3 rounded-xl border bg-white transition-all",
                errors.password
                  ? "border-red-300 focus-within:border-red-400"
                  : "border-slate-200 focus-within:border-blue-500 focus-within:ring-3 focus-within:ring-blue-100"
              )}>
                <Lock className="w-4 h-4 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
                <input
                  {...register("password")}
                  id="login-password"
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="flex-1 text-sm text-slate-800 placeholder-slate-400 bg-transparent outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="w-4 h-4" strokeWidth={1.8} /> : <Eye className="w-4 h-4" strokeWidth={1.8} />}
                </button>
              </div>
              {errors.password && (
                <p className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.password.message}
                </p>
              )}
            </div>
          </div>

          <motion.button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting || success}
            whileHover={!isSubmitting && !success ? { scale: 1.01 } : undefined}
            whileTap={!isSubmitting && !success ? { scale: 0.98 } : undefined}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold transition-all duration-200 mt-5",
              success
                ? "bg-emerald-500 text-white"
                : isSubmitting
                ? "bg-blue-400 text-white cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200"
            )}
          >
            {success ? (
              <><CheckCircle2 className="w-4 h-4" /> Signed in!</>
            ) : isSubmitting ? (
              <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Signing in…</>
            ) : (
              <>Sign In <ArrowRight className="w-4 h-4" /></>
            )}
          </motion.button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-xs text-slate-400 font-medium">OR</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          <Link
            to="/register"
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl border-2 border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold transition-all"
          >
            <UserPlus className="w-4 h-4 text-slate-500" strokeWidth={1.8} />
            Create a new pharmacy account
          </Link>

          <p className="text-center text-sm text-slate-400 mt-6">
            Need help?{" "}
            <a href="#" className="text-blue-600 hover:text-blue-700 font-semibold transition-colors">
              Contact Support
            </a>
          </p>

          <div className="flex items-start gap-3 mt-6 p-4 bg-slate-50 rounded-xl border border-slate-100">
            <Shield className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
            <div>
              <p className="text-sm font-bold text-slate-700">Your data is safe with us</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                We follow industry best practices to keep your business information secure.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
