

import { motion } from "framer-motion";
import { Zap, Sparkles, MessageSquare, TrendingUp, Package2, Bell } from "lucide-react";

const FEATURES = [
  {
    icon:  MessageSquare,
    title: "Natural Language Billing",
    desc:  "Dictate a bill in plain Hindi or English — Ginni transcribes, identifies medicines, and drafts the bill for you.",
  },
  {
    icon:  TrendingUp,
    title: "Sales Insights",
    desc:  "Ask things like \"What were my top-selling medicines last week?\" and get instant chart-backed answers.",
  },
  {
    icon:  Package2,
    title: "Smart Reorder Alerts",
    desc:  "Ginni learns your sales velocity and tells you exactly when and how much to reorder — no more stockouts.",
  },
  {
    icon:  Bell,
    title: "Expiry Notifications",
    desc:  "Proactive nudges before medicines expire, automatically sorted by urgency and batch number.",
  },
];

export default function GinniPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-14 flex flex-col items-center text-center">

        {/* Icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1,   opacity: 1 }}
          transition={{ duration: 0.4, type: "spring", stiffness: 200 }}
          className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6 relative"
          style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5, #2563eb)" }}
        >
          <Zap className="w-9 h-9 text-white" strokeWidth={1.6} />
          {/* Animated ring */}
          <motion.span
            className="absolute inset-0 rounded-3xl border-2 border-violet-400/50"
            animate={{ scale: [1, 1.2, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0  }}
          transition={{ delay: 0.15 }}
        >
          <div className="inline-flex items-center gap-1.5 bg-violet-50 border border-violet-200 rounded-full px-3 py-1 text-xs font-bold text-violet-600 mb-4">
            <Sparkles className="w-3 h-3" />
            Powered by AI
          </div>
          <h1 className="text-3xl font-black text-slate-800 mb-3">Meet Ginni</h1>
          <p className="text-slate-500 text-base leading-relaxed">
            Your AI-powered pharmacy assistant. Ginni helps you bill faster, manage inventory smarter,
            and understand your business better — all through simple conversation.
          </p>
        </motion.div>

        {/* Coming soon badge */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="mt-6 px-5 py-2.5 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold shadow-lg shadow-violet-200"
        >
          Coming Soon
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-12 w-full grid grid-cols-1 sm:grid-cols-2 gap-4 text-left"
        >
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.06 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
            >
              <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center mb-3">
                <Icon className="w-4.5 h-4.5 text-violet-600" strokeWidth={1.7} />
              </div>
              <p className="text-sm font-bold text-slate-800 mb-1">{title}</p>
              <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-xs text-slate-400 mt-8"
        >
          Ginni will be available to Pro and Enterprise plan users.
        </motion.p>

      </div>
    </div>
  );
}
