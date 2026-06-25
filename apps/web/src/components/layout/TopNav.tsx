import { useState, useRef, useEffect, memo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import {
  Home, FileText, ShoppingCart, Package2, FlaskConical, Zap, Link2,
  Search, Phone, Truck, Calendar, ChevronDown, LogOut, Settings, Menu, X,
  Dot, QrCode, Coins, Send, Monitor, IndianRupee, Info, MapPin,
  Receipt, RotateCcw, BookmarkCheck, ClipboardList, Plus, Users,
  MoreHorizontal, TicketCheck, Stethoscope, Banknote, BarChart2, ArrowUpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCalendarTodayCount } from "@/components/calendar/useCalendarEvents";
import { useCurrentUser, clearSession, isSupportStaff, isPlatformAdmin } from "@/lib/auth";
import { api } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────
type NavTab = { href: string; label: string; icon: React.ElementType };

// Primary nav — high-frequency operational modules only
const NAV_TABS: NavTab[] = [
  { href: "/dashboard",          label: "Home",     icon: Home         },
  { href: "/dashboard/purchase", label: "Purchase", icon: ShoppingCart },
];

// Secondary modules surfaced under "More"
type StyledItem = {
  href: string; label: string; description: string; icon: React.ElementType;
  iconBg: string; iconColor: string; hoverBg: string; activeBg: string; activeText: string; accent: string;
  requiredRoles?: string[];
};

const MORE_ITEMS: StyledItem[] = [
  { href: "/dashboard/customers",    label: "Customers",    description: "Manage registered patients",         icon: Users,        iconBg: "bg-sky-500",     iconColor: "text-white", hoverBg: "hover:bg-sky-50",    activeBg: "bg-sky-50",    activeText: "text-sky-700",    accent: "bg-sky-500"    },
  { href: "/dashboard/quotations",   label: "Quotations",   description: "Request & compare supplier prices",  icon: FileText,     iconBg: "bg-slate-500",   iconColor: "text-white", hoverBg: "hover:bg-slate-50",  activeBg: "bg-slate-50",  activeText: "text-slate-800",  accent: "bg-slate-500"  },
  { href: "/dashboard/medicines",    label: "Medicines",    description: "Global medicines catalogue",         icon: FlaskConical, iconBg: "bg-emerald-500", iconColor: "text-white", hoverBg: "hover:bg-emerald-50",activeBg: "bg-emerald-50",activeText: "text-emerald-700",accent: "bg-emerald-500"},
  { href: "/dashboard/doctors",        label: "Doctors",        description: "Doctor master & prescription links",    icon: Stethoscope,   iconBg: "bg-indigo-500",  iconColor: "text-white", hoverBg: "hover:bg-indigo-50",  activeBg: "bg-indigo-50",  activeText: "text-indigo-700",  accent: "bg-indigo-500"  },
  { href: "/dashboard/prescriptions", label: "Prescriptions", description: "Manage Rx for Schedule H/H1/X drugs", icon: ClipboardList, iconBg: "bg-violet-600",  iconColor: "text-white", hoverBg: "hover:bg-violet-50",  activeBg: "bg-violet-50",  activeText: "text-violet-700",  accent: "bg-violet-600"  },
  { href: "/dashboard/cash-closure",  label: "Cash Closure",  description: "Day-end cash reconciliation",          icon: Banknote,      iconBg: "bg-amber-500",   iconColor: "text-white", hoverBg: "hover:bg-amber-50",   activeBg: "bg-amber-50",   activeText: "text-amber-800",   accent: "bg-amber-500"   },
  { href: "/dashboard/ginni",        label: "Ginni",        description: "AI assistant",                       icon: Zap,          iconBg: "bg-violet-500",  iconColor: "text-white", hoverBg: "hover:bg-violet-50", activeBg: "bg-violet-50", activeText: "text-violet-700", accent: "bg-violet-500" },
];

const INVENTORY_ITEMS: StyledItem[] = [
  { href: "/dashboard/inventory",   label: "Inventory",   description: "Stock levels & batches",  icon: Package2,     iconBg: "bg-blue-600",    iconColor: "text-white", hoverBg: "hover:bg-blue-50",   activeBg: "bg-blue-50",   activeText: "text-blue-700",   accent: "bg-blue-600",   requiredRoles: undefined },
  { href: "/dashboard/locations",   label: "Locations",   description: "Store shelf locations",   icon: MapPin,       iconBg: "bg-teal-500",    iconColor: "text-white", hoverBg: "hover:bg-teal-50",   activeBg: "bg-teal-50",   activeText: "text-teal-700",   accent: "bg-teal-500",   requiredRoles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/stock-audit", label: "Stock Audit", description: "Audit & reconcile stock", icon: ClipboardList,iconBg: "bg-orange-500",  iconColor: "text-white", hoverBg: "hover:bg-orange-50", activeBg: "bg-orange-50", activeText: "text-orange-700", accent: "bg-orange-500", requiredRoles: undefined },
];

type SalesItem = {
  href:        string;
  label:       string;
  description: string;
  icon:        React.ElementType;
  kbd?:        string;
  activeTab:   string;   // which ?tab= value makes this item highlighted
  iconBg:      string;
  iconColor:   string;
  hoverBg:     string;
  activeBg:    string;
  activeText:  string;
  accent:      string;
};
const SALES_ITEMS: SalesItem[] = [
  {
    href: "/dashboard/billing",             activeTab: "bills",
    label: "All Bills",   description: "View and search invoices",
    icon: FileText,
    iconBg: "bg-slate-600", iconColor: "text-white",
    hoverBg: "hover:bg-slate-50", activeBg: "bg-slate-50", activeText: "text-slate-800", accent: "bg-slate-500",
  },
  {
    href: "/dashboard/billing?tab=drafts",  activeTab: "drafts",
    label: "Draft Bills", description: "Resume saved drafts",
    icon: BookmarkCheck,
    iconBg: "bg-amber-500", iconColor: "text-white",
    hoverBg: "hover:bg-amber-50", activeBg: "bg-amber-50", activeText: "text-amber-800", accent: "bg-amber-500",
  },
  {
    href: "/dashboard/billing?tab=returns", activeTab: "returns",
    label: "Returns",     description: "Process & view sales returns",
    icon: RotateCcw,
    iconBg: "bg-rose-500", iconColor: "text-white",
    hoverBg: "hover:bg-rose-50", activeBg: "bg-rose-50", activeText: "text-rose-700", accent: "bg-rose-500",
  },
];

type MenuItem = {
  id: string; icon: React.ElementType; label: string;
  extra?: string; extraType?: "blue" | "badge-new" | "coin"; href?: string; requiredRoles?: string[];
};

// Operational items — used daily for running the pharmacy
const OPERATIONAL_MENU_ITEMS: MenuItem[] = [
  { id: "settings",    icon: Settings,         label: "Account & Settings", href: "/dashboard/settings/pharmacy-profile" },
  { id: "integration", icon: Link2,           label: "Integrations",       href: "/dashboard/integration",  requiredRoles: ["OWNER", "MANAGER"] },
  { id: "migration",   icon: ArrowUpCircle,   label: "Data Migration",      href: "/dashboard/migration",   requiredRoles: ["OWNER"] },
  { id: "qr",          icon: QrCode,   label: "Show QR",            extraType: "blue"     },
  { id: "support",     icon: Monitor,  label: "Support Tickets",    extra: "New", extraType: "badge-new", href: "/dashboard/support" },
  { id: "shortcuts",   icon: Info,     label: "Shortcuts / Help"                           },
];

// Marketing/rewards items — secondary, shown below a divider
const MARKETING_MENU_ITEMS: MenuItem[] = [
  { id: "coins", icon: Coins,       label: "VitalCoins", extraType: "coin" },
  { id: "refer", icon: Send,        label: "Refer & Earn"                  },
  { id: "zero",  icon: IndianRupee, label: "ZERO"                          },
];

// ─── Helpers ──────────────────────────────────────────────────────
function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname.startsWith(href);
}

// Shared hook: handles outside-click + ESC for a single dropdown
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOut, { passive: true });
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey, { passive: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return { open, setOpen, ref };
}

