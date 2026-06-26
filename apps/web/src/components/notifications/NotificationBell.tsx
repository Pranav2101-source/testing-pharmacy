import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Bell, X, Clock, Package, AlertCircle, BarChart2,
  Wallet, FileText, AlertOctagon, ShoppingCart,
  User, Lock, FileQuestion, CheckCheck, Loader2,
  CalendarDays, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifStatus = "PENDING" | "SENT" | "FAILED";
type NotifType   = "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";

interface NotifLog {
  id:        string;
  type:      NotifType;
  recipient: string;
  subject:   string | null;
  message:   string;
  status:    NotifStatus;
  isRead:    boolean;
  error:     string | null;
  sentAt:    string | null;
  createdAt: string;
}

// ─── Deep-link mapping — IN_APP only ──────────────────────────────────────────
// Maps subject keywords → the page the notification is about.
// Returns null for EMAIL/SMS/WHATSAPP records (those are outgoing log entries,
// not action items for the logged-in user).

function getNotifLink(subject: string | null, type: NotifType): string | null {
  if (type !== "IN_APP") return null;
  const s = (subject ?? "").toLowerCase();
  if (s.includes("expir"))                                          return "/dashboard/inventory?tab=alerts";
  if (s.includes("stock") || s.includes("restock"))                return "/dashboard/inventory?tab=alerts";
  if (s.includes("recall"))                                         return "/dashboard/inventory";
  if (s.includes("eod") || s.includes("summary") || s.includes("sales")) return "/dashboard/reports";
  if (s.includes("overdue") || s.includes("grn"))                  return "/dashboard/purchases";
  if (s.includes("quotation"))                                      return "/dashboard/quotations";
  if (s.includes("calendar") || s.startsWith("📅"))                return "/dashboard/calendar";
  if (s.includes("pending credit") || s.includes("credit"))        return "/dashboard/billing";
  return null;
}

// ─── Icon mapping ─────────────────────────────────────────────────────────────

function getNotifMeta(subject: string | null): {
  Icon:    LucideIcon;
  color:   string;
  bg:      string;
} {
  const s = (subject ?? "").toLowerCase();

  if (s.includes("calendar") || s.startsWith("📅"))
    return { Icon: CalendarDays,  color: "text-blue-600",   bg: "bg-blue-50"    };
  if (s.includes("recall") || s.includes("urgent"))
    return { Icon: AlertOctagon, color: "text-red-600",    bg: "bg-red-50"     };
  if (s.includes("expir") || s.includes("expired"))
    return { Icon: Clock,        color: "text-orange-600", bg: "bg-orange-50"  };
  if (s.includes("overdue") || s.includes("payment"))
    return { Icon: AlertCircle,  color: "text-red-500",    bg: "bg-red-50"     };
  if (s.includes("stock") || s.includes("restock"))
    return { Icon: Package,      color: "text-amber-600",  bg: "bg-amber-50"   };
  if (s.includes("eod") || s.includes("summary") || s.includes("sales"))
    return { Icon: BarChart2,    color: "text-blue-600",   bg: "bg-blue-50"    };
  if (s.includes("credit") || s.includes("settled") || s.includes("warning"))
    return { Icon: Wallet,       color: "text-purple-600", bg: "bg-purple-50"  };
  if (s.includes("invoice") || s.includes("bill"))
    return { Icon: FileText,     color: "text-blue-600",   bg: "bg-blue-50"    };
  if (s.includes("purchase") || s.includes("approval"))
    return { Icon: ShoppingCart, color: "text-green-600",  bg: "bg-green-50"   };
  if (s.includes("login") || s.includes("staff"))
    return { Icon: User,         color: "text-slate-600",  bg: "bg-slate-100"  };
  if (s.includes("password") || s.includes("reset"))
    return { Icon: Lock,         color: "text-slate-600",  bg: "bg-slate-100"  };
  if (s.includes("quotation"))
    return { Icon: FileQuestion, color: "text-indigo-600", bg: "bg-indigo-50"  };

  return { Icon: Bell, color: "text-slate-500", bg: "bg-slate-100" };
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: NotifStatus }) {
  if (status === "SENT")    return null; // clean — no pill needed
  if (status === "FAILED")
    return (
      <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
        Failed
      </span>
    );
  return (
    <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">
      Pending
    </span>
  );
}

// ─── Single row ───────────────────────────────────────────────────────────────

