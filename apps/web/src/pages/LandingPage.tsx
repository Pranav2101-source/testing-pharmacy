

import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useInView } from "framer-motion";
import {
  FileText, Package2, ShoppingCart, Users, BarChart3, Zap,
  CheckCircle2, ArrowRight, Star, ChevronLeft, ChevronRight,
  Shield, TrendingUp, IndianRupee, Smartphone, Play,
  Menu, X, Sparkles, Building2, Bell,
  Receipt, Lock, Globe, PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Utility hook: animated counter ──────────────────────────
function useCounter(target: number, duration = 1800, trigger = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    const start = performance.now();
    const step = (ts: number) => {
      const p = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(ease * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, trigger]);
  return value;
}

// ─── Utility hook: navbar scroll ─────────────────────────────
function useScrolled(threshold = 30) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

// ─── Animation variants ───────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};
const stagger = (delay = 0.07) => ({
  show: { transition: { staggerChildren: delay } },
});

// ═══════════════════════════════════════════════════════════════
// NAVBAR
// ═══════════════════════════════════════════════════════════════
function Navbar() {
  const scrolled = useScrolled();
  const [open, setOpen]   = useState(false);

  const links = [
    { label: "Features",     href: "#features"     },
    { label: "How it works", href: "#how-it-works"  },
    { label: "Pricing",      href: "#pricing"       },
    { label: "Integrations", href: "#integrations"  },
  ];

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0,   opacity: 1  }}
      transition={{ duration: 0.4 }}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-white/90 backdrop-blur-xl border-b border-slate-200/70 shadow-sm"
          : "bg-transparent"
      )}
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 flex items-center h-16 gap-6">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
            style={{ background: "linear-gradient(135deg,#0c1f5c,#1a3080)" }}
          >
            <span className="text-white font-black text-lg leading-none">+</span>
          </div>
          <div className="leading-none">
            <p className={cn("font-extrabold text-sm", scrolled ? "text-slate-800" : "text-white")}>Checkup</p>
            <p className={cn("text-[9px] font-semibold tracking-widest uppercase mt-0.5", scrolled ? "text-slate-400" : "text-blue-200/70")}>
              Pharmacy
            </p>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {links.map(l => (
            <a
              key={l.href}
              href={l.href}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors",
                scrolled
                  ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              )}
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-2.5 flex-shrink-0">
          <Link
            to="/login"
            className={cn(
              "text-sm font-semibold transition-colors px-3 py-1.5",
              scrolled ? "text-slate-600 hover:text-slate-900" : "text-white/80 hover:text-white"
            )}
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors shadow-sm"
          >
            Start Free <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setOpen(v => !v)}
          className={cn("ml-auto md:hidden w-9 h-9 rounded-xl flex items-center justify-center",
            scrolled ? "text-slate-600 bg-slate-100" : "text-white bg-white/10"
          )}
          aria-label="Toggle menu"
        >
          {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden bg-white border-b border-slate-200 overflow-hidden"
          >
            <div className="px-5 py-4 flex flex-col gap-1">
              {links.map(l => (
                <a key={l.href} href={l.href} onClick={() => setOpen(false)}
                  className="px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  {l.label}
                </a>
              ))}
              <div className="flex gap-2 mt-3">
                <Link to="/login" className="flex-1 text-center py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">
                  Sign in
                </Link>
                <Link to="/register" className="flex-1 text-center py-2.5 rounded-xl bg-brand-600 text-white text-sm font-bold">
                  Start Free
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}

// ═══════════════════════════════════════════════════════════════
// HERO
// ═══════════════════════════════════════════════════════════════
const HERO_WORDS = ["Smarter", "Faster", "Compliant"];

