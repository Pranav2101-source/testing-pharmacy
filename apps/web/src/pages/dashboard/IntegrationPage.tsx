

import { motion } from "framer-motion";
import { Link2, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type IntStatus = "connected" | "coming_soon";

interface Integration {
  name:     string;
  desc:     string;
  logo:     string;
  status:   IntStatus;
  category: string;
}

const INTEGRATIONS: Integration[] = [
  {
    name:     "Tally Prime",
    desc:     "Sync your billing and purchase data automatically with Tally for seamless accounting.",
    logo:     "T",
    status:   "coming_soon",
    category: "Accounting",
  },
  {
    name:     "WhatsApp Business",
    desc:     "Send digital bills, reminders, and low-stock alerts to customers and suppliers via WhatsApp.",
    logo:     "W",
    status:   "coming_soon",
    category: "Communication",
  },
  {
    name:     "GST Portal",
    desc:     "File GST returns directly from Checkup — GSTR-1, GSTR-3B auto-populated from your bills.",
    logo:     "G",
    status:   "coming_soon",
    category: "Compliance",
  },
  {
    name:     "Medline / PharmEasy",
    desc:     "Directly place purchase orders with your favourite distributors without leaving the app.",
    logo:     "M",
    status:   "coming_soon",
    category: "Procurement",
  },
  {
    name:     "Paytm / Razorpay",
    desc:     "Accept UPI, card, and wallet payments from customers with instant settlement.",
    logo:     "P",
    status:   "coming_soon",
    category: "Payments",
  },
  {
    name:     "E-Aushadhi (CDSCO)",
    desc:     "Automatically sync drug license data and maintain compliance with state drug authorities.",
    logo:     "E",
    status:   "coming_soon",
    category: "Compliance",
  },
];

const LOGO_COLORS: Record<string, string> = {
  T: "bg-blue-600",
  W: "bg-green-500",
  G: "bg-orange-500",
  M: "bg-teal-600",
  P: "bg-indigo-600",
  E: "bg-red-600",
};

const CATEGORIES = [...new Set(INTEGRATIONS.map(i => i.category))];

export default function IntegrationPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between"
        >
          <div>
            <h1 className="text-xl font-black text-slate-800">Integrations</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Connect Checkup with the tools your pharmacy already uses.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <Clock className="w-3.5 h-3.5 text-amber-600" strokeWidth={2} />
            <span className="text-xs font-bold text-amber-700">All Coming Soon</span>
          </div>
        </motion.div>

        {/* Categories */}
        {CATEGORIES.map((category, ci) => {
          const items = INTEGRATIONS.filter(i => i.category === category);
          return (
            <motion.div
              key={category}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + ci * 0.05 }}
            >
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{category}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((integration, i) => (
                  <motion.div
                    key={integration.name}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + ci * 0.05 + i * 0.04 }}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-base flex-shrink-0",
                          LOGO_COLORS[integration.logo] ?? "bg-slate-600"
                        )}>
                          {integration.logo}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">{integration.name}</p>
                          <span className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-semibold mt-0.5",
                            integration.status === "connected"
                              ? "text-emerald-600"
                              : "text-slate-400"
                          )}>
                            {integration.status === "connected"
                              ? <><CheckCircle2 className="w-2.5 h-2.5" strokeWidth={2} /> Connected</>
                              : <><Clock className="w-2.5 h-2.5" strokeWidth={2} /> Coming soon</>
                            }
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed flex-1">{integration.desc}</p>

                    <button
                      disabled={integration.status === "coming_soon"}
                      className={cn(
                        "flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-xs font-bold transition-all",
                        integration.status === "connected"
                          ? "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                          : "bg-slate-100 text-slate-400 cursor-not-allowed"
                      )}
                    >
                      {integration.status === "connected"
                        ? <><ExternalLink className="w-3 h-3" /> Manage</>
                        : <><Link2 className="w-3 h-3" /> Notify Me</>
                      }
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          );
        })}

        {/* Request integration CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-gradient-to-r from-brand-600 to-indigo-600 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-4 text-white"
        >
          <div className="flex-1 text-center sm:text-left">
            <p className="font-black text-base">Don&apos;t see the integration you need?</p>
            <p className="text-sm text-white/70 mt-0.5">Request it — we build integrations based on demand.</p>
          </div>
          <button className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-white text-brand-700 text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm">
            Request Integration
          </button>
        </motion.div>

      </div>
    </div>
  );
}
