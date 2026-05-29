import type { Metadata } from "next";
import { Zap, Package2, Search, Users, Shield, Cloud, Headphones } from "lucide-react";

export const metadata: Metadata = { title: "Checkup Pharmacy" };

// ─── Dashboard preview mockup ─────────────────────────────────
function DashboardPreview() {
  const stats = [
    { label: "Total Sales",   value: "₹1,24,850", sub: "↑ 18.6% vs yesterday", accent: "text-emerald-500" },
    { label: "Total Bills",   value: "152",        sub: "↑ 12.4% vs yesterday", accent: "text-emerald-500" },
    { label: "Today Profit",  value: "₹24,680",    sub: "↑ 16.3% vs yesterday", accent: "text-emerald-500" },
    { label: "Low Stock",     value: "23",         sub: "View Items →",          accent: "text-blue-500"    },
  ];
  const topItems = [
    ["Crocin 650",     "Strip of 15", "523"],
    ["Dolo 650",       "Strip of 15", "412"],
    ["Augmentin 625",  "Strip of 6",  "309"],
    ["Budecort 200",   "Strip of 10", "256"],
    ["Calcium D3",     "Strip of 15", "215"],
  ];
  const navItems = ["Dashboard","Billing","Sales","Inventory","Purchase","Customers","Reports","GST Center","Employees","Settings"];

  return (
    <div className="w-full rounded-xl overflow-hidden text-[9px]"
      style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)" }}
    >
      {/* TopNav */}
      <div className="h-8 flex items-center gap-2 px-3"
        style={{ background: "linear-gradient(90deg,#0c1f5c,#1a3080)" }}>
        <div className="w-4 h-4 rounded-md bg-blue-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-black text-[8px] leading-none">+</span>
        </div>
        <span className="text-white font-extrabold text-[9px] tracking-tight">Checkup</span>
        <div className="flex-1 mx-2 max-w-[160px]">
          <div className="bg-white/10 rounded px-2 py-0.5 text-[7px] text-white/35">
            Search medicine / invoice / customer...
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center">
            <span className="text-white/60 text-[6px]">🔔</span>
          </div>
          <span className="text-white/55 text-[8px]">Sunrise Pharmacy ▾</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex bg-white" style={{ minHeight: 180 }}>
        {/* Sidebar */}
        <div className="w-[72px] flex-shrink-0 bg-slate-50 border-r border-slate-100 py-1.5">
          {navItems.map((item, i) => (
            <div key={item}
              className={`mx-1 px-1.5 py-[3px] rounded text-[6.5px] font-medium mb-0.5 ${
                i === 0 ? "bg-blue-600 text-white" : "text-slate-500"
              }`}
            >
              {item}
            </div>
          ))}
        </div>

        {/* Main */}
        <div className="flex-1 p-2 min-w-0">
          <p className="text-[10px] font-black text-slate-800 mb-1.5">Dashboard</p>

          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-1 mb-2">
            {stats.map(s => (
              <div key={s.label} className="bg-white rounded border border-slate-100 p-1.5 shadow-sm">
                <p className="text-[5.5px] text-slate-400 mb-0.5">{s.label}</p>
                <p className="text-[9px] font-black text-slate-800 leading-tight">{s.value}</p>
                <p className={`text-[5.5px] mt-0.5 ${s.accent}`}>{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Chart + Top items */}
          <div className="grid grid-cols-5 gap-1.5">
            {/* Chart */}
            <div className="col-span-3 bg-white rounded border border-slate-100 p-1.5 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[7px] font-semibold text-slate-600">Sales Overview</span>
                <div className="flex gap-0.5">
                  {["Day","Week","Month","Year"].map((t, i) => (
                    <span key={t} className={`text-[5.5px] px-1 py-0.5 rounded ${i===0?"bg-blue-600 text-white":"text-slate-400"}`}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="relative h-14">
                <svg viewBox="0 0 140 42" className="w-full h-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polygon
                    points="0,40 0,36 12,31 24,34 36,26 48,20 60,23 72,15 84,13 96,9 108,7 120,5 132,3 140,1 140,40"
                    fill="url(#cg)"
                  />
                  <polyline
                    points="0,36 12,31 24,34 36,26 48,20 60,23 72,15 84,13 96,9 108,7 120,5 132,3 140,1"
                    fill="none" stroke="#3b82f6" strokeWidth="1.4" strokeLinejoin="round"
                  />
                  <circle cx="72" cy="15" r="2" fill="#3b82f6" />
                  <line x1="72" y1="15" x2="72" y2="40" stroke="#3b82f6" strokeWidth="0.5" strokeDasharray="2,1.5" opacity="0.5" />
                </svg>
                <div className="absolute top-0 right-2 bg-blue-50 border border-blue-100 rounded px-1 py-0.5">
                  <p className="text-[5.5px] font-black text-blue-700">₹1,24,850</p>
                  <p className="text-[4.5px] text-slate-400 leading-tight">Today</p>
                </div>
                <div className="absolute bottom-0 left-0 right-0 flex justify-between px-0.5">
                  {["12 AM","4 AM","8 AM","12 PM","4 PM","8 PM"].map(t => (
                    <span key={t} className="text-[4.5px] text-slate-300">{t}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Top selling */}
            <div className="col-span-2 bg-white rounded border border-slate-100 p-1.5 shadow-sm">
              <p className="text-[7px] font-semibold text-slate-600 mb-1">Top Selling Items</p>
              <div className="space-y-0.5">
                {topItems.map(([name, sub, count]) => (
                  <div key={name} className="flex items-center gap-1 py-0.5 border-b border-slate-50 last:border-0">
                    <div className="w-3.5 h-3.5 rounded bg-blue-100 border border-blue-200 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[6px] font-medium text-slate-700 truncate">{name}</p>
                      <p className="text-[5px] text-slate-400">{sub}</p>
                    </div>
                    <span className="text-[6.5px] font-bold text-slate-700">{count}</span>
                  </div>
                ))}
              </div>
              <div className="text-right mt-0.5">
                <span className="text-[5.5px] text-blue-500 font-medium">View all →</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Layout ───────────────────────────────────────────────────
const FEATURES = [
  { icon: Zap,      bg: "bg-yellow-400/20", color: "text-yellow-300", title: "Lightning-fast billing",  desc: "Create GST-compliant bills in seconds"           },
  { icon: Package2, bg: "bg-green-400/20",  color: "text-green-300",  title: "Smart inventory",         desc: "Track stock & get expiry alerts"                  },
  { icon: Search,   bg: "bg-blue-400/20",   color: "text-blue-300",   title: "Powerful search",         desc: "Find medicines across 50,000+ products"           },
  { icon: Users,    bg: "bg-purple-400/20", color: "text-purple-300", title: "Role-based access",        desc: "Manage your team with control & clarity"          },
];

const TRUST = [
  { icon: Shield,     title: "Secure by design",  desc: "Your data is encrypted and always protected" },
  { icon: Cloud,      title: "Always available",  desc: "99.9% uptime with daily backups"             },
  { icon: Headphones, title: "Human support",     desc: "Real people, ready to help you"             },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">

      {/* ── Left panel ──────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[58%] xl:w-[60%] flex-col flex-shrink-0 relative overflow-hidden"
        style={{ background: "linear-gradient(155deg,#08102e 0%,#0e1d60 35%,#1530a0 80%,#1a3ab8 100%)" }}
      >
        {/* Decorative circles */}
        <div className="absolute top-[-120px] right-[-120px] w-[400px] h-[400px] rounded-full opacity-[0.12]"
          style={{ background: "radial-gradient(circle,#60a5fa,transparent 70%)" }} />
        <div className="absolute bottom-[-80px] left-[-80px] w-[320px] h-[320px] rounded-full opacity-[0.10]"
          style={{ background: "radial-gradient(circle,#818cf8,transparent 70%)" }} />
        <div className="absolute top-[40%] left-[-60px] w-[220px] h-[220px] rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(circle,#38bdf8,transparent 70%)" }} />

        {/* Scrollable content */}
        <div className="relative z-10 flex flex-col h-full p-10 xl:p-14">

          {/* Logo */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <span className="text-white font-black text-2xl leading-none select-none">+</span>
            </div>
            <div className="leading-none">
              <p className="text-white font-extrabold text-lg tracking-tight">Checkup</p>
              <p className="text-blue-300/70 text-[10px] font-bold tracking-[0.22em] uppercase mt-0.5">Pharmacy OS</p>
            </div>
          </div>

          {/* Headline */}
          <div className="mb-8">
            <h1 className="text-3xl xl:text-4xl font-black text-white leading-tight mb-3">
              Pharmacy management<br />
              that{" "}
              <span className="text-transparent bg-clip-text"
                style={{ backgroundImage: "linear-gradient(90deg,#60a5fa,#38bdf8)" }}>
                just works.
              </span>
            </h1>
            <p className="text-blue-200/55 text-sm leading-relaxed max-w-sm">
              Everything you need to run your pharmacy —<br />
              billing, inventory, GST, reports, and more.<br />
              Built for speed. Built for India.
            </p>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            {FEATURES.map(({ icon: Icon, bg, color, title, desc }) => (
              <div key={title} className="flex items-start gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>
                  <Icon className={`w-4 h-4 ${color}`} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-white text-xs font-bold leading-tight">{title}</p>
                  <p className="text-blue-200/45 text-[11px] mt-0.5 leading-tight">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Dashboard mockup */}
          <div className="flex-1 flex items-end pb-2">
            <div className="w-full">
              <DashboardPreview />
            </div>
          </div>
        </div>

        {/* Trust bar */}
        <div className="relative z-10 border-t flex-shrink-0"
          style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.18)" }}>
          <div className="grid grid-cols-3 divide-x px-10 xl:px-14 py-5"
            style={{ divideColor: "rgba(255,255,255,0.07)" }}>
            {TRUST.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 px-4 first:pl-0 last:pr-0">
                <div className="w-8 h-8 rounded-lg bg-blue-600/30 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-blue-300" strokeWidth={1.6} />
                </div>
                <div>
                  <p className="text-white text-xs font-bold">{title}</p>
                  <p className="text-blue-200/40 text-[11px] mt-0.5 leading-tight">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right form area ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