function DashboardMockup() {
  return (
    <div className="w-full rounded-2xl overflow-hidden shadow-2xl border border-white/10 text-[10px] font-sans select-none"
      style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(2px)" }}
    >
      {/* Nav bar */}
      <div className="h-9 flex items-center gap-2 px-3" style={{ background: "linear-gradient(90deg,#0c1f5c,#1a3080)" }}>
        <div className="w-5 h-5 rounded bg-white/15 flex items-center justify-center">
          <span className="text-white font-black text-xs">+</span>
        </div>
        {["Bill","Purchase","Inventory","Ginni"].map(t => (
          <span key={t} className={cn("px-2 py-0.5 rounded text-[9px] font-semibold",
            t === "Bill" ? "bg-white text-brand-700" : "text-white/50"
          )}>{t}</span>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-[8px] font-bold">CP</div>
        </div>
      </div>

      {/* Content area */}
      <div className="bg-slate-50 p-3 space-y-2.5">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-black text-slate-800">New Bill</p>
          <div className="flex items-center gap-1">
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold">Bill #1049</span>
          </div>
        </div>

        {/* Patient + Doctor row */}
        <div className="grid grid-cols-2 gap-2">
          {[["Patient", "Ramesh Kumar"], ["Doctor", "Dr. Mehta"]].map(([label, val]) => (
            <div key={label} className="bg-white rounded-lg border border-slate-200 px-2 py-1.5">
              <p className="text-[8px] text-slate-400 font-semibold">{label}</p>
              <p className="text-[10px] text-slate-800 font-semibold mt-0.5">{val}</p>
            </div>
          ))}
        </div>

        {/* Medicine table */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-2 py-1 bg-slate-50 border-b border-slate-100">
            {["Medicine","Qty","MRP","Amount"].map(h => (
              <span key={h} className="text-[8px] text-slate-400 font-bold uppercase">{h}</span>
            ))}
          </div>
          {[
            ["Calpol 500mg", "2 strips", "₹42.00", "₹84.00"],
            ["Azee 500mg",   "1 strip",  "₹98.00", "₹98.00"],
            ["Omez 20mg",    "3 caps",   "₹12.00", "₹36.00"],
          ].map(([med, qty, mrp, amt]) => (
            <div key={med} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-2 py-1 border-b border-slate-50 last:border-0">
              <span className="text-[9px] text-slate-700 font-medium truncate">{med}</span>
              <span className="text-[9px] text-slate-500">{qty}</span>
              <span className="text-[9px] text-slate-500">{mrp}</span>
              <span className="text-[9px] text-slate-700 font-semibold">{amt}</span>
            </div>
          ))}
        </div>

        {/* GST + Total */}
        <div className="bg-white rounded-lg border border-slate-200 px-2 py-2 space-y-1">
          {[["Subtotal","₹218.00"],["CGST (9%)","₹19.62"],["SGST (9%)","₹19.62"]].map(([k,v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-[9px] text-slate-400">{k}</span>
              <span className="text-[9px] text-slate-600">{v}</span>
            </div>
          ))}
          <div className="flex justify-between pt-1 border-t border-slate-100">
            <span className="text-[10px] font-black text-slate-800">Total</span>
            <span className="text-[10px] font-black text-brand-600">₹257.24</span>
          </div>
        </div>

        {/* Generate button */}
        <div className="bg-emerald-500 rounded-lg px-2 py-1.5 text-center">
          <span className="text-[10px] text-white font-bold">Generate GST Bill ✓</span>
        </div>
      </div>
    </div>
  );
}

function HeroSection() {
  const [wordIdx, setWordIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setWordIdx(i => (i + 1) % HERO_WORDS.length), 2800);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background image + overlay */}
      <div className="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1920&q=80"
          alt=""
          className="w-full h-full object-cover object-center"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(9,15,51,0.96) 0%, rgba(12,31,92,0.94) 50%, rgba(26,48,128,0.90) 100%)" }} />
      </div>

      {/* Decorative orbs */}
      <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl opacity-10 pointer-events-none" style={{ background: "radial-gradient(circle, #3b82f6, transparent)" }} />
      <div className="absolute bottom-1/4 left-1/6 w-64 h-64 rounded-full blur-3xl opacity-8 pointer-events-none" style={{ background: "radial-gradient(circle, #60a5fa, transparent)" }} />

      <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 pt-28 pb-16 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">

          {/* Left — Text */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={stagger(0.1)}
          >
            {/* Badge */}
            <motion.div variants={fadeUp} className="mb-6">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/8 backdrop-blur-sm text-sm text-white/80 font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
                Trusted by 500+ pharmacies across India
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-5xl xl:text-6xl font-black text-white leading-[1.1] mb-5">
              Make Your Pharmacy
              <br />
              <span className="relative">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={wordIdx}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0,  opacity: 1 }}
                    exit={{   y: -20, opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
                    className="inline-block text-transparent bg-clip-text"
                    style={{ backgroundImage: "linear-gradient(90deg, #60a5fa, #818cf8, #a78bfa)" }}
                  >
                    {HERO_WORDS[wordIdx]}
                  </motion.span>
                </AnimatePresence>
              </span>
            </motion.h1>

            <motion.p variants={fadeUp} className="text-lg text-white/60 leading-relaxed mb-8 max-w-lg">
              GST-compliant billing, real-time inventory, staff management, and AI insights — all in one platform built for Indian pharmacies.
            </motion.p>

            {/* CTAs */}
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3 mb-10">
              <Link
                to="/register"
                className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-base transition-all shadow-lg shadow-brand-900/40 hover:shadow-brand-600/40 hover:scale-[1.02]"
              >
                Start Free Trial <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#showcase"
                className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-white/20 bg-white/8 hover:bg-white/14 text-white font-bold text-base transition-all backdrop-blur-sm"
              >
                <Play className="w-4 h-4 text-white/70" />
                See it in action
              </a>
            </motion.div>

            {/* Trust points */}
            <motion.div variants={fadeUp} className="flex flex-wrap gap-4">
              {["No credit card required", "Free 30-day trial", "Cancel anytime"].map(t => (
                <span key={t} className="flex items-center gap-1.5 text-sm text-white/50">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" strokeWidth={2.5} />
                  {t}
                </span>
              ))}
            </motion.div>
          </motion.div>

          {/* Right — Dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, x: 40, y: 10 }}
            animate={{ opacity: 1, x: 0,  y: 0  }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
            className="relative hidden lg:block"
          >
            {/* Glow behind mockup */}
            <div className="absolute inset-8 rounded-3xl blur-2xl opacity-25" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }} />
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="relative"
            >
              <DashboardMockup />
            </motion.div>

            {/* Floating badges */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8 }}
              className="absolute -left-10 top-1/3 bg-white rounded-2xl shadow-xl border border-slate-100 px-4 py-2.5 flex items-center gap-2.5"
            >
              <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" strokeWidth={2} />
              </div>
              <div>
                <p className="text-xs font-black text-slate-800">GST Compliant</p>
                <p className="text-[10px] text-slate-400">Auto CGST + SGST</p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.0 }}
              className="absolute -right-6 bottom-1/4 bg-white rounded-2xl shadow-xl border border-slate-100 px-4 py-2.5 flex items-center gap-2.5"
            >
              <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-brand-600" strokeWidth={2} />
              </div>
              <div>
                <p className="text-xs font-black text-slate-800">₹18,430</p>
                <p className="text-[10px] text-slate-400">Today's revenue</p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        animate={{ y: [0, 6, 0] }}
        transition={{ duration: 1.8, repeat: Infinity }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-white/30"
      >
        <span className="text-[10px] font-semibold tracking-widest uppercase">Scroll</span>
        <div className="w-px h-8 bg-gradient-to-b from-white/30 to-transparent" />
      </motion.div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATS BAR
// ═══════════════════════════════════════════════════════════════
const STATS = [
  { label: "Pharmacies",      value: 500,    suffix: "+",    icon: Building2    },
  { label: "Bills Generated", value: 2000000,suffix: "+",    icon: Receipt      },
  { label: "Indian States",   value: 28,     suffix: "",     icon: Globe        },
  { label: "Uptime",          value: 99,     suffix: ".9%",  icon: Shield       },
];

function formatStat(v: number, suffix: string) {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M${suffix}`;
  if (v >= 1000)    return `${(v / 1000).toFixed(0)}k${suffix}`;
  return `${v}${suffix}`;
}

function StatsSection() {
  const ref  = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });
  const c0 = useCounter(STATS[0]!.value, 1600, inView);
  const c1 = useCounter(STATS[1]!.value, 2000, inView);
  const c2 = useCounter(STATS[2]!.value, 1200, inView);
  const c3 = useCounter(STATS[3]!.value, 1400, inView);
  const counts = [c0, c1, c2, c3];

  return (
    <section ref={ref} className="bg-white border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {STATS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                className="flex flex-col items-center text-center"
              >
                <div className="w-11 h-11 rounded-2xl bg-brand-50 flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5 text-brand-600" strokeWidth={1.8} />
                </div>
                <p className="text-3xl font-black text-slate-800 tabnum">
                  {formatStat(counts[i] ?? 0, s.suffix)}
                </p>
                <p className="text-sm text-slate-500 font-medium mt-0.5">{s.label}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// FEATURES
// ═══════════════════════════════════════════════════════════════
const FEATURES = [
  {
    icon:  FileText,
    color: "bg-blue-50 text-blue-600",
    title: "Fast GST Billing",
    desc:  "Generate fully GST-compliant bills in under 30 seconds. Auto-calculates CGST, SGST, and HSN codes for every item.",
    tag:   "Most used",
  },
  {
    icon:  Package2,
    color: "bg-emerald-50 text-emerald-600",
    title: "Real-time Inventory",
    desc:  "Track stock levels, get low-stock alerts before you run out, and manage expiry dates with automated reminders.",
    tag:   null,
  },
  {
    icon:  ShoppingCart,
    color: "bg-amber-50 text-amber-600",
    title: "Purchase Orders",
    desc:  "Place, track, and receive supplier orders in one place. Compare prices and maintain full procurement history.",
    tag:   null,
  },
  {
    icon:  Users,
    color: "bg-purple-50 text-purple-600",
    title: "Staff Management",
    desc:  "Add pharmacists, assign roles, and control who can access billing, inventory, or reports with granular permissions.",
    tag:   null,
  },
  {
    icon:  BarChart3,
    color: "bg-rose-50 text-rose-600",
    title: "Reports & Insights",
    desc:  "Daily sales summaries, top medicines, GST reports, and customer analytics — downloadable with one click.",
    tag:   null,
  },
  {
    icon:  Zap,
    color: "bg-violet-50 text-violet-600",
    title: "Ginni AI",
    desc:  "Ask natural language questions about your business. Ginni gives instant insights, reorder suggestions, and more.",
    tag:   "Coming soon",
  },
];

function FeaturesSection() {
  return (
    <section id="features" className="py-20 lg:py-28 bg-slate-50">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-50 border border-brand-100 text-brand-600 text-xs font-bold mb-4">
            <Shield className="w-3.5 h-3.5" />
            Built for Indian Pharmacies
          </span>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-4">
            Everything your pharmacy needs
          </h2>
          <p className="text-slate-500 text-lg max-w-2xl mx-auto leading-relaxed">
            From the first prescription to your monthly GST return — Checkup handles it all so you can focus on your patients.
          </p>
        </motion.div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: i * 0.07 }}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 group cursor-default"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center", f.color.split(" ")[0])}>
                    <Icon className={cn("w-5 h-5", f.color.split(" ")[1])} strokeWidth={1.8} />
                  </div>
                  {f.tag && (
                    <span className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full",
                      f.tag === "Coming soon"
                        ? "bg-violet-50 text-violet-600"
                        : "bg-emerald-50 text-emerald-600"
                    )}>
                      {f.tag}
                    </span>
                  )}
                </div>
                <h3 className="text-base font-black text-slate-800 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHOWCASE — auto-play slideshow
// ═══════════════════════════════════════════════════════════════
const SLIDES = [
  {
    tag:   "Billing",
    title: "Generate bills in 30 seconds",
    desc:  "Type a medicine name, quantity auto-fills, GST is calculated. Print, WhatsApp, or email the bill instantly.",
    bullets: ["Auto CGST/SGST split", "HSN code lookup", "Batch & expiry tracking", "UPI & cash payment modes"],
    img:   "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=700&q=80",
    imgAlt:"Pharmacist using computer at counter",
    accent:"from-blue-600 to-indigo-600",
  },
  {
    tag:   "Inventory",
    title: "Never run out of stock again",
    desc:  "Set minimum stock levels and get alerts before you run out. Track every batch, expiry, and rack location.",
    bullets: ["Low-stock email & SMS alerts", "Expiry date management", "Batch-wise tracking", "Dead stock reports"],
    img:   "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=700&q=80",
    imgAlt:"Organized pharmacy medicines",
    accent:"from-emerald-600 to-teal-600",
  },
  {
    tag:   "Purchase Orders",
    title: "Streamlined procurement",
    desc:  "Raise purchase orders to any supplier, track delivery status, and receive items directly into inventory.",
    bullets: ["Multi-supplier management", "Delivery tracking", "Auto inventory update on receive", "Price comparison history"],
    img:   "https://images.unsplash.com/photo-1563213126-a4273aed2016?auto=format&fit=crop&w=700&q=80",
    imgAlt:"Pharmacist checking medicines",
    accent:"from-amber-500 to-orange-500",
  },
  {
    tag:   "Reports",
    title: "Business insights at a glance",
    desc:  "Daily, weekly, and monthly reports for sales, GST, top medicines, and staff performance — all downloadable.",
    bullets: ["GSTR-1 ready exports", "Sales trend charts", "Top medicine analytics", "Staff performance reports"],
    img:   "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=700&q=80",
    imgAlt:"Data analytics dashboard",
    accent:"from-purple-600 to-pink-600",
  },
];

function ShowcaseSection() {
  const [active,  setActive]  = useState(0);
  const [paused,  setPaused]  = useState(false);
  const [imgErr,  setImgErr]  = useState<Record<number, boolean>>({});

  const advance = useCallback(() => setActive(s => (s + 1) % SLIDES.length), []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(advance, 5000);
    return () => clearInterval(id);
  }, [paused, advance]);

  const slide = SLIDES[active];
  if (!slide) return null;

  return (
    <section id="showcase" className="py-20 lg:py-28 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-4">
            See Checkup in action
          </h2>
          <p className="text-slate-500 text-lg max-w-xl mx-auto">
            Every feature designed to save time and reduce errors for Indian pharmacists.
          </p>
        </motion.div>

        {/* Tab pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-10"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {SLIDES.map((s, i) => (
            <button
              key={s.tag}
              onClick={() => setActive(i)}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-bold transition-all border",
                active === i
                  ? "bg-brand-600 text-white border-brand-600 shadow-sm"
                  : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
              )}
            >
              {s.tag}
            </button>
          ))}
        </div>

        {/* Slide */}
        <div
          className="relative rounded-3xl overflow-hidden border border-slate-200 shadow-xl"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0  }}
              exit={{   opacity: 0, x: -30 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
              className="grid lg:grid-cols-2"
            >
              {/* Text panel */}
              <div className={cn("p-8 lg:p-12 bg-gradient-to-br text-white", slide.accent)}>
                <span className="inline-block px-3 py-1 rounded-full bg-white/20 text-xs font-bold mb-5">
                  {slide.tag}
                </span>
                <h3 className="text-2xl sm:text-3xl font-black mb-4 leading-tight">{slide.title}</h3>
                <p className="text-white/75 text-base leading-relaxed mb-6">{slide.desc}</p>
                <ul className="space-y-2.5">
                  {slide.bullets.map(b => (
                    <li key={b} className="flex items-center gap-2.5 text-sm text-white/85">
                      <CheckCircle2 className="w-4 h-4 text-white/60 flex-shrink-0" strokeWidth={2.5} />
                      {b}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 mt-8 px-5 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-sm transition-all"
                >
                  Try it free <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Image panel */}
              <div className="relative bg-slate-100 min-h-[300px] lg:min-h-0">
                {!imgErr[active] ? (
                  <img
                    src={slide.img}
                    alt={slide.imgAlt}
                    className="w-full h-full object-cover"
                    onError={() => setImgErr(e => ({ ...e, [active]: true }))}
                  />
                ) : (
                  <div className={cn("w-full h-full flex items-center justify-center bg-gradient-to-br min-h-[300px]", slide.accent)}>
                    <span className="text-white/30 text-7xl font-black">{slide.tag[0]}</span>
                  </div>
                )}
                {/* Overlay gradient for blending */}
                <div className={cn("absolute inset-0 lg:bg-gradient-to-r opacity-20 pointer-events-none", slide.accent)} />
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Navigation arrows */}
          <button
            onClick={() => { setActive(i => (i - 1 + SLIDES.length) % SLIDES.length); setPaused(true); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm shadow-md flex items-center justify-center hover:bg-white transition-colors z-10"
          >
            <ChevronLeft className="w-4 h-4 text-slate-600" strokeWidth={2} />
          </button>
          <button
            onClick={() => { advance(); setPaused(true); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm shadow-md flex items-center justify-center hover:bg-white transition-colors z-10"
          >
            <ChevronRight className="w-4 h-4 text-slate-600" strokeWidth={2} />
          </button>

          {/* Progress dots */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
            {SLIDES.map((_, i) => (
              <button key={i} onClick={() => setActive(i)}>
                <motion.div
                  animate={{ width: active === i ? 24 : 8 }}
                  transition={{ duration: 0.3 }}
                  className={cn(
                    "h-2 rounded-full transition-colors",
                    active === i ? "bg-white" : "bg-white/40"
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOW IT WORKS
// ═══════════════════════════════════════════════════════════════
const STEPS = [
  {
    num:   "01",
    icon:  Building2,
    title: "Create your account",
    desc:  "Sign up with your pharmacy name and GSTIN. Takes less than 2 minutes — no paperwork, no waiting.",
    color: "bg-brand-600",
  },
  {
    num:   "02",
    icon:  Package2,
    title: "Add your medicines",
    desc:  "Import from Excel, scan barcodes, or type manually. Medicines are auto-matched with HSN codes and GST slabs.",
    color: "bg-emerald-600",
  },
  {
    num:   "03",
    icon:  Receipt,
    title: "Start billing instantly",
    desc:  "Create your first GST-compliant bill in seconds. Print, WhatsApp, or email it to your patient right away.",
    color: "bg-purple-600",
  },
];

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20 lg:py-28 bg-slate-50">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-4">
            Get started in 3 simple steps
          </h2>
          <p className="text-slate-500 text-lg max-w-xl mx-auto">
            Most pharmacies are live and billing within their first hour.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 relative">
          {/* Connecting line (desktop) */}
          <div className="hidden md:block absolute top-10 left-1/6 right-1/6 h-px bg-gradient-to-r from-brand-200 via-emerald-200 to-purple-200" />

          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.12 }}
                className="relative flex flex-col items-center text-center"
              >
                {/* Step circle */}
                <div className={cn(
                  "w-20 h-20 rounded-3xl flex items-center justify-center mb-5 shadow-lg relative z-10",
                  step.color
                )}>
                  <Icon className="w-9 h-9 text-white" strokeWidth={1.6} />
                </div>
                <span className="text-xs font-black text-slate-300 tracking-widest mb-2">{step.num}</span>
                <h3 className="text-lg font-black text-slate-800 mb-2">{step.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed max-w-xs">{step.desc}</p>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.4, delay: 0.4 }}
          className="flex justify-center mt-12"
        >
          <Link
            to="/register"
            className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-base transition-all shadow-md hover:shadow-lg hover:scale-[1.02]"
          >
            Get started free <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// TESTIMONIALS
// ═══════════════════════════════════════════════════════════════
const TESTIMONIALS = [
  {
    name:     "Rajesh Agarwal",
    pharmacy: "Agarwal Medical Store",
    city:     "Jaipur, Rajasthan",
    text:     "Before Checkup, GST filing took us 2 days every month. Now it's done in 20 minutes with one click. The difference is unbelievable.",
    rating:   5,
    initials: "RA",
    color:    "from-blue-400 to-indigo-500",
  },
  {
    name:     "Priya Venkatesh",
    pharmacy: "Sai Medicals",
    city:     "Chennai, Tamil Nadu",
    text:     "The inventory alerts saved us from running out of insulin twice this month. Our customers trust us because we never disappoint them now.",
    rating:   5,
    initials: "PV",
    color:    "from-teal-400 to-emerald-500",
  },
  {
    name:     "Mohammed Irfan",
    pharmacy: "Al-Shifa Pharmacy",
    city:     "Hyderabad, Telangana",
    text:     "My staff learned the billing software in one afternoon. It's that intuitive. Our bill generation time dropped from 5 minutes to 40 seconds.",
    rating:   5,
    initials: "MI",
    color:    "from-orange-400 to-rose-500",
  },
  {
    name:     "Sunita Patel",
    pharmacy: "Patel Dispensary",
    city:     "Ahmedabad, Gujarat",
    text:     "Three branches, all synced in real-time. I can check stock at any location from my phone. This is what I always wanted.",
    rating:   5,
    initials: "SP",
    color:    "from-purple-400 to-pink-500",
  },
  {
    name:     "Vikram Singh",
    pharmacy: "Singh Pharmaceuticals",
    city:     "Lucknow, UP",
    text:     "The purchase order module alone is worth the subscription. I know exactly what to order, how much, and from which supplier.",
    rating:   5,
    initials: "VS",
    color:    "from-amber-400 to-yellow-500",
  },
  {
    name:     "Kavitha Rajan",
    pharmacy: "Rajan Medical",
    city:     "Bengaluru, Karnataka",
    text:     "Customer support is outstanding. They called me back within minutes when I had trouble setting up GSTIN. Felt like they truly cared.",
    rating:   5,
    initials: "KR",
    color:    "from-cyan-400 to-blue-500",
  },
];

function TestimonialsSection() {
  const [active, setActive] = useState(0);
  const testimonial = TESTIMONIALS[active]!;

  useEffect(() => {
    const id = setInterval(() => setActive(i => (i + 1) % TESTIMONIALS.length), 4500);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="py-20 lg:py-28 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <div className="flex justify-center gap-0.5 mb-4">
            {[...Array(5)].map((_, i) => <Star key={i} className="w-5 h-5 text-amber-400 fill-amber-400" />)}
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-3">
            Loved by pharmacists across India
          </h2>
          <p className="text-slate-500 text-lg">Real stories from pharmacies that transformed with Checkup.</p>
        </motion.div>

        {/* Featured testimonial */}
        <div className="max-w-3xl mx-auto mb-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0  }}
              exit={{   opacity: 0, y: -16 }}
              transition={{ duration: 0.4 }}
              className="bg-slate-50 rounded-3xl border border-slate-200 p-8 text-center"
            >
              <div className={cn(
                "w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center text-white font-black text-xl mx-auto mb-5",
                testimonial.color
              )}>
                {testimonial.initials}
              </div>
              <div className="flex justify-center gap-0.5 mb-4">
                {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />)}
              </div>
              <p className="text-xl text-slate-700 font-medium leading-relaxed italic mb-6">
                &ldquo;{testimonial.text}&rdquo;
              </p>
              <p className="font-black text-slate-800">{testimonial.name}</p>
              <p className="text-sm text-slate-400 mt-0.5">{testimonial.pharmacy} · {testimonial.city}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Avatar dots */}
        <div className="flex justify-center items-center gap-3">
          {TESTIMONIALS.map((t, i) => (
            <button key={i} onClick={() => setActive(i)} aria-label={t.name}>
              <motion.div
                animate={{ scale: active === i ? 1.2 : 1, opacity: active === i ? 1 : 0.45 }}
                transition={{ duration: 0.25 }}
                className={cn(
                  "w-10 h-10 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-xs font-black border-2 transition-all",
                  t.color,
                  active === i ? "border-brand-400 shadow-md" : "border-transparent"
                )}
              >
                {t.initials}
              </motion.div>
            </button>
          ))}
        </div>

        {/* Grid of all testimonials (desktop) */}
        <div className="hidden lg:grid grid-cols-3 gap-5 mt-12">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              onClick={() => setActive(i)}
              className={cn(
                "bg-white rounded-2xl border p-5 cursor-pointer transition-all",
                active === i
                  ? "border-brand-300 shadow-md ring-1 ring-brand-100"
                  : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
              )}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={cn("w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-xs font-black flex-shrink-0", t.color)}>
                  {t.initials}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{t.name}</p>
                  <p className="text-[11px] text-slate-400">{t.city}</p>
                </div>
                <div className="ml-auto flex gap-0.5">
                  {[...Array(5)].map((_, j) => <Star key={j} className="w-3 h-3 text-amber-400 fill-amber-400" />)}
                </div>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed line-clamp-3">{t.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// PRICING
// ═══════════════════════════════════════════════════════════════
const PLANS = [
  {
    name:     "Starter",
    price:    { monthly: 0,   yearly: 0    },
    desc:     "Perfect for solo pharmacists just starting out.",
    features: ["1 user account", "Up to 500 bills/month", "Basic inventory", "WhatsApp billing", "Email support"],
    cta:      "Start Free",
    href:     "/register",
    popular:  false,
    badge:    null,
  },
  {
    name:     "Pro",
    price:    { monthly: 999, yearly: 799  },
    desc:     "For growing pharmacies that need more power.",
    features: ["Up to 5 staff", "Unlimited bills", "Full inventory + alerts", "Purchase orders", "Reports & GST export", "Priority support"],
    cta:      "Start Pro Trial",
    href:     "/register",
    popular:  true,
    badge:    "Most Popular",
  },
  {
    name:     "Enterprise",
    price:    { monthly: null, yearly: null },
    desc:     "Multi-branch chains and high-volume distributors.",
    features: ["Unlimited staff", "Multi-branch support", "Custom integrations", "Dedicated account manager", "SLA guarantee", "Onboarding training"],
    cta:      "Contact Sales",
    href:     "/register",
    popular:  false,
    badge:    null,
  },
];

function PricingSection() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-20 lg:py-28 bg-slate-50">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-slate-500 text-lg mb-7">No hidden fees. Start free, upgrade when you&apos;re ready.</p>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-3 bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm">
            <button
              onClick={() => setYearly(false)}
              className={cn("px-4 py-1.5 rounded-xl text-sm font-bold transition-all",
                !yearly ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >Monthly</button>
            <button
              onClick={() => setYearly(true)}
              className={cn("flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm font-bold transition-all",
                yearly ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Yearly
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-black",
                yearly ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-600"
              )}>-20%</span>
            </button>
          </div>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 items-start">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className={cn(
                "rounded-2xl border p-7 relative",
                plan.popular
                  ? "bg-white border-brand-300 shadow-xl ring-1 ring-brand-100 -translate-y-2"
                  : "bg-white border-slate-200 shadow-sm"
              )}
            >
              {plan.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-black px-4 py-1 rounded-full shadow-sm">
                  {plan.badge}
                </span>
              )}

              <p className="font-black text-slate-800 text-lg mb-1">{plan.name}</p>
              <p className="text-sm text-slate-500 mb-5 leading-relaxed">{plan.desc}</p>

              <div className="mb-6">
                {plan.price.monthly === null ? (
                  <p className="text-3xl font-black text-slate-800">Custom</p>
                ) : plan.price.monthly === 0 ? (
                  <p className="text-3xl font-black text-slate-800">Free</p>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={yearly ? "yearly" : "monthly"}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{   opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span className="text-3xl font-black text-slate-800">
                        ₹{yearly ? plan.price.yearly : plan.price.monthly}
                      </span>
                      <span className="text-sm text-slate-400 ml-1">/month</span>
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>

              <ul className="space-y-2.5 mb-7">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                to={plan.href}
                className={cn(
                  "block text-center py-3 rounded-xl text-sm font-bold transition-all",
                  plan.popular
                    ? "bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                )}
              >
                {plan.cta}
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// INTEGRATIONS
// ═══════════════════════════════════════════════════════════════
const INTEGRATIONS_LIST = [
  { name: "Tally Prime",    letter: "T", bg: "bg-blue-600"   },
  { name: "WhatsApp",       letter: "W", bg: "bg-green-500"  },
  { name: "GST Portal",     letter: "G", bg: "bg-orange-500" },
  { name: "Paytm / UPI",    letter: "P", bg: "bg-indigo-600" },
  { name: "Medline / Apollo",letter:"M", bg: "bg-teal-600"   },
  { name: "E-Aushadhi",     letter: "E", bg: "bg-red-600"    },
  { name: "Razorpay",       letter: "R", bg: "bg-violet-600" },
  { name: "PharmEasy",      letter: "Ph",bg: "bg-emerald-600"},
];

function IntegrationsSection() {
  return (
    <section id="integrations" className="py-20 lg:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-4">
            Works with tools you already use
          </h2>
          <p className="text-slate-500 text-lg max-w-xl mx-auto">
            Connect Checkup to your accounting, payment, and distribution partners.
          </p>
        </motion.div>

        <div className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-8 gap-4">
          {INTEGRATIONS_LIST.map((itg, i) => (
            <motion.div
              key={itg.name}
              initial={{ opacity: 0, scale: 0.85 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              whileHover={{ y: -4, transition: { duration: 0.18 } }}
              className="flex flex-col items-center gap-2 cursor-default"
            >
              <div className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-sm",
                itg.bg
              )}>
                {itg.letter}
              </div>
              <span className="text-[11px] text-slate-500 font-medium text-center leading-tight">{itg.name}</span>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
          viewport={{ once: true }} transition={{ delay: 0.5 }}
          className="text-center text-sm text-slate-400 mt-8 font-medium"
        >
          + 40 more integrations coming soon
        </motion.p>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// MOBILE APP SECTION
// ═══════════════════════════════════════════════════════════════
function MobileSection() {
  return (
    <section className="py-20 lg:py-24 overflow-hidden" style={{ background: "linear-gradient(135deg,#0c1f5c,#1a3080)" }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.55 }}
          >
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/70 text-xs font-bold mb-5">
              <Smartphone className="w-3.5 h-3.5" />
              Mobile App
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-4 leading-tight">
              Manage your pharmacy from anywhere
            </h2>
            <p className="text-white/60 text-lg leading-relaxed mb-8">
              Check stock, view today&apos;s sales, or approve a purchase order — all from your phone, even on a 2G connection.
            </p>
            <ul className="space-y-3 mb-8">
              {[
                "Real-time stock check",
                "Sales summary & reports",
                "Staff activity tracking",
                "Low stock & expiry alerts",
              ].map(f => (
                <li key={f} className="flex items-center gap-2.5 text-white/75 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" strokeWidth={2.5} />
                  {f}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-800 font-bold text-sm shadow-sm cursor-pointer hover:bg-slate-50 transition-colors">
                <Smartphone className="w-4 h-4" /> App Store
              </div>
              <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white font-bold text-sm cursor-pointer hover:bg-white/16 transition-colors">
                <Globe className="w-4 h-4" /> Play Store
              </div>
            </div>
            <p className="text-white/35 text-xs mt-3">Mobile app coming soon — join the waitlist</p>
          </motion.div>

          {/* Phone mockup */}
          <motion.div
            initial={{ opacity: 0, x: 24, y: 10 }} whileInView={{ opacity: 1, x: 0, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.6 }}
            className="flex justify-center"
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
              className="relative"
            >
              {/* Phone shell */}
              <div className="w-56 rounded-[2.5rem] border-[6px] border-white/20 bg-slate-900 shadow-2xl overflow-hidden">
                {/* Status bar */}
                <div className="h-7 bg-slate-800 flex items-center justify-between px-5 pt-1">
                  <span className="text-[9px] text-white/60 font-semibold">9:41</span>
                  <div className="flex items-center gap-0.5">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className={cn("w-0.5 rounded-sm bg-white", [3, 5, 7, 9][i] && `h-[${[3, 5, 7, 9][i]}px]`)}
                        style={{ height: [3, 5, 7, 9][i] }} />
                    ))}
                  </div>
                </div>
                {/* App screen */}
                <div className="bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black text-slate-800">Dashboard</p>
                    <Bell className="w-3 h-3 text-slate-400" />
                  </div>
                  {/* Mini stat cards */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {[["₹18,430","Today"],["32","Bills"],["4","Alerts"],["99","Items"]].map(([v, l]) => (
                      <div key={l} className="bg-white rounded-xl p-2 border border-slate-100">
                        <p className="text-[10px] font-black text-slate-800">{v}</p>
                        <p className="text-[8px] text-slate-400">{l}</p>
                      </div>
                    ))}
                  </div>
                  {/* Mini chart placeholder */}
                  <div className="bg-white rounded-xl p-2 border border-slate-100">
                    <p className="text-[8px] text-slate-400 mb-1.5">Sales this week</p>
                    <div className="flex items-end gap-0.5 h-8">
                      {[40,65,35,75,55,90,70].map((h, i) => (
                        <div key={i} className="flex-1 rounded-sm bg-brand-100" style={{ height: `${h}%` }}>
                          <div className="w-full rounded-sm bg-brand-500" style={{ height: "30%" }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {/* Glow */}
              <div className="absolute inset-4 -z-10 rounded-full blur-2xl opacity-30 bg-blue-500" />
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// FINAL CTA
// ═══════════════════════════════════════════════════════════════
function CTASection() {
  return (
    <section className="py-20 lg:py-28 bg-slate-50">
      <div className="max-w-4xl mx-auto px-5 sm:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.55 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-50 border border-brand-100 text-brand-600 text-sm font-bold mb-6">
            <Zap className="w-4 h-4 text-yellow-500" />
            Start billing in under 5 minutes
          </div>
          <h2 className="text-4xl sm:text-5xl font-black text-slate-800 mb-5 leading-tight">
            Ready to transform
            <br />
            <span className="text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(90deg,#2563eb,#7c3aed)" }}>
              your pharmacy?
            </span>
          </h2>
          <p className="text-slate-500 text-xl leading-relaxed mb-10 max-w-2xl mx-auto">
            Join 500+ pharmacies across India already using Checkup. Free forever plan available — no credit card needed.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/register"
              className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-black text-lg transition-all shadow-xl shadow-brand-200 hover:shadow-brand-300 hover:scale-[1.02]"
            >
              Create Free Account <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-lg transition-all"
            >
              <PhoneCall className="w-5 h-5 text-slate-400" />
              Book a demo
            </Link>
          </div>
          <p className="text-slate-400 text-sm mt-6">
            Questions? Call us at{" "}
            <a href="tel:+918800000000" className="text-brand-600 font-semibold hover:underline">+91 88000 00000</a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// FOOTER
// ═══════════════════════════════════════════════════════════════
function Footer() {
  const cols = [
    {
      heading: "Product",
      links: ["Features", "Pricing", "Integrations", "Changelog", "Roadmap"],
    },
    {
      heading: "Company",
      links: ["About us", "Blog", "Careers", "Press", "Contact"],
    },
    {
      heading: "Support",
      links: ["Help Center", "API Docs", "Status", "Community", "Training"],
    },
    {
      heading: "Legal",
      links: ["Privacy Policy", "Terms of Service", "GST Policy", "Refunds"],
    },
  ];

  return (
    <footer style={{ background: "linear-gradient(180deg, #0c1f5c 0%, #090f33 100%)" }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8 pt-14 pb-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-10 mb-12">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
                <span className="text-white font-black text-xl leading-none">+</span>
              </div>
              <div className="leading-none">
                <p className="text-white font-extrabold text-sm">Checkup</p>
                <p className="text-blue-300/60 text-[10px] font-semibold tracking-widest uppercase mt-0.5">Pharmacy</p>
              </div>
            </div>
            <p className="text-white/45 text-sm leading-relaxed max-w-xs">
              India&apos;s smartest pharmacy management platform. Built by pharmacists, for pharmacists.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                All systems normal
              </span>
            </div>
          </div>

          {/* Columns */}
          {cols.map(col => (
            <div key={col.heading}>
              <p className="text-white text-xs font-black uppercase tracking-widest mb-4">{col.heading}</p>
              <ul className="space-y-2.5">
                {col.links.map(l => (
                  <li key={l}>
                    <a href="#" className="text-white/45 hover:text-white/80 text-sm transition-colors">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Divider + copyright */}
        <div className="border-t border-white/8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-white/30 text-xs">
            © {new Date().getFullYear()} Checkup Pharmacy Pvt. Ltd. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-white/30 text-xs">
              <Lock className="w-3 h-3" /> SSL Secured
            </span>
            <span className="flex items-center gap-1.5 text-white/30 text-xs">
              <Shield className="w-3 h-3" /> HIPAA Compliant
            </span>
            <span className="flex items-center gap-1.5 text-white/30 text-xs">
              <IndianRupee className="w-3 h-3" /> GST Ready
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE ASSEMBLY
// ═══════════════════════════════════════════════════════════════
export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main>
        <HeroSection />
        <StatsSection />
        <FeaturesSection />
        <ShowcaseSection />
        <HowItWorksSection />
        <TestimonialsSection />
        <PricingSection />
        <IntegrationsSection />
        <MobileSection />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
