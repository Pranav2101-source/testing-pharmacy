"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  FileText,
  ShoppingCart,
  Package2,
  Zap,
  Link2,
  Search,
  Bell,
  Phone,
  Truck,
  Calendar,
  ChevronDown,
  LogOut,
  Settings,
  Menu,
  X,
  Dot,
  QrCode,
  Coins,
  Send,
  Monitor,
  IndianRupee,
  Info,
  MapPin,
  Building2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type NavTab = {
  href: string;
  label: string;
  icon: React.ElementType;
};

// ─────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────
const NAV_TABS: NavTab[] = [
  { href: "/dashboard",             label: "Home",        icon: Home         },
  { href: "/dashboard/billing",     label: "Bill",        icon: FileText     },
  { href: "/dashboard/purchase",    label: "Purchase",    icon: ShoppingCart },
  { href: "/dashboard/inventory",   label: "Inventory",   icon: Package2     },
  { href: "/dashboard/ginni",       label: "Ginni",       icon: Zap          },
  { href: "/dashboard/integration", label: "Integration", icon: Link2        },
];

// ─────────────────────────────────────────────────────────────
// Utility: is tab active?
// ─────────────────────────────────────────────────────────────
function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname.startsWith(href);
}

// ─────────────────────────────────────────────────────────────
// NavItem — reusable, accessible, animated
// ─────────────────────────────────────────────────────────────
function NavItem({ tab, pathname }: { tab: NavTab; pathname: string }) {
  const active = isActive(pathname, tab.href);
  const Icon = tab.icon;

  return (
    <Link
      href={tab.href}
      role="tab"
      aria-selected={active}
      className={cn(
        "relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl",
        "text-xs font-semibold transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent",
        active
          ? "text-brand-700 bg-white shadow-sm"
          : "text-white/65 hover:text-white"
      )}
    >
      {/* Hover bg */}
      {!active && (
        <motion.span
          className="absolute inset-0 rounded-xl bg-white/10"
          initial={false}
          whileHover={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        />
      )}

      <Icon
        className={cn("w-3.5 h-3.5 flex-shrink-0", active ? "text-brand-600" : "text-white/60")}
        strokeWidth={active ? 2.2 : 1.8}
        aria-hidden="true"
      />
      <span>{tab.label}</span>

      {/* Active indicator dot */}
      {active && (
        <motion.span
          layoutId="nav-dot"
          className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-500"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// Shop Live Toggle
// ─────────────────────────────────────────────────────────────
function ShopLiveToggle() {
  const [on, setOn] = useState(true);

  return (
    <button
      onClick={() => setOn((v) => !v)}
      aria-label={`Shop Live ${on ? "on" : "off"}`}
      aria-pressed={on}
      className="flex items-center gap-2 rounded-xl px-3 py-2 bg-white/8 hover:bg-white/14 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      {/* Toggle track */}
      <motion.div
        className={cn(
          "relative h-5 w-9 rounded-full flex-shrink-0 transition-colors duration-200",
          on ? "bg-emerald-400" : "bg-white/20"
        )}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 600, damping: 35 }}
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm",
            on ? "left-[18px]" : "left-0.5"
          )}
        />
      </motion.div>

      <div className="text-left leading-none">
        <p className="text-[11px] font-bold text-white">Shop Live</p>
        <p className={cn("text-[10px] mt-0.5 font-medium", on ? "text-emerald-300" : "text-white/40")}>
          Online Orders {on ? "ON" : "OFF"}
        </p>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Calendar Pill
// ─────────────────────────────────────────────────────────────
function CalendarPill() {
  return (
    <button
      aria-label="Calendar — 3 events today"
      className="flex items-center gap-2 rounded-xl px-3 py-2 bg-white/8 hover:bg-white/14 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <div className="relative flex-shrink-0">
        <Calendar className="w-4 h-4 text-white/80" strokeWidth={1.8} aria-hidden />
        <span
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-400 shadow ring-[1.5px] ring-navy-900"
          aria-hidden
        />
      </div>
      <div className="text-left leading-none">
        <p className="text-[11px] font-bold text-white">Calendar</p>
        <p className="text-[10px] mt-0.5 font-medium text-white/50">3 Events Today</p>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Global Search Bar
// ─────────────────────────────────────────────────────────────
function GlobalSearchBar() {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl + K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <motion.div
      animate={focused ? { scale: 1.02 } : { scale: 1 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 w-60 transition-all duration-200",
        focused
          ? "bg-white/18 ring-1 ring-white/35 shadow-lg"
          : "bg-white/8 hover:bg-white/12"
      )}
    >
      <Search className="w-3.5 h-3.5 text-white/50 flex-shrink-0" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        aria-label="Global search"
        placeholder="Search medicine, customer..."
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 min-w-0 bg-transparent text-[11px] text-white placeholder-white/35 focus:outline-none"
      />
      <div className="flex items-center gap-0.5 flex-shrink-0" aria-label="Keyboard shortcut: Ctrl K">
        <kbd className="text-[9px] text-white/35 bg-white/10 rounded px-1 py-0.5 font-mono leading-none">Ctrl</kbd>
        <kbd className="text-[9px] text-white/35 bg-white/10 rounded px-1 py-0.5 font-mono leading-none">K</kbd>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// Icon Button
// ─────────────────────────────────────────────────────────────
function IconBtn({
  icon: Icon,
  label,
  badge,
}: {
  icon: React.ElementType;
  label: string;
  badge?: number;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      aria-label={label}
      className="relative w-9 h-9 rounded-xl bg-white/8 hover:bg-white/16 flex items-center justify-center transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      <Icon className="w-4 h-4 text-white/75" strokeWidth={1.8} aria-hidden />
      {badge != null && badge > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 ring-[1.5px] ring-navy-900"
          aria-label={`${badge} notifications`}
        >
          {badge > 99 ? "99+" : badge}
        </motion.span>
      )}
    </motion.button>
  );
}

// ─────────────────────────────────────────────────────────────
// Pharmacy Profile Dropdown
// ─────────────────────────────────────────────────────────────

// Static placeholder data — wire up to API/store when ready
const PHARMACY = {
  name:     "Admin Pharmacy",
  city:     "City",
  logoText: "CP",
  qrCode:   "C48X8",
};

const STAFF = {
  initials: "CP",
  name:     "-",
  role:     "Pharmacist",
};

type MenuItem = {
  id:         string;
  icon:       React.ElementType;
  label:      string;
  extra?:     string;
  extraType?: "blue" | "badge-new" | "coin";
  danger?:    boolean;
  href?:      string;
};

const MENU_ITEMS: MenuItem[] = [
  { id: "settings",  icon: Settings,    label: "Account & Settings", href: "/dashboard/settings/pharmacy-profile" },
  { id: "qr",        icon: QrCode,      label: "Show QR",       extra: PHARMACY.qrCode, extraType: "blue" },
  { id: "coins",     icon: Coins,       label: "VitalCoins",    extraType: "coin"                         },
  { id: "refer",     icon: Send,        label: "Refer & Earn"                                             },
  { id: "support",   icon: Monitor,     label: "Support Tickets", extra: "New", extraType: "badge-new"   },
  { id: "zero",      icon: IndianRupee, label: "ZERO"                                                     },
  { id: "shortcuts", icon: Info,        label: "Shortcut / Help"                                          },
];

function ProfileDropdown() {
  const [open, setOpen] = useState(false);
  const ref  = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className="relative">

      {/* ── Trigger button ─────────────────────────────────────── */}
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Open pharmacy profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 bg-white/10 hover:bg-white/16 rounded-xl pl-2 pr-2.5 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 flex items-center justify-center text-white text-[11px] font-extrabold shadow-inner select-none">
          {PHARMACY.logoText}
        </div>
        <div className="text-left leading-none hidden sm:block">
          <p className="text-[11px] font-bold text-white">{STAFF.name === "-" ? "Admin" : STAFF.name}</p>
          <p className="text-[9px] text-white/45 mt-0.5">{PHARMACY.name}</p>
        </div>
        <ChevronDown
          className={cn("w-3 h-3 text-white/45 transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </motion.button>

      {/* ── Dropdown panel ────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,   scale: 1    }}
            exit={  { opacity: 0, y: -10, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute right-0 top-full mt-2.5 w-[400px] rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden z-50 flex"
            style={{ boxShadow: "0 20px 60px -10px rgba(0,0,0,0.25), 0 4px 16px -4px rgba(0,0,0,0.12)" }}
          >

            {/* ── LEFT PANEL — pharmacy info ─────────────────── */}
            <div
              className="w-[42%] flex flex-col justify-between p-5 relative overflow-hidden"
              style={{ background: "linear-gradient(160deg, #0c1f5c 0%, #132468 55%, #1a3080 100%)" }}
            >
              {/* Decorative circles */}
              <span className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/5 pointer-events-none" />
              <span className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />

              {/* Pharmacy logo placeholder */}
              <div>
                <div className="w-12 h-12 rounded-xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center mb-3 shadow-inner">
                  <Building2 className="w-6 h-6 text-white/80" strokeWidth={1.6} />
                </div>
                <p className="text-white font-bold text-sm leading-snug">{PHARMACY.name}</p>
                <div className="flex items-center gap-1 mt-1">
                  <MapPin className="w-3 h-3 text-blue-300/70 flex-shrink-0" strokeWidth={1.8} />
                  <p className="text-blue-200/60 text-[11px]">{PHARMACY.city}</p>
                </div>
              </div>

              {/* Staff row at bottom */}
              <div className="flex items-center gap-2.5 mt-6">
                <div className="w-9 h-9 rounded-full ring-2 ring-white/20 bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 select-none">
                  {STAFF.initials}
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{STAFF.role}</p>
                  <p className="text-white/40 text-[10px] truncate">{STAFF.name}</p>
                </div>
              </div>
            </div>

            {/* ── RIGHT PANEL — menu items ──────────────────── */}
            <div className="flex-1 bg-white py-2 flex flex-col">

              {MENU_ITEMS.map(({ id, icon: Icon, label, extra, extraType, href }) => (
                <button
                  key={id}
                  role="menuitem"
                  onClick={() => { setOpen(false); if (href) router.push(href); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors outline-none focus-visible:bg-slate-50 group"
                >
                  {/* Icon */}
                  <span className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                    id === "coins"    ? "bg-amber-50  group-hover:bg-amber-100"  :
                    id === "qr"       ? "bg-blue-50   group-hover:bg-blue-100"   :
                    id === "refer"    ? "bg-sky-50    group-hover:bg-sky-100"    :
                    id === "support"  ? "bg-slate-100 group-hover:bg-slate-200"  :
                    id === "zero"     ? "bg-green-50  group-hover:bg-green-100"  :
                    id === "settings" ? "bg-slate-100 group-hover:bg-slate-200"  :
                                       "bg-slate-100 group-hover:bg-slate-200"
                  )}>
                    <Icon
                      className={cn(
                        "w-3.5 h-3.5",
                        id === "coins"   ? "text-amber-500"  :
                        id === "qr"      ? "text-blue-600"   :
                        id === "refer"   ? "text-sky-500"    :
                        id === "zero"    ? "text-green-600"  :
                                          "text-slate-500"
                      )}
                      strokeWidth={1.8}
                    />
                  </span>

                  <span className="font-medium flex-1 text-left">{label}</span>

                  {/* Extras */}
                  {extraType === "blue" && extra && (
                    <span className="text-blue-600 font-bold text-[11px] tracking-wide">{extra}</span>
                  )}
                  {extraType === "badge-new" && extra && (
                    <span className="bg-orange-100 text-orange-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {extra}
                    </span>
                  )}
                </button>
              ))}

              {/* Divider */}
              <div className="mx-3 my-1.5 border-t border-slate-100" />

              {/* Staff identity row */}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 select-none">
                  {STAFF.initials}
                </div>
                <div className="min-w-0">
                  <p className="text-slate-700 text-xs font-semibold truncate">{STAFF.name}</p>
                  <p className="text-slate-400 text-[10px] truncate">{STAFF.role}</p>
                </div>
              </div>

              {/* Logout */}
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  localStorage.removeItem("token");
                  document.cookie = "auth-token=; path=/; max-age=0; SameSite=Lax";
                  router.push("/login");
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors outline-none focus-visible:bg-red-50 group"
              >
                <span className="w-7 h-7 rounded-lg bg-red-50 group-hover:bg-red-100 flex items-center justify-center flex-shrink-0 transition-colors">
                  <LogOut className="w-3.5 h-3.5 text-red-400" strokeWidth={1.8} />
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

// ─────────────────────────────────────────────────────────────
// Mobile Menu Drawer
// ─────────────────────────────────────────────────────────────
function MobileMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);

  // close on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // trap focus / escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation menu"
        aria-expanded={open}
        className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/10 text-white xl:hidden"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? "x" : "menu"}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      {/* Overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm xl:hidden"
              aria-hidden
            />
            <motion.nav
              role="dialog"
              aria-label="Navigation menu"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed left-0 top-0 z-50 h-full w-64 bg-gradient-to-b from-navy-900 to-navy-800 shadow-2xl xl:hidden flex flex-col"
            >
              {/* Drawer header */}
              <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
                <div className="w-9 h-9 rounded-xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
                  <span className="text-white font-black text-xl leading-none">+</span>
                </div>
                <div>
                  <p className="text-white font-bold text-sm">Checkup</p>
                  <p className="text-blue-200 text-[10px] font-medium">Pharmacy</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="ml-auto w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-white/60 hover:text-white"
                  aria-label="Close menu"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex flex-col gap-1 p-3 flex-1 overflow-y-auto">
                {NAV_TABS.map((tab) => {
                  const active = isActive(pathname, tab.href);
                  const Icon = tab.icon;
                  return (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all",
                        active
                          ? "bg-white text-brand-700"
                          : "text-white/65 hover:text-white hover:bg-white/10"
                      )}
                    >
                      <Icon className={cn("w-4 h-4", active ? "text-brand-600" : "text-white/50")} strokeWidth={1.8} />
                      {tab.label}
                      {active && <Dot className="ml-auto w-4 h-4 text-brand-500" />}
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

// ─────────────────────────────────────────────────────────────
// TopNav — main export
// ─────────────────────────────────────────────────────────────
export function TopNav() {
  const pathname = usePathname();

  return (
    <header
      role="banner"
      className="sticky top-0 z-50 flex items-center gap-3 px-5 flex-shrink-0"
      style={{
        height: "72px",
        background: "linear-gradient(135deg, #0c1f5c 0%, #132468 40%, #1a3080 100%)",
        boxShadow: "0 4px 28px 0 rgba(9,15,51,0.40), 0 1px 0 0 rgba(255,255,255,0.06) inset",
      }}
    >
      {/* ── Brand ─────────────────────────────── */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-xl p-1"
        aria-label="Checkup Pharmacy — go to dashboard"
      >
        <motion.div
          whileHover={{ rotate: [0, -8, 8, 0], scale: 1.05 }}
          transition={{ duration: 0.4 }}
          className="w-9 h-9 rounded-xl flex items-center justify-center ring-1 ring-white/20 shadow-inner"
          style={{ background: "rgba(255,255,255,0.12)" }}
        >
          <span className="text-white font-black text-xl leading-none select-none">+</span>
        </motion.div>
        <div className="leading-none">
          <p className="text-white font-extrabold text-sm tracking-tight">Checkup</p>
          <p className="text-blue-200/80 text-[10px] font-semibold tracking-widest uppercase mt-0.5">
            Pharmacy
          </p>
        </div>
      </Link>

      {/* Divider */}
      <div className="h-7 w-px bg-white/10 flex-shrink-0 mx-1" />

      {/* ── Nav tabs — desktop ─────────────────── */}
      <nav
        role="tablist"
        aria-label="Main navigation"
        className="hidden xl:flex items-center gap-0.5"
      >
        {NAV_TABS.map((tab) => (
          <NavItem key={tab.href} tab={tab} pathname={pathname} />
        ))}
      </nav>

      {/* ── Spacer ─────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Utilities — desktop ─────────────────── */}
      <div className="hidden md:flex items-center gap-2">
        <ShopLiveToggle />
        <CalendarPill />
        <GlobalSearchBar />

        {/* Thin divider */}
        <div className="h-6 w-px bg-white/10 mx-1" />

        <IconBtn icon={Truck}  label="Delivery status" />
        <IconBtn icon={Bell}   label="Notifications"   badge={5} />
        <IconBtn icon={Phone}  label="Support"         />

        <div className="h-6 w-px bg-white/10 mx-1" />

        <ProfileDropdown />
      </div>

      {/* ── Mobile: icons + hamburger ──────────── */}
      <div className="flex items-center gap-2 md:hidden">
        <IconBtn icon={Bell} label="Notifications" badge={5} />
        <ProfileDropdown />
        <MobileMenu pathname={pathname} />
      </div>

      {/* ── Tablet: search + hamburger ────────── */}
      <div className="hidden md:flex xl:hidden items-center gap-2">
        <GlobalSearchBar />
        <ProfileDropdown />
        <MobileMenu pathname={pathname} />
      </div>
    </header>
  );
}
