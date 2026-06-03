import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import {
  Home, FileText, ShoppingCart, Package2, FlaskConical, Zap, Link2,
  Search, Phone, Truck, Calendar, ChevronDown, LogOut, Settings, Menu, X,
  Dot, QrCode, Coins, Send, Monitor, IndianRupee, Info, MapPin, Building2,
  Receipt, FilePlus, RotateCcw, BookmarkCheck, ClipboardList, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCalendarTodayCount } from "@/components/calendar/useCalendarEvents";

// ─── Types ────────────────────────────────────────────────────────
type NavTab = { href: string; label: string; icon: React.ElementType };

const NAV_TABS: NavTab[] = [
  { href: "/dashboard",           label: "Home",      icon: Home         },
  { href: "/dashboard/purchase",  label: "Purchase",  icon: ShoppingCart },
  { href: "/dashboard/medicines", label: "Medicines", icon: FlaskConical },
  { href: "/dashboard/ginni",     label: "Ginni",     icon: Zap          },
];

type InventoryItem = { href: string; label: string; description: string; icon: React.ElementType };
const INVENTORY_ITEMS: InventoryItem[] = [
  { href: "/dashboard/inventory",   label: "Inventory",   description: "Stock levels & batches", icon: Package2      },
  { href: "/dashboard/locations",   label: "Locations",   description: "Store shelf locations",  icon: MapPin        },
  { href: "/dashboard/stock-audit", label: "Stock Audit", description: "Audit & reconcile stock",icon: ClipboardList },
];

type SalesItem = {
  href:        string;
  label:       string;
  description: string;
  icon:        React.ElementType;
  kbd?:        string;
  iconBg:      string;
  iconColor:   string;
  hoverBg:     string;
  activeBg:    string;
  activeText:  string;
  accent:      string;
};
const SALES_ITEMS: SalesItem[] = [
  {
    href: "/dashboard/billing/new", label: "New Bill", description: "Create a new invoice",
    icon: FilePlus, kbd: "F2",
    iconBg: "bg-blue-600", iconColor: "text-white",
    hoverBg: "hover:bg-blue-50", activeBg: "bg-blue-50", activeText: "text-blue-700", accent: "bg-blue-500",
  },
  {
    href: "/dashboard/billing", label: "All Bills", description: "View and search invoices",
    icon: FileText,
    iconBg: "bg-slate-600", iconColor: "text-white",
    hoverBg: "hover:bg-slate-50", activeBg: "bg-slate-50", activeText: "text-slate-800", accent: "bg-slate-500",
  },
  {
    href: "/dashboard/billing/drafts", label: "Draft Bills", description: "Resume saved drafts",
    icon: BookmarkCheck,
    iconBg: "bg-amber-500", iconColor: "text-white",
    hoverBg: "hover:bg-amber-50", activeBg: "bg-amber-50", activeText: "text-amber-800", accent: "bg-amber-500",
  },
  {
    href: "/dashboard/billing/returns", label: "Returns", description: "Process sales returns",
    icon: RotateCcw,
    iconBg: "bg-rose-500", iconColor: "text-white",
    hoverBg: "hover:bg-rose-50", activeBg: "bg-rose-50", activeText: "text-rose-700", accent: "bg-rose-500",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────
function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname.startsWith(href);
}

// ─── NavItem ──────────────────────────────────────────────────────
function NavItem({ tab, pathname }: { tab: NavTab; pathname: string }) {
  const active = isActive(pathname, tab.href);
  const Icon = tab.icon;
  return (
    <Link
      to={tab.href}
      role="tab"
      aria-selected={active}
      className={cn(
        "relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
        "text-[12px] font-semibold transition-all duration-100 outline-none",
        "focus-visible:ring-2 focus-visible:ring-white/50",
        active ? "nav-pill-active text-brand-700" : "text-white/60 hover:text-white hover:bg-white/10"
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active-bg"
          className="absolute inset-0 rounded-lg bg-white"
          style={{ zIndex: -1 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      <Icon className={cn("w-3 h-3 flex-shrink-0", active ? "text-brand-600" : "text-white/55")} strokeWidth={active ? 2.3 : 1.9} aria-hidden />
      <span>{tab.label}</span>
    </Link>
  );
}

// ─── Shop Live Toggle ─────────────────────────────────────────────
function ShopLiveToggle() {
  const [on, setOn] = useState(true);
  return (
    <button
      onClick={() => setOn(v => !v)}
      aria-label={`Shop Live ${on ? "on" : "off"}`}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-white/8 hover:bg-white/14 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <div className={cn("relative h-4 w-7 rounded-full flex-shrink-0 transition-colors duration-200", on ? "bg-emerald-400" : "bg-white/20")}>
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 600, damping: 36 }}
          className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm", on ? "left-[14px]" : "left-0.5")}
        />
      </div>
      <div className="text-left leading-none">
        <p className="text-[11px] font-bold text-white leading-none">Shop Live</p>
        <p className={cn("text-[9px] mt-0.5 font-medium leading-none", on ? "text-emerald-300" : "text-white/40")}>
          {on ? "Online ON" : "Online OFF"}
        </p>
      </div>
    </button>
  );
}

// ─── Calendar Pill ────────────────────────────────────────────────
function CalendarPill() {
  const navigate  = useNavigate();
  const { data: count = 0 } = useCalendarTodayCount();

  return (
    <button
      onClick={() => navigate("/dashboard/calendar")}
      aria-label={`Calendar — ${count} event${count !== 1 ? "s" : ""} today`}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-white/8 hover:bg-white/14 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <div className="relative flex-shrink-0">
        <Calendar className="w-3.5 h-3.5 text-white/75" strokeWidth={1.8} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400 ring-[1.5px] ring-navy-900" />
        )}
      </div>
      <div className="text-left leading-none">
        <p className="text-[11px] font-bold text-white leading-none">Calendar</p>
        <p className="text-[9px] mt-0.5 font-medium text-white/50 leading-none">
          {count > 0 ? `${count} Today` : "No events"}
        </p>
      </div>
    </button>
  );
}

// ─── Global Search ────────────────────────────────────────────────
function GlobalSearchBar() {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className={cn(
      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 w-52 transition-all duration-150",
      focused ? "bg-white/18 ring-1 ring-white/30 shadow-md" : "bg-white/8 hover:bg-white/12"
    )}>
      <Search className="w-3 h-3 text-white/45 flex-shrink-0" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        aria-label="Global search"
        placeholder="Search medicine, customer…"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 min-w-0 bg-transparent text-[11px] text-white placeholder-white/30 focus:outline-none"
      />
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <kbd className="kbd-hint">Ctrl</kbd>
        <kbd className="kbd-hint">K</kbd>
      </div>
    </div>
  );
}