function NotifRow({
  notif, onRead, onNavigate,
}: {
  notif:       NotifLog;
  onRead:      (id: string) => void;
  onNavigate:  (link: string) => void;
}) {
  const { Icon, color, bg } = getNotifMeta(notif.subject);
  const link    = getNotifLink(notif.subject, notif.type);
  const timeAgo = formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true });

  function handleClick() {
    if (!notif.isRead) onRead(notif.id);
    if (link) onNavigate(link);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "flex gap-3 px-4 py-3.5 border-b border-slate-50 last:border-0",
        "hover:bg-slate-50/70 transition-colors duration-100 group",
        !notif.isRead && "bg-blue-50/40",
        link ? "cursor-pointer" : "cursor-default",
      )}
      onClick={handleClick}
    >
      {/* Icon */}
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", bg)}>
        <Icon className={cn("w-4 h-4", color)} strokeWidth={1.8} aria-hidden />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-[13px] leading-snug line-clamp-1", notif.isRead ? "text-slate-600 font-medium" : "text-slate-900 font-semibold")}>
            {notif.subject ?? "Notification"}
          </p>
          <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
            {!notif.isRead && (
              <span className="w-2 h-2 rounded-full bg-blue-500" aria-label="Unread" />
            )}
            {link && (
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" strokeWidth={2} />
            )}
          </div>
        </div>

        <p className="text-[12px] text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
          {notif.message}
        </p>

        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] text-slate-400">{timeAgo}</span>
          <StatusPill status={notif.status} />
          {link && (
            <span className="text-[10px] font-medium text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
              Open →
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Bell className="w-7 h-7 text-slate-300" strokeWidth={1.5} />
      </div>
      <p className="font-semibold text-slate-500 text-sm">All caught up!</p>
      <p className="text-slate-400 text-xs mt-1">No notifications yet. They'll appear here.</p>
    </div>
  );
}

// ─── NotificationBell ─────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen]     = useState(false);
  const ref                 = useRef<HTMLDivElement>(null);
  const queryClient         = useQueryClient();
  const navigate            = useNavigate();

  // ── Unread count — polls every 30s while window is focused ───────────────

  const { data: countData } = useQuery({
    queryKey:               ["notifications", "unread-count"],
    queryFn:                () =>
      api.get<{ success: boolean; data: { count: number } }>("/notifications/unread-count")
        .then((r) => r.data.data),
    refetchInterval:        30_000,
    refetchIntervalInBackground: false,
  });

  const unreadCount = countData?.count ?? 0;

  // ── Logs — fetched when panel opens ──────────────────────────────────────

  const { data: logsData, isLoading } = useQuery({
    queryKey:   ["notifications", "logs"],
    queryFn:    () =>
      api.get<{ success: boolean; data: NotifLog[] }>("/notifications/logs")
        .then((r) => r.data.data),
    enabled:    open,
    staleTime:  0,
  });

  const notifications = logsData ?? [];

  // ── Mark all read on open ─────────────────────────────────────────────────

  const { mutate: markAllRead } = useMutation({
    mutationFn: () => api.patch("/notifications/mark-read"),
    onSuccess:  () => {
      queryClient.setQueryData(["notifications", "unread-count"], { count: 0 });
      queryClient.setQueryData(["notifications", "logs"], (old: NotifLog[] | undefined) =>
        old ? old.map((n) => ({ ...n, isRead: true })) : old,
      );
    },
  });

  useEffect(() => {
    if (open && unreadCount > 0) markAllRead();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mark single read ──────────────────────────────────────────────────────

  const { mutate: markOneRead } = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess:  (_data, id) => {
      queryClient.setQueryData(["notifications", "logs"], (old: NotifLog[] | undefined) =>
        old ? old.map((n) => (n.id === id ? { ...n, isRead: true } : n)) : old,
      );
    },
  });

  // ── Close on outside click ───────────────────────────────────────────────

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  // ── Close on Escape ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div ref={ref} className="relative">

      {/* ── Bell trigger ─────────────────────────────────────────────── */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative w-9 h-9 rounded-xl bg-white/8 hover:bg-white/16 flex items-center justify-center transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <Bell
          className={cn("w-4 h-4 transition-colors", open ? "text-white" : "text-white/75")}
          strokeWidth={1.8}
          aria-hidden
        />

        {/* Badge */}
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 ring-[1.5px] ring-[#0c1f5c]"
              aria-label={`${unreadCount} unread notifications`}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* ── Dropdown panel ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Notifications panel"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,   scale: 1    }}
            exit={{   opacity: 0, y: -10, scale: 0.97  }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute right-0 top-full mt-2.5 w-[400px] max-h-[560px] rounded-2xl bg-white shadow-2xl border border-slate-200/80 overflow-hidden z-50 flex flex-col"
            style={{ boxShadow: "0 20px 60px -10px rgba(0,0,0,0.25), 0 4px 16px -4px rgba(0,0,0,0.12)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-slate-600" strokeWidth={1.8} />
                <span className="font-bold text-slate-800 text-sm">Notifications</span>
                {notifications.length > 0 && (
                  <span className="bg-slate-100 text-slate-500 text-[11px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                    {notifications.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {notifications.some((n) => !n.isRead) && (
                  <button
                    onClick={() => markAllRead()}
                    className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>Mark all read</span>
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
                  aria-label="Close notifications"
                >
                  <X className="w-3.5 h-3.5 text-slate-400" strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                </div>
              ) : notifications.length === 0 ? (
                <EmptyState />
              ) : (
                <div>
                  {notifications.map((notif) => (
                    <NotifRow
                      key={notif.id}
                      notif={notif}
                      onRead={(id) => markOneRead(id)}
                      onNavigate={(link) => { setOpen(false); navigate(link); }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3 bg-slate-50/60">
                <p className="text-[11px] text-slate-400 text-center">
                  Showing last {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
