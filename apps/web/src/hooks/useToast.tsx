import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ToastVariant = "success" | "error" | "warning" | "info";

type Toast = {
  id:      string;
  message: string;
  variant: ToastVariant;
};

type ToastCtx = {
  success: (message: string) => void;
  error:   (message: string) => void;
  warning: (message: string) => void;
  info:    (message: string) => void;
};

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastCtx | null>(null);

// ─── Config ───────────────────────────────────────────────────────────────────

const VARIANT_CFG: Record<ToastVariant, {
  icon:    React.ElementType;
  iconCls: string;
  bar:     string;
  bg:      string;
  border:  string;
}> = {
  success: {
    icon:    CheckCircle2,
    iconCls: "text-emerald-500",
    bar:     "bg-emerald-500",
    bg:      "bg-white",
    border:  "border-slate-200",
  },
  error: {
    icon:    XCircle,
    iconCls: "text-red-500",
    bar:     "bg-red-500",
    bg:      "bg-white",
    border:  "border-slate-200",
  },
  warning: {
    icon:    AlertTriangle,
    iconCls: "text-amber-500",
    bar:     "bg-amber-400",
    bg:      "bg-white",
    border:  "border-slate-200",
  },
  info: {
    icon:    Info,
    iconCls: "text-blue-500",
    bar:     "bg-blue-500",
    bg:      "bg-white",
    border:  "border-slate-200",
  },
};

const AUTO_DISMISS_MS = 3800;

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = `${Date.now()}-${Math.random()}`;
    // keep at most 3 existing + 1 new = 4 visible at a time
    setToasts((prev) => [...prev.slice(-3), { id, message, variant }]);
    const t = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    timers.current.set(id, t);
  }, [dismiss]);

  const ctx = useMemo<ToastCtx>(() => ({
    success: (m) => add(m, "success"),
    error:   (m) => add(m, "error"),
    warning: (m) => add(m, "warning"),
    info:    (m) => add(m, "info"),
  }), [add]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ─── Toaster UI ───────────────────────────────────────────────────────────────

function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const cfg  = VARIANT_CFG[toast.variant];
          const Icon = cfg.icon;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{   opacity: 0, y: 8,   scale: 0.97, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={cn(
                "pointer-events-auto flex items-center gap-3 pl-1 pr-4 py-3 rounded-xl border shadow-lg shadow-black/8 min-w-[260px] max-w-[360px] overflow-hidden relative",
                cfg.bg, cfg.border,
              )}
            >
              {/* Left colour bar */}
              <div className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l-xl", cfg.bar)} />

              <Icon className={cn("w-4 h-4 flex-shrink-0 ml-3", cfg.iconCls)} />

              <p className="text-[13px] font-medium text-slate-800 flex-1 leading-snug">{toast.message}</p>

              <button
                onClick={() => onDismiss(toast.id)}
                className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors flex-shrink-0"
              >
                <X className="w-3 h-3 text-slate-400" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