// ─── Icon Btn ─────────────────────────────────────────────────────
function IconBtn({ icon: Icon, label, badge }: { icon: React.ElementType; label: string; badge?: number }) {
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
}

// ─── New Bill Quick Button ─────────────────────────────────────────
function NewBillBtn() {
  const navigate = useNavigate();
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => navigate("/dashboard/billing/new")}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      style={{ background: "rgba(37,99,235,0.85)", color: "#fff", boxShadow: "0 1px 6px 0 rgba(37,99,235,0.35)" }}
      aria-label="New Bill (F2)"
    >
      <Plus className="w-3 h-3" strokeWidth={2.5} />
      New Bill
      <kbd className="kbd-hint ml-0.5">F2</kbd>
    </motion.button>
  );
}

// ─── Profile Dropdown ─────────────────────────────────────────────
const PHARMACY = { name: "Admin Pharmacy", city: "City", logoText: "CP", qrCode: "C48X8" };
const STAFF    = { initials: "CP", name: "-", role: "Pharmacist" };

type MenuItem = {
  id: string; icon: React.ElementType; label: string;
  extra?: string; extraType?: "blue" | "badge-new" | "coin"; href?: string;
};
const MENU_ITEMS: MenuItem[] = [
  { id: "settings",     icon: Settings,    label: "Account & Settings", href: "/dashboard/settings/pharmacy-profile" },
  { id: "integration",  icon: Link2,       label: "Integrations",       href: "/dashboard/integration"               },
  { id: "qr",           icon: QrCode,      label: "Show QR",       extra: PHARMACY.qrCode, extraType: "blue" },
  { id: "coins",        icon: Coins,       label: "VitalCoins",    extraType: "coin"    },
  { id: "refer",        icon: Send,        label: "Refer & Earn"                        },
  { id: "support",      icon: Monitor,     label: "Support Tickets", extra: "New", extraType: "badge-new" },
  { id: "zero",         icon: IndianRupee, label: "ZERO"                                },
  { id: "shortcuts",    icon: Info,        label: "Shortcuts / Help"                    },
];

function ProfileDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onOut = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Open profile menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 bg-white/10 hover:bg-white/16 rounded-lg pl-1.5 pr-2 py-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 flex items-center justify-center text-white text-[10px] font-extrabold shadow-inner select-none">
          {PHARMACY.logoText}
        </div>
        <div className="text-left leading-none hidden sm:block">
          <p className="text-[11px] font-bold text-white leading-none">{STAFF.name === "-" ? "Admin" : STAFF.name}</p>
          <p className="text-[9px] text-white/45 mt-0.5 leading-none truncate max-w-[80px]">{PHARMACY.name}</p>
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
                <div className="w-10 h-10 rounded-xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center mb-2.5 shadow-inner">
                  <Building2 className="w-5 h-5 text-white/80" strokeWidth={1.6} />
                </div>
                <p className="text-white font-bold text-[13px] leading-snug">{PHARMACY.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <MapPin className="w-2.5 h-2.5 text-blue-300/70 flex-shrink-0" strokeWidth={1.8} />
                  <p className="text-blue-200/60 text-[10px]">{PHARMACY.city}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <div className="w-8 h-8 rounded-full ring-2 ring-white/20 bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                  {STAFF.initials}
                </div>
                <div className="min-w-0">
                  <p className="text-white text-[11px] font-semibold truncate">{STAFF.role}</p>
                  <p className="text-white/40 text-[10px] truncate">{STAFF.name}</p>
                </div>
              </div>
            </div>

            {/* Right panel */}
            <div className="flex-1 bg-white py-1.5 flex flex-col">
              {MENU_ITEMS.map(({ id, icon: Icon, label, extra, extraType, href }) => (
                <button
                  key={id}
                  role="menuitem"
                  onClick={() => { setOpen(false); if (href) navigate(href); }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors outline-none group"
                >
                  <span className={cn(
                    "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
                    id === "coins"       ? "bg-amber-50   group-hover:bg-amber-100"  :
                    id === "qr"          ? "bg-blue-50    group-hover:bg-blue-100"   :
                    id === "refer"       ? "bg-sky-50     group-hover:bg-sky-100"    :
                    id === "zero"        ? "bg-green-50   group-hover:bg-green-100"  :
                    id === "integration" ? "bg-violet-50  group-hover:bg-violet-100" :
                                          "bg-slate-100  group-hover:bg-slate-200"
                  )}>
                    <Icon className={cn("w-3 h-3",
                      id === "coins"       ? "text-amber-500"  :
                      id === "qr"          ? "text-blue-600"   :
                      id === "refer"       ? "text-sky-500"    :
                      id === "zero"        ? "text-green-600"  :
                      id === "integration" ? "text-violet-600" : "text-slate-500"
                    )} strokeWidth={1.8} />
                  </span>
                  <span className="font-medium flex-1 text-left text-[12px]">{label}</span>
                  {extraType === "blue" && extra && (
                    <span className="text-blue-600 font-bold text-[11px]">{extra}</span>
                  )}
                  {extraType === "badge-new" && extra && (
                    <span className="bg-orange-100 text-orange-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{extra}</span>
                  )}
                </button>
              ))}
              <div className="mx-3 my-1 border-t border-slate-100" />
              <div className="flex items-center gap-2.5 px-3.5 py-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                  {STAFF.initials}
                </div>
                <div className="min-w-0">
                  <p className="text-slate-700 text-[11px] font-semibold truncate">{STAFF.name}</p>
                  <p className="text-slate-400 text-[10px] truncate">{STAFF.role}</p>
                </div>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  localStorage.removeItem("token");
                  document.cookie = "auth-token=; path=/; max-age=0; SameSite=Lax";
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
function SalesNavDropdown({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const salesActive = pathname.startsWith("/dashboard/billing");

  useEffect(() => {
    const onOut = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
          "text-[12px] font-semibold transition-all duration-100 outline-none",
          "focus-visible:ring-2 focus-visible:ring-white/50",
          salesActive ? "nav-pill-active text-brand-700" : "text-white/60 hover:text-white hover:bg-white/10"
        )}
      >
        {salesActive && (
          <motion.span
            layoutId="nav-active-bg"
            className="absolute inset-0 rounded-lg bg-white"
            style={{ zIndex: -1 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          />
        )}
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
            className="absolute left-0 top-full mt-1.5 w-64 rounded-2xl bg-white overflow-hidden z-50"
            style={{ boxShadow: "0 20px 48px -8px rgba(0,0,0,0.22), 0 4px 16px -4px rgba(0,0,0,0.10)", border: "1px solid rgba(226,232,240,0.8)" }}
          >
            {/* Header */}
            <div
              className="px-4 py-3 flex items-center justify-between"
              style={{ background: "linear-gradient(135deg,#0a1a52 0%,#162870 100%)" }}
            >
              <div className="flex items-center gap-2">
                <Receipt className="w-3.5 h-3.5 text-white/70" strokeWidth={1.8} />
                <span className="text-[12px] font-bold text-white tracking-wide">Sales</span>
              </div>
              <span className="text-[9px] font-semibold text-white/40 bg-white/10 px-1.5 py-0.5 rounded-md uppercase tracking-wider">Module</span>
            </div>

            {/* Items */}
            <div className="p-2 space-y-0.5">
              {SALES_ITEMS.map((item) => {
                const { href, label, description, icon: Icon, kbd,
                        iconBg, iconColor, hoverBg, activeBg, activeText, accent } = item;
                const active = href === "/dashboard/billing"
                  ? pathname === href
                  : pathname.startsWith(href);

                return (
                  <Link
                    key={href}
                    to={href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-100 group overflow-hidden",
                      active ? cn(activeBg, activeText) : cn("text-slate-700", hoverBg)
                    )}
                  >
                    {/* Left accent bar */}
                    {active && (
                      <motion.span
                        layoutId="sales-accent"
                        className={cn("absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full", accent)}
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    )}

                    {/* Icon tile */}
                    <span className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm transition-transform duration-100 group-hover:scale-105",
                      active ? iconBg : cn(iconBg, "opacity-80 group-hover:opacity-100")
                    )}>
                      <Icon className={cn("w-4 h-4", iconColor)} strokeWidth={2} />
                    </span>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-[13px] font-bold leading-tight",
                        active ? activeText : "text-slate-800"
                      )}>
                        {label}
                      </p>
                      <p className={cn(
                        "text-[11px] mt-0.5 leading-tight",
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
            <div className="mx-3 mb-2 px-3 py-2 bg-slate-50 rounded-xl flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-medium">Quick access</span>
              <Link
                to="/dashboard/billing"
                onClick={() => setOpen(false)}
                className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
              >
                View all →
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Inventory Nav Dropdown ───────────────────────────────────────
function InventoryNavDropdown({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inventoryActive =
    pathname.startsWith("/dashboard/inventory") ||
    pathname.startsWith("/dashboard/locations") ||
    pathname.startsWith("/dashboard/stock-audit");

  useEffect(() => {
    const onOut = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
          "text-[12px] font-semibold transition-all duration-100 outline-none",
          "focus-visible:ring-2 focus-visible:ring-white/50",
          inventoryActive ? "nav-pill-active text-brand-700" : "text-white/60 hover:text-white hover:bg-white/10"
        )}
      >
        {inventoryActive && (
          <motion.span
            layoutId="nav-active-bg"
            className="absolute inset-0 rounded-lg bg-white"
            style={{ zIndex: -1 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          />
        )}
        <Package2 className={cn("w-3 h-3 flex-shrink-0", inventoryActive ? "text-brand-600" : "text-white/55")} strokeWidth={inventoryActive ? 2.3 : 1.9} />
        <span>Inventory</span>
        <ChevronDown className={cn("w-2.5 h-2.5 transition-transform duration-200", open && "rotate-180", inventoryActive ? "text-brand-400" : "text-white/35")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.13, ease: "easeOut" }}
            className="absolute left-0 top-full mt-1.5 w-56 rounded-xl shadow-2xl border border-slate-200/70 bg-white overflow-hidden z-50"
            style={{ boxShadow: "0 16px 36px -6px rgba(0,0,0,0.18), 0 4px 12px -4px rgba(0,0,0,0.08)" }}
          >
            <div className="p-1.5">
              {INVENTORY_ITEMS.map(({ href, label, description, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    to={href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors",
                      active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <span className={cn("w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0", active ? "bg-blue-100" : "bg-slate-100")}>
                      <Icon className={cn("w-3 h-3", active ? "text-blue-600" : "text-slate-500")} strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-[12px] leading-none">{label}</p>
                      <p className={cn("text-[10px] mt-0.5", active ? "text-blue-500" : "text-slate-400")}>{description}</p>
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
}

// ─── Mobile Menu ──────────────────────────────────────────────────
function MobileMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const [salesExpanded, setSalesExpanded]       = useState(() => pathname.startsWith("/dashboard/billing"));
  const [inventoryExpanded, setInventoryExpanded] = useState(() =>
    pathname.startsWith("/dashboard/inventory") ||
    pathname.startsWith("/dashboard/locations") ||
    pathname.startsWith("/dashboard/stock-audit")
  );
  const isSalesActive     = pathname.startsWith("/dashboard/billing");
  const isInventoryActive =
    pathname.startsWith("/dashboard/inventory") ||
    pathname.startsWith("/dashboard/locations") ||
    pathname.startsWith("/dashboard/stock-audit");

  useEffect(() => {
    setOpen(false);
    if (pathname.startsWith("/dashboard/billing")) setSalesExpanded(true);
    if (isInventoryActive) setInventoryExpanded(true);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
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
                <div className="w-8 h-8 rounded-lg bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
                  <span className="text-white font-black text-lg leading-none">+</span>
                </div>
                <div>
                  <p className="text-white font-bold text-[13px]">Checkup</p>
                  <p className="text-blue-200 text-[9px] font-medium uppercase tracking-wider">Pharmacy</p>
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
                          {INVENTORY_ITEMS.map(({ href, label, icon: Icon }) => {
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

                {/* Remaining flat tabs: Purchase, Medicines, Ginni */}
                {NAV_TABS.slice(1).map((tab) => {
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
                })}
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── TopNav — main export ─────────────────────────────────────────
export function TopNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // F2 = New Bill (global shortcut)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        navigate("/dashboard/billing/new");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

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
        to="/dashboard"
        className="flex items-center gap-2 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-lg p-0.5"
        aria-label="Checkup Pharmacy — dashboard"
      >
        <motion.div
          whileHover={{ rotate: [0, -8, 8, 0], scale: 1.06 }}
          transition={{ duration: 0.35 }}
          className="w-7 h-7 rounded-lg flex items-center justify-center ring-1 ring-white/20 shadow-inner flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.13)" }}
        >
          <span className="text-white font-black text-base leading-none select-none">+</span>
        </motion.div>
        <div className="leading-none hidden sm:block">
          <p className="text-white font-extrabold text-[13px] tracking-tight leading-none">Checkup</p>
          <p className="text-blue-200/75 text-[8px] font-semibold tracking-[0.18em] uppercase mt-0.5 leading-none">Pharmacy</p>
        </div>
      </Link>

      {/* Divider */}
      <div className="h-5 w-px bg-white/12 flex-shrink-0 mx-0.5" />

      {/* Nav tabs — desktop */}
      <nav role="tablist" aria-label="Main navigation" className="hidden xl:flex items-center gap-0.5">
        {NAV_TABS[0] && <NavItem tab={NAV_TABS[0]} pathname={pathname} />}
        <SalesNavDropdown pathname={pathname} />
        {/* Purchase tab */}
        {NAV_TABS[1] && <NavItem tab={NAV_TABS[1]} pathname={pathname} />}
        {/* Inventory dropdown — Inventory, Locations, Stock Audit */}
        <InventoryNavDropdown pathname={pathname} />
        {/* Remaining tabs: Medicines, Ginni */}
        {NAV_TABS.slice(2).map(tab => (
          <NavItem key={tab.href} tab={tab} pathname={pathname} />
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Utilities — desktop */}
      <div className="hidden md:flex items-center gap-1.5">
        <NewBillBtn />

        <div className="h-5 w-px bg-white/10 mx-0.5" />

        <ShopLiveToggle />
        <CalendarPill />
        <GlobalSearchBar />

        <div className="h-5 w-px bg-white/10 mx-0.5" />

        <IconBtn icon={Truck}  label="Delivery status" />
        <NotificationBell />
        <IconBtn icon={Phone}  label="Support"         />

        <div className="h-5 w-px bg-white/10 mx-0.5" />

        <ProfileDropdown />
      </div>

      {/* Mobile */}
      <div className="flex items-center gap-1.5 md:hidden">
        <NotificationBell />
        <ProfileDropdown />
        <MobileMenu pathname={pathname} />
      </div>

      {/* Tablet */}
      <div className="hidden md:flex xl:hidden items-center gap-1.5">
        <NewBillBtn />
        <GlobalSearchBar />
        <ProfileDropdown />
        <MobileMenu pathname={pathname} />
      </div>
    </header>
  );
}