// ─── NavItem ──────────────────────────────────────────────────────
// memo: pathname changes on every navigation, but most tabs aren't affected
const NavItem = memo(function NavItem({ tab, pathname }: { tab: NavTab; pathname: string }) {
  const active       = isActive(pathname, tab.href);
  const Icon         = tab.icon;
  const queryClient  = useQueryClient();

  const handleMouseEnter = useCallback(() => {
    if (tab.href === "/dashboard/purchase") {
      // Warm the suppliers list so the Purchase page renders instantly
      void queryClient.prefetchQuery({
        queryKey: queryKeys.suppliers.all(),
        queryFn:  () => api.get("/suppliers/all").then((r) => r.data.data ?? []),
        staleTime: 5 * 60_000,
      });
    }
  }, [queryClient, tab.href]);

  return (
    <Link
      to={tab.href}
      role="tab"
      aria-selected={active}
      onMouseEnter={handleMouseEnter}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
        "text-[13px] font-semibold transition-all duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-white/50",
        active
          ? "bg-white text-brand-700 shadow-sm"
          : "text-white/70 hover:text-white hover:bg-white/10"
      )}
    >
      <Icon
        className={cn("w-3 h-3 flex-shrink-0", active ? "text-brand-600" : "text-white/55")}
        strokeWidth={active ? 2.3 : 1.9}
        aria-hidden
      />
      <span>{tab.label}</span>
    </Link>
  );
});

// ─── Shop Live Toggle ─────────────────────────────────────────────
// memo: never depends on pathname — isolated from route changes
const ShopLiveToggle = memo(function ShopLiveToggle() {
  const [on, setOn] = useState(true);
  return (
    <button
      onClick={() => setOn(v => !v)}
      aria-label={`Shop Live ${on ? "on" : "off"}`}
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 bg-white/8 hover:bg-white/14 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <div className={cn("relative h-4 w-7 rounded-full flex-shrink-0 transition-colors duration-200", on ? "bg-emerald-400" : "bg-white/20")}>
        {/* CSS translate replaces motion.span layout — no JS layout pass */}
        <span
          className="absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 will-change-transform"
          style={{ transform: on ? "translateX(10px)" : "translateX(0)" }}
        />
      </div>
      <span className="text-[12px] font-bold text-white/80 leading-none">Shop Live</span>
      <span className={cn("text-[10px] font-semibold leading-none", on ? "text-emerald-300" : "text-white/35")}>
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
});

// ─── Calendar Pill ────────────────────────────────────────────────
// memo: re-renders only when calendar count changes
const CalendarPill = memo(function CalendarPill() {
  const navigate  = useNavigate();
  const { data: count = 0 } = useCalendarTodayCount();

  return (
    <button
      onClick={() => navigate("/dashboard/calendar")}
      aria-label={`Calendar — ${count} event${count !== 1 ? "s" : ""} today`}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-white/8 hover:bg-white/14 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <div className="relative flex-shrink-0">
        <Calendar className="w-3.5 h-3.5 text-white/70" strokeWidth={1.8} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400 ring-[1.5px] ring-navy-900" />
        )}
      </div>
      <span className="text-[12px] font-bold text-white/80 leading-none">Calendar</span>
      {count > 0 && (
        <span className="text-[10px] font-semibold text-white/50 leading-none tabular-nums">{count}</span>
      )}
    </button>
  );
});

// ─── Global Search ────────────────────────────────────────────────
// memo: no dynamic props — only internal focused state changes
const GlobalSearchBar = memo(function GlobalSearchBar() {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", handler, { passive: false });
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className={cn(
      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 w-44 transition-all duration-150",
      focused ? "bg-white/18 ring-1 ring-white/30" : "bg-white/8 hover:bg-white/12"
    )}>
      <Search className="w-3 h-3 text-white/40 flex-shrink-0" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        aria-label="Global search"
        placeholder="Search…"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 min-w-0 bg-transparent text-[12px] text-white placeholder-white/30 focus:outline-none"
      />
      {!focused && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <kbd className="kbd-hint">Ctrl</kbd>
          <kbd className="kbd-hint">K</kbd>
        </div>
      )}
    </div>
  );
});

// ─── Icon Btn ─────────────────────────────────────────────────────
const IconBtn = memo(function IconBtn({ icon: Icon, label, badge }: { icon: React.ElementType; label: string; badge?: number }) {
  return (
    <button
      aria-label={label}
      className="relative w-8 h-8 rounded-lg bg-white/8 hover:bg-white/16 flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <Icon className="w-3.5 h-3.5 text-white/70" strokeWidth={1.8} aria-hidden />
      {badge != null && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center px-0.5 ring-[1.5px] ring-navy-900">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
});

// ─── New Bill Quick Button ─────────────────────────────────────────
// memo: navigate ref is stable; no pathname dependency
const NewBillBtn = memo(function NewBillBtn() {
  const navigate = useNavigate();
  return (
    // CSS scale replaces motion.button whileHover/whileTap — no framer listeners
    <button
      onClick={() => navigate("/dashboard/billing/new")}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold text-[13px] bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-all duration-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 active:scale-[0.97] hover:scale-[1.02] will-change-transform"
      aria-label="New Bill (F2)"
    >
      <Plus className="w-3 h-3" strokeWidth={2.5} />
      New Bill
      <kbd className="kbd-hint ml-0.5">F2</kbd>
    </button>
  );
});

// ─── Profile Dropdown ─────────────────────────────────────────────
function ProfileDropdown() {
  const { open, setOpen, ref } = useDropdown();
  const navigate = useNavigate();
  const user = useCurrentUser();
  // Support staff only see Account & Settings — all pharmacy-specific items are hidden.
  const isSupport = isSupportStaff();
  const visibleOperational = isSupport
    ? OPERATIONAL_MENU_ITEMS.filter((item) => item.id === "settings")
    : OPERATIONAL_MENU_ITEMS.filter((item) => !item.requiredRoles || item.requiredRoles.includes(user.rawRole));
  const visibleMarketing = isSupport ? [] : MARKETING_MENU_ITEMS;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Open profile menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 bg-white/10 hover:bg-white/16 rounded-lg pl-1.5 pr-2 py-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 flex items-center justify-center text-white text-[10px] font-extrabold shadow-inner select-none">
          {user.initials}
        </div>
        <div className="text-left leading-none hidden sm:block">
          <p className="text-[11px] font-bold text-white leading-none truncate max-w-[80px]">{user.name}</p>
          <p className="text-[9px] text-white/45 mt-0.5 leading-none truncate max-w-[80px]">{user.role}</p>
        </div>
        <ChevronDown className={cn("w-3 h-3 text-white/40 transition-transform duration-200", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute right-0 top-full mt-2 w-[380px] rounded-2xl shadow-2xl border border-slate-200/70 overflow-hidden z-50 flex"
            style={{ boxShadow: "0 20px 60px -10px rgba(0,0,0,0.22), 0 4px 16px -4px rgba(0,0,0,0.10)" }}
          >
            {/* Left panel */}
            <div
              className="w-[40%] flex flex-col justify-between p-4 relative overflow-hidden"
              style={{ background: "linear-gradient(160deg, #0c1f5c 0%, #132468 55%, #1a3080 100%)" }}
            >
              <span className="absolute -top-5 -right-5 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />
              <span className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-white/5 pointer-events-none" />
              <div>
                <div className="w-10 h-10 rounded-xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center mb-2.5 shadow-inner select-none">
                  <span className="text-white font-black text-[13px] leading-none">{user.pharmacyInitials}</span>
                </div>
                <p className="text-white font-bold text-[13px] leading-snug">{user.pharmacyName}</p>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <div className="w-8 h-8 rounded-full ring-2 ring-white/20 bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                  {user.initials}
                </div>
                <div className="min-w-0">
                  <p className="text-white text-[11px] font-semibold truncate">{user.name}</p>
                  <p className="text-white/50 text-[10px] truncate">{user.role}</p>
                </div>
              </div>
            </div>

            {/* Right panel */}
            <div className="flex-1 bg-white py-1.5 flex flex-col">
              {/* ── Operational items ── */}
              {visibleOperational.map(({ id, icon: Icon, label, extra, extraType, href }) => (
                <button
                  key={id}
                  role="menuitem"
                  onClick={() => {
                setOpen(false);
                if (id === "shortcuts") { window.dispatchEvent(new CustomEvent("checkup:open-help", { detail: { category: "shortcuts" } })); return; }
                if (href) navigate(href);
              }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors outline-none group"
                >
                  <span className={cn(
                    "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
                    id === "qr"          ? "bg-blue-50    group-hover:bg-blue-100"   :
                    id === "integration" ? "bg-violet-50  group-hover:bg-violet-100" :
                                          "bg-slate-100  group-hover:bg-slate-200"
                  )}>
                    <Icon className={cn("w-3 h-3",
                      id === "qr"          ? "text-blue-600"   :
                      id === "integration" ? "text-violet-600" : "text-slate-500"
                    )} strokeWidth={1.8} />
                  </span>
                  <span className="font-medium flex-1 text-left text-[12px]">{label}</span>
                  {extraType === "badge-new" && extra && (
                    <span className="bg-orange-100 text-orange-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{extra}</span>
                  )}
                </button>
              ))}

              {/* ── Marketing / rewards divider ── */}
              {visibleMarketing.length > 0 && (
                <>
                  <div className="mx-3 mt-1 mb-0.5 border-t border-slate-100" />
                  <p className="px-3.5 pt-1 pb-0.5 text-[9px] font-bold text-slate-300 uppercase tracking-widest">Rewards & More</p>
                  {visibleMarketing.map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3.5 py-1.5 text-[12px] text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors outline-none group"
                    >
                      <span className={cn(
                        "w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
                        id === "coins" ? "bg-amber-50 group-hover:bg-amber-100" :
                        id === "refer" ? "bg-sky-50   group-hover:bg-sky-100"   :
                                         "bg-green-50 group-hover:bg-green-100"
                      )}>
                        <Icon className={cn("w-2.5 h-2.5",
                          id === "coins" ? "text-amber-500" :
                          id === "refer" ? "text-sky-500"   : "text-green-600"
                        )} strokeWidth={1.8} />
                      </span>
                      <span className="font-medium flex-1 text-left">{label}</span>
                    </button>
                  ))}
                </>
              )}

              <div className="mx-3 my-1 border-t border-slate-100" />
              <div className="flex items-center gap-2.5 px-3.5 py-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0 select-none">
                  {user.initials}
                </div>
                <div className="min-w-0">
                  <p className="text-slate-700 text-[11px] font-semibold truncate">{user.name}</p>
                  <p className="text-slate-400 text-[10px] truncate">{user.role}</p>
                </div>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  // Revoke server-side first (bumps tokenVersion, killing all
                  // outstanding tokens incl. other tabs). Fire-and-forget — the
                  // request captures the token synchronously, so clearing
                  // storage right after is safe even if the call is in flight.
                  void api.post("/auth/logout").catch(() => { /* best-effort */ });
                  clearSession();
                  navigate("/login");
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-red-500 hover:bg-red-50 transition-colors group"
              >
                <span className="w-6 h-6 rounded-md bg-red-50 group-hover:bg-red-100 flex items-center justify-center flex-shrink-0">
                  <LogOut className="w-3 h-3 text-red-400" strokeWidth={1.8} />
                </span>
                <span className="font-medium">Logout</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sales Nav Dropdown ────────────────────────────────────────────
const SalesNavDropdown = memo(function SalesNavDropdown({ pathname }: { pathname: string }) {
  const { open, setOpen, ref } = useDropdown();
  const { search } = useLocation();
  const salesActive = pathname.startsWith("/dashboard/billing");
  // Current tab on the SalesPage (defaults to "bills" when absent)
  const currentTab  = new URLSearchParams(search).get("tab") ?? "bills";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
          "text-[13px] font-semibold transition-all duration-150 outline-none",
          "focus-visible:ring-2 focus-visible:ring-white/50",
          salesActive
            ? "bg-white text-brand-700 shadow-sm"
            : "text-white/70 hover:text-white hover:bg-white/10"
        )}
      >
        <Receipt className={cn("w-3 h-3 flex-shrink-0", salesActive ? "text-brand-600" : "text-white/55")} strokeWidth={salesActive ? 2.3 : 1.9} />
        <span>Sales</span>
        <ChevronDown className={cn("w-2.5 h-2.5 transition-transform duration-200", open && "rotate-180", salesActive ? "text-brand-400" : "text-white/35")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-0 top-full mt-1.5 w-52 rounded-xl bg-white overflow-hidden z-50"
            style={{ boxShadow: "0 20px 48px -8px rgba(0,0,0,0.22), 0 4px 16px -4px rgba(0,0,0,0.10)", border: "1px solid rgba(226,232,240,0.8)" }}
          >
            {/* Header */}
            <div
              className="px-3 py-2 flex items-center justify-between"
              style={{ background: "linear-gradient(135deg,#0a1a52 0%,#162870 100%)" }}
            >
              <div className="flex items-center gap-2">
                <Receipt className="w-3.5 h-3.5 text-white/70" strokeWidth={1.8} />
                <span className="text-[12px] font-bold text-white tracking-wide">Sales</span>
              </div>
              <span className="text-[9px] font-semibold text-white/40 bg-white/10 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Module</span>
            </div>

            {/* Items */}
            <div className="p-1.5 space-y-0.5">
              {SALES_ITEMS.map((item) => {
                const { href, label, description, icon: Icon, kbd, activeTab,
                        iconBg, iconColor, hoverBg, activeBg, activeText, accent } = item;
                // Active when on the billing page with the matching tab
                const active = pathname === "/dashboard/billing" && currentTab === activeTab;

                return (
                  <Link
                    key={href}
                    to={href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-100 group overflow-hidden",
                      active ? cn(activeBg, activeText) : cn("text-slate-700", hoverBg)
                    )}
                  >
                    {/* CSS accent bar */}
                    <span className={cn(
                      "absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-opacity duration-150",
                      accent,
                      active ? "opacity-100" : "opacity-0"
                    )} />

                    {/* Icon tile */}
                    <span className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm transition-transform duration-100 group-hover:scale-105",
                      active ? iconBg : cn(iconBg, "opacity-80 group-hover:opacity-100")
                    )}>
                      <Icon className={cn("w-3.5 h-3.5", iconColor)} strokeWidth={2} />
                    </span>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-[12px] font-bold leading-tight",
                        active ? activeText : "text-slate-800"
                      )}>
                        {label}
                      </p>
                      <p className={cn(
                        "text-[10px] mt-0.5 leading-tight",
                        active ? "opacity-70" : "text-slate-400"
                      )}>
                        {description}
                      </p>
                    </div>

                    {/* Keyboard shortcut */}
                    {kbd && (
                      <kbd className="kbd-hint-dark flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                        {kbd}
                      </kbd>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mx-2 mb-1.5 px-2.5 py-1.5 bg-slate-50 rounded-lg flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-medium">New Bill → <kbd className="text-[9px] bg-slate-200 px-1 rounded">F2</kbd></span>
              <Link
                to="/dashboard/billing"
                onClick={() => setOpen(false)}
                className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
              >
                Open Sales →
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── More Nav Dropdown ────────────────────────────────────────────
const MoreNavDropdown = memo(function MoreNavDropdown({ pathname }: { pathname: string }) {
  const { open, setOpen, ref } = useDropdown();
  const moreActive = MORE_ITEMS.some((item) => pathname.startsWith(item.href));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
          "text-[13px] font-semibold transition-all duration-150 outline-none",
          "focus-visible:ring-2 focus-visible:ring-white/50",
          moreActive
            ? "bg-white text-brand-700 shadow-sm"
            : "text-white/70 hover:text-white hover:bg-white/10"
        )}
      >
        <MoreHorizontal className={cn("w-3 h-3 flex-shrink-0", moreActive ? "text-brand-600" : "text-white/55")} strokeWidth={moreActive ? 2.3 : 1.9} />
        <span>More</span>
        <ChevronDown className={cn("w-2.5 h-2.5 transition-transform duration-200", open && "rotate-180", moreActive ? "text-brand-400" : "text-white/35")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-0 top-full mt-1.5 w-52 rounded-xl bg-white overflow-hidden z-50"
            style={{ boxShadow: "0 20px 48px -8px rgba(0,0,0,0.22), 0 4px 16px -4px rgba(0,0,0,0.10)", border: "1px solid rgba(226,232,240,0.8)" }}
          >
            {/* Header */}
            <div
              className="px-3 py-2 flex items-center justify-between"
              style={{ background: "linear-gradient(135deg,#0a1a52 0%,#162870 100%)" }}
            >
              <div className="flex items-center gap-2">
                <MoreHorizontal className="w-3.5 h-3.5 text-white/70" strokeWidth={1.8} />
                <span className="text-[12px] font-bold text-white tracking-wide">More</span>
              </div>
              <span className="text-[9px] font-semibold text-white/40 bg-white/10 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Module</span>
            </div>
            {/* Items */}
            <div className="p-1.5 space-y-0.5">
              {MORE_ITEMS.map(({ href, label, description, icon: Icon, iconBg, iconColor, hoverBg, activeBg, activeText, accent }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    to={href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-100 group overflow-hidden",
                      active ? cn(activeBg, activeText) : cn("text-slate-700", hoverBg)
                    )}
                  >
                    <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-opacity duration-150", accent, active ? "opacity-100" : "opacity-0")} />
                    <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm transition-transform duration-100 group-hover:scale-105", active ? iconBg : cn(iconBg, "opacity-80 group-hover:opacity-100"))}>
                      <Icon className={cn("w-3.5 h-3.5", iconColor)} strokeWidth={2} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-[12px] font-bold leading-tight", active ? activeText : "text-slate-800")}>{label}</p>
                      <p className={cn("text-[10px] mt-0.5 leading-tight", active ? "opacity-70" : "text-slate-400")}>{description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── Inventory Nav Dropdown ───────────────────────────────────────
const InventoryNavDropdown = memo(function InventoryNavDropdown({ pathname, rawRole }: { pathname: string; rawRole: string }) {
  const { open, setOpen, ref } = useDropdown();
  const queryClient = useQueryClient();
  const visibleInventoryItems = INVENTORY_ITEMS.filter(
    (item) => !item.requiredRoles || item.requiredRoles.includes(rawRole),
  );
  const inventoryActive =
    pathname.startsWith("/dashboard/inventory") ||
    pathname.startsWith("/dashboard/locations") ||
    pathname.startsWith("/dashboard/stock-audit");

  const handleMouseEnter = useCallback(() => {
    // Warm the default inventory list so the Inventory page renders instantly
    const defaultParams = { page: 1, search: "", status: "", inStock: false, lowStock: false, nearExpiry: false };
    void queryClient.prefetchQuery({
      queryKey: queryKeys.inventory.list(defaultParams),
      queryFn:  () =>
        api.get("/inventory", { params: { page: 1, limit: 20 } }).then((r) => r.data.data),
      staleTime: 30_000,
    });
  }, [queryClient]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        onMouseEnter={handleMouseEnter}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
          "text-[13px] font-semibold transition-all duration-150 outline-none",
          "focus-visible:ring-2 focus-visible:ring-white/50",
          inventoryActive
            ? "bg-white text-brand-700 shadow-sm"
            : "text-white/70 hover:text-white hover:bg-white/10"
        )}
      >
        <Package2 className={cn("w-3 h-3 flex-shrink-0", inventoryActive ? "text-brand-600" : "text-white/55")} strokeWidth={inventoryActive ? 2.3 : 1.9} />
        <span>Inventory</span>
        <ChevronDown className={cn("w-2.5 h-2.5 transition-transform duration-200", open && "rotate-180", inventoryActive ? "text-brand-400" : "text-white/35")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-0 top-full mt-1.5 w-52 rounded-xl bg-white overflow-hidden z-50"
            style={{ boxShadow: "0 20px 48px -8px rgba(0,0,0,0.22), 0 4px 16px -4px rgba(0,0,0,0.10)", border: "1px solid rgba(226,232,240,0.8)" }}
          >
            {/* Header */}
            <div
              className="px-3 py-2 flex items-center justify-between"
              style={{ background: "linear-gradient(135deg,#0a1a52 0%,#162870 100%)" }}
            >
              <div className="flex items-center gap-2">
                <Package2 className="w-3.5 h-3.5 text-white/70" strokeWidth={1.8} />
                <span className="text-[12px] font-bold text-white tracking-wide">Inventory</span>
              </div>
              <span className="text-[9px] font-semibold text-white/40 bg-white/10 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Module</span>
            </div>
            {/* Items */}
            <div className="p-1.5 space-y-0.5">
              {visibleInventoryItems.map(({ href, label, description, icon: Icon, iconBg, iconColor, hoverBg, activeBg, activeText, accent }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    to={href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-100 group overflow-hidden",
                      active ? cn(activeBg, activeText) : cn("text-slate-700", hoverBg)
                    )}
                  >
                    <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-opacity duration-150", accent, active ? "opacity-100" : "opacity-0")} />
                    <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm transition-transform duration-100 group-hover:scale-105", active ? iconBg : cn(iconBg, "opacity-80 group-hover:opacity-100"))}>
                      <Icon className={cn("w-3.5 h-3.5", iconColor)} strokeWidth={2} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-[12px] font-bold leading-tight", active ? activeText : "text-slate-800")}>{label}</p>
                      <p className={cn("text-[10px] mt-0.5 leading-tight", active ? "opacity-70" : "text-slate-400")}>{description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── Mobile Menu ──────────────────────────────────────────────────
function MobileMenu({ pathname, rawRole }: { pathname: string; rawRole: string }) {
  const [open, setOpen] = useState(false);
  const brand = useCurrentUser();
  const visibleInventoryItems = INVENTORY_ITEMS.filter(
    (item) => !item.requiredRoles || item.requiredRoles.includes(rawRole),
  );
  const [salesExpanded,     setSalesExpanded]     = useState(() => pathname.startsWith("/dashboard/billing"));
  const [inventoryExpanded, setInventoryExpanded] = useState(() =>
    pathname.startsWith("/dashboard/inventory") ||
    pathname.startsWith("/dashboard/locations") ||
    pathname.startsWith("/dashboard/stock-audit"),
  );
  const [moreExpanded, setMoreExpanded] = useState(() =>
    MORE_ITEMS.some((item) => pathname.startsWith(item.href)),
  );

  const isSalesActive     = pathname.startsWith("/dashboard/billing");
  const isInventoryActive =
    pathname.startsWith("/dashboard/inventory") ||
    pathname.startsWith("/dashboard/locations") ||
    pathname.startsWith("/dashboard/stock-audit");
  const isMoreActive = MORE_ITEMS.some((item) => pathname.startsWith(item.href));

  useEffect(() => {
    setOpen(false);
    if (pathname.startsWith("/dashboard/billing")) setSalesExpanded(true);
    if (isInventoryActive) setInventoryExpanded(true);
    if (isMoreActive) setMoreExpanded(true);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey, { passive: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Toggle navigation"
        className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 text-white xl:hidden"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? "x" : "menu"}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {open ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
          </motion.span>
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm xl:hidden"
            />
            <motion.nav
              role="dialog"
              aria-label="Navigation menu"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="fixed left-0 top-0 z-50 h-full w-60 bg-gradient-to-b from-navy-900 to-navy-800 shadow-2xl xl:hidden flex flex-col"
            >
              <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 ring-1 ring-white/20 flex items-center justify-center select-none shadow-inner">
                  <span className="text-white font-black text-[11px] leading-none tracking-tight">{brand.pharmacyInitials}</span>
                </div>
                <div>
                  <p className="text-white font-bold text-[13px] truncate max-w-[140px]">{brand.pharmacyName}</p>
                </div>
                <button onClick={() => setOpen(false)} className="ml-auto w-6 h-6 rounded-md bg-white/10 flex items-center justify-center text-white/60 hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </div>

              <div className="flex flex-col gap-0.5 p-2.5 flex-1 overflow-y-auto">
                {NAV_TABS[0] && (() => {
                  const tab: NavTab = NAV_TABS[0];
                  const active = isActive(pathname, tab.href);
                  const Icon = tab.icon;
                  return (
                    <Link key={tab.href} to={tab.href} onClick={() => setOpen(false)}
                      className={cn("flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all",
                        active ? "bg-white text-brand-700" : "text-white/65 hover:text-white hover:bg-white/10")}
                    >
                      <Icon className={cn("w-3.5 h-3.5", active ? "text-brand-600" : "text-white/50")} strokeWidth={1.8} />
                      {tab.label}
                      {active && <Dot className="ml-auto w-3.5 h-3.5 text-brand-500" />}
                    </Link>
                  );
                })()}

                <div>
                  <button
                    onClick={() => setSalesExpanded(v => !v)}
                    className={cn("w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all",
                      isSalesActive ? "bg-white/10 text-white" : "text-white/65 hover:text-white hover:bg-white/10")}
                  >
                    <Receipt className={cn("w-3.5 h-3.5", isSalesActive ? "text-white/80" : "text-white/50")} strokeWidth={1.8} />
                    Sales
                    <ChevronDown className={cn("w-3 h-3 ml-auto transition-transform duration-200", salesExpanded && "rotate-180")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {salesExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
                        <div className="ml-4 mt-0.5 mb-0.5 space-y-0.5 border-l border-white/10 pl-2.5">
                          {SALES_ITEMS.map(({ href, label, icon: Icon }) => {
                            const active = href === "/dashboard/billing" ? pathname === href : pathname.startsWith(href);
                            return (
                              <Link key={href} to={href} onClick={() => setOpen(false)}
                                className={cn("flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
                                  active ? "bg-white text-brand-700" : "text-white/60 hover:text-white hover:bg-white/10")}
                              >
                                <Icon className={cn("w-3 h-3", active ? "text-brand-600" : "text-white/40")} strokeWidth={1.8} />
                                {label}
                                {active && <Dot className="ml-auto w-3.5 h-3.5 text-brand-500" />}
                              </Link>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Inventory — expandable section */}
                <div>
                  <button
                    onClick={() => setInventoryExpanded(v => !v)}
                    className={cn("w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all",
                      isInventoryActive ? "bg-white/10 text-white" : "text-white/65 hover:text-white hover:bg-white/10")}
                  >
                    <Package2 className={cn("w-3.5 h-3.5", isInventoryActive ? "text-white/80" : "text-white/50")} strokeWidth={1.8} />
                    Inventory
                    <ChevronDown className={cn("w-3 h-3 ml-auto transition-transform duration-200", inventoryExpanded && "rotate-180")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {inventoryExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
                        <div className="ml-4 mt-0.5 mb-0.5 space-y-0.5 border-l border-white/10 pl-2.5">
                          {visibleInventoryItems.map(({ href, label, icon: Icon }) => {
                            const active = pathname.startsWith(href);
                            return (
                              <Link key={href} to={href} onClick={() => setOpen(false)}
                                className={cn("flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
                                  active ? "bg-white text-brand-700" : "text-white/60 hover:text-white hover:bg-white/10")}
                              >
                                <Icon className={cn("w-3 h-3", active ? "text-brand-600" : "text-white/40")} strokeWidth={1.8} />
                                {label}
                                {active && <Dot className="ml-auto w-3.5 h-3.5 text-brand-500" />}
                              </Link>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Purchase — flat tab */}
                {NAV_TABS[1] && (() => {
                  const tab = NAV_TABS[1]!;
                  const active = isActive(pathname, tab.href);
                  const Icon = tab.icon;
                  return (
                    <Link key={tab.href} to={tab.href} onClick={() => setOpen(false)}
                      className={cn("flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all",
                        active ? "bg-white text-brand-700" : "text-white/65 hover:text-white hover:bg-white/10")}
                    >
                      <Icon className={cn("w-3.5 h-3.5", active ? "text-brand-600" : "text-white/50")} strokeWidth={1.8} />
                      {tab.label}
                      {active && <Dot className="ml-auto w-3.5 h-3.5 text-brand-500" />}
                    </Link>
                  );
                })()}

                {/* Reports — OWNER/MANAGER only */}
                {(rawRole === "OWNER" || rawRole === "MANAGER") && (() => {
                  const active = pathname.startsWith("/dashboard/reports");
                  return (
                    <Link to="/dashboard/reports" onClick={() => setOpen(false)}
                      className={cn("flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all",
                        active ? "bg-white text-brand-700" : "text-white/65 hover:text-white hover:bg-white/10")}
                    >
                      <BarChart2 className={cn("w-3.5 h-3.5", active ? "text-brand-600" : "text-white/50")} strokeWidth={1.8} />
                      Reports
                      {active && <Dot className="ml-auto w-3.5 h-3.5 text-brand-500" />}
                    </Link>
                  );
                })()}

                {/* More — expandable section: Customers, Medicines, Ginni */}
                <div>
                  <button
                    onClick={() => setMoreExpanded((v) => !v)}
                    className={cn("w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all",
                      isMoreActive ? "bg-white/10 text-white" : "text-white/65 hover:text-white hover:bg-white/10")}
                  >
                    <MoreHorizontal className={cn("w-3.5 h-3.5", isMoreActive ? "text-white/80" : "text-white/50")} strokeWidth={1.8} />
                    More
                    <ChevronDown className={cn("w-3 h-3 ml-auto transition-transform duration-200", moreExpanded && "rotate-180")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {moreExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
                        <div className="ml-4 mt-0.5 mb-0.5 space-y-0.5 border-l border-white/10 pl-2.5">
                          {MORE_ITEMS.map(({ href, label, icon: Icon }) => {
                            const active = pathname.startsWith(href);
                            return (
                              <Link key={href} to={href} onClick={() => setOpen(false)}
                                className={cn("flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
                                  active ? "bg-white text-brand-700" : "text-white/60 hover:text-white hover:bg-white/10")}
                              >
                                <Icon className={cn("w-3 h-3", active ? "text-brand-600" : "text-white/40")} strokeWidth={1.8} />
                                {label}
                                {active && <Dot className="ml-auto w-3.5 h-3.5 text-brand-500" />}
                              </Link>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Support staff nav (agents / platform admin) ──────────────────
function SupportNav() {
  const { pathname } = useLocation();
  const brand        = useCurrentUser();
  const isAdmin      = isPlatformAdmin();

  const SUPPORT_TABS: NavTab[] = [
    { href: "/dashboard/support",        label: "Tickets", icon: TicketCheck },
    ...(isAdmin ? [{ href: "/dashboard/support/agents", label: "Agents", icon: Users }] : []),
  ];

  return (
    <header
      role="banner"
      className="sticky top-0 z-50 flex items-center gap-2 px-4 flex-shrink-0"
      style={{
        height: "var(--nav-height, 52px)",
        background: "linear-gradient(135deg, #0a1a52 0%, #101e60 40%, #162870 100%)",
        boxShadow: "0 2px 20px 0 rgba(8,13,45,0.45), 0 1px 0 0 rgba(255,255,255,0.05) inset",
      }}
    >
      {/* Brand */}
      <Link
        to="/dashboard/support"
        className="flex items-center gap-2 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-lg p-0.5"
        aria-label="Checkup Support — dashboard"
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center ring-1 ring-white/20 flex-shrink-0 bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 shadow-inner select-none">
          <span className="text-white font-black text-[10px] leading-none tracking-tight">
            {brand.pharmacyInitials}
          </span>
        </div>
        <p className="text-white font-extrabold text-[14px] tracking-tight leading-none hidden sm:block truncate max-w-[160px]">
          {brand.pharmacyName}
        </p>
      </Link>

      <div className="h-5 w-px bg-white/15 flex-shrink-0 mx-0.5" />

      <nav role="tablist" aria-label="Support navigation" className="hidden xl:flex items-center gap-0.5">
        {SUPPORT_TABS.map((tab) => <NavItem key={tab.href} tab={tab} pathname={pathname} />)}
      </nav>

      <div className="flex-1" />

      <div className="hidden md:flex items-center gap-1.5">
        <GlobalSearchBar />
        <div className="h-5 w-px bg-white/15 mx-1" />
        <NotificationBell />
        <div className="h-5 w-px bg-white/15 mx-1" />
        <ProfileDropdown />
      </div>

      <div className="flex items-center gap-1.5 md:hidden">
        <NotificationBell />
        <ProfileDropdown />
      </div>
    </header>
  );
}

// ─── TopNav — main export ─────────────────────────────────────────
export function TopNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const brand    = useCurrentUser();
  const { rawRole } = brand;

  // F2 = New Bill (global shortcut, pharmacy users only)
  useEffect(() => {
    if (isSupportStaff()) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        navigate("/dashboard/billing/new");
      }
    };
    window.addEventListener("keydown", handler, { passive: false });
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  // Render a stripped-down nav for support staff — after all hooks
  if (isSupportStaff()) return <SupportNav />;

  return (
    <header
      role="banner"
      className="sticky top-0 z-50 flex items-center gap-2 px-4 flex-shrink-0"
      style={{
        height: "var(--nav-height, 52px)",
        background: "linear-gradient(135deg, #0a1a52 0%, #101e60 40%, #162870 100%)",
        boxShadow: "0 2px 20px 0 rgba(8,13,45,0.45), 0 1px 0 0 rgba(255,255,255,0.05) inset",
      }}
    >
      {/* Brand — pharmacy identity */}
      <Link
        to="/dashboard"
        className="flex items-center gap-2 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-lg p-0.5"
        aria-label={`${brand.pharmacyName} — dashboard`}
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center ring-1 ring-white/20 flex-shrink-0 bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 shadow-inner select-none">
          <span className="text-white font-black text-[10px] leading-none tracking-tight">{brand.pharmacyInitials}</span>
        </div>
        <p className="text-white font-extrabold text-[14px] tracking-tight leading-none hidden sm:block truncate max-w-[160px]">
          {brand.pharmacyName}
        </p>
      </Link>

      {/* Divider */}
      <div className="h-5 w-px bg-white/15 flex-shrink-0 mx-0.5" />

      {/* Nav tabs — desktop */}
      <nav role="tablist" aria-label="Main navigation" className="hidden xl:flex items-center gap-0.5">
        {NAV_TABS[0] && <NavItem tab={NAV_TABS[0]} pathname={pathname} />}
        <SalesNavDropdown pathname={pathname} />
        {NAV_TABS[1] && <NavItem tab={NAV_TABS[1]} pathname={pathname} />}
        <InventoryNavDropdown pathname={pathname} rawRole={rawRole} />
        <MoreNavDropdown pathname={pathname} />
        {(rawRole === "OWNER" || rawRole === "MANAGER") && (
          <NavItem tab={{ href: "/dashboard/reports", label: "Reports", icon: BarChart2 }} pathname={pathname} />
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Utilities — desktop */}
      <div className="hidden md:flex items-center gap-1.5">
        <NewBillBtn />

        <div className="h-5 w-px bg-white/15 mx-1" />

        <ShopLiveToggle />
        <CalendarPill />
        <GlobalSearchBar />

        <div className="h-5 w-px bg-white/15 mx-1" />

        <IconBtn icon={Truck}  label="Delivery status" />
        <NotificationBell />
        <IconBtn icon={Phone}  label="Support"         />

        <div className="h-5 w-px bg-white/15 mx-1" />

        <ProfileDropdown />
      </div>

      {/* Mobile */}
      <div className="flex items-center gap-1.5 md:hidden">
        <NotificationBell />
        <ProfileDropdown />
        <MobileMenu pathname={pathname} rawRole={rawRole} />
      </div>

      {/* Tablet */}
      <div className="hidden md:flex xl:hidden items-center gap-1.5">
        <NewBillBtn />
        <GlobalSearchBar />
        <ProfileDropdown />
        <MobileMenu pathname={pathname} rawRole={rawRole} />
      </div>
    </header>
  );
}
