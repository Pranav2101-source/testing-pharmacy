

import { useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Zap,
  Building2,
  Crown,
  Sparkles,
  ArrowRight,
  Calendar,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

// ─── Types ────────────────────────────────────────────────────
type BillingCycle = "monthly" | "yearly";

interface Plan {
  id:         string;
  name:       string;
  icon:       React.ElementType;
  badge?:     string;
  monthlyPrice: number | null;
  yearlyPrice:  number | null;
  description: string;
  features:   string[];
  cta:        string;
  popular?:   boolean;
  current?:   boolean;
}

// ─── Plan data ────────────────────────────────────────────────
const PLANS: Plan[] = [
  {
    id:           "starter",
    name:         "Starter",
    icon:         Zap,
    monthlyPrice: 0,
    yearlyPrice:  0,
    description:  "Perfect for small, single-counter pharmacies",
    features: [
      "Up to 100 bills/month",
      "Basic inventory management",
      "1 staff account",
      "Standard invoice template",
      "Email support",
    ],
    cta:     "Current Plan",
    current: true,
  },
  {
    id:           "pro",
    name:         "Pro",
    icon:         Crown,
    badge:        "Most Popular",
    monthlyPrice: 999,
    yearlyPrice:  799,
    description:  "For growing pharmacies with multiple staff",
    features: [
      "Unlimited bills",
      "Advanced inventory + expiry alerts",
      "Up to 10 staff accounts",
      "Custom invoice templates",
      "GST reports & analytics",
      "WhatsApp notifications",
      "Priority support",
      "Meilisearch medicine catalog",
    ],
    cta:     "Upgrade to Pro",
    popular: true,
  },
  {
    id:           "enterprise",
    name:         "Enterprise",
    icon:         Building2,
    monthlyPrice: null,
    yearlyPrice:  null,
    description:  "For pharmacy chains and large operations",
    features: [
      "Everything in Pro",
      "Unlimited staff accounts",
      "Multi-branch management",
      "Custom integrations (EMR/ERP)",
      "Dedicated account manager",
      "SLA-backed uptime",
      "On-premise deployment option",
      "Custom training & onboarding",
    ],
    cta: "Contact Sales",
  },
];

// ─── Price display ────────────────────────────────────────────
function PriceDisplay({ plan, cycle }: { plan: Plan; cycle: BillingCycle }) {
  const price = cycle === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;

  if (price === null) {
    return (
      <div className="mt-4 mb-1">
        <p className="text-2xl font-black text-slate-800">Custom</p>
        <p className="text-xs text-slate-400 mt-0.5">Tailored to your needs</p>
      </div>
    );
  }

  if (price === 0) {
    return (
      <div className="mt-4 mb-1">
        <p className="text-2xl font-black text-slate-800">Free</p>
        <p className="text-xs text-slate-400 mt-0.5">Always free</p>
      </div>
    );
  }

  return (
    <div className="mt-4 mb-1">
      <div className="flex items-end gap-1">
        <span className="text-sm font-semibold text-slate-500 mb-1">₹</span>
        <motion.span
          key={`${plan.id}-${cycle}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-black text-slate-800"
        >
          {price.toLocaleString("en-IN")}
        </motion.span>
        <span className="text-xs text-slate-400 mb-1">/mo</span>
      </div>
      {cycle === "yearly" && (
        <p className="text-[10px] text-emerald-600 font-semibold">
          Billed ₹{(price * 12).toLocaleString("en-IN")}/year · Save 20%
        </p>
      )}
    </div>
  );
}

// ─── Plan card ────────────────────────────────────────────────
function PlanCard({ plan, cycle, onSelect }: { plan: Plan; cycle: BillingCycle; onSelect: (plan: Plan) => void }) {
  const Icon = plan.icon;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border p-6 transition-all duration-150 hover:-translate-y-0.5",
        plan.popular
          ? "border-brand-300 shadow-card-glow bg-white"
          : plan.current
          ? "border-slate-200 shadow-card bg-white"
          : "border-slate-200 shadow-card bg-white hover:shadow-card-md"
      )}
    >
      {/* Popular badge */}
      {plan.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="flex items-center gap-1 bg-brand-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg">
            <Sparkles className="w-2.5 h-2.5" />
            {plan.badge}
          </span>
        </div>
      )}

      {/* Current indicator */}
      {plan.current && (
        <div className="absolute top-4 right-4">
          <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2.5 py-1 rounded-full">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Active
          </span>
        </div>
      )}

      {/* Icon + name */}
      <div className={cn(
        "w-10 h-10 rounded-xl flex items-center justify-center mb-2",
        plan.popular ? "bg-brand-600" : plan.id === "enterprise" ? "bg-slate-800" : "bg-slate-100"
      )}>
        <Icon
          className={cn("w-5 h-5", plan.popular || plan.id === "enterprise" ? "text-white" : "text-slate-600")}
          strokeWidth={1.8}
        />
      </div>
      <p className="text-base font-black text-slate-800">{plan.name}</p>
      <p className="text-xs text-slate-400 mt-0.5 leading-snug">{plan.description}</p>

      {/* Price */}
      <PriceDisplay plan={plan} cycle={cycle} />

      {/* Divider */}
      <div className="border-t border-slate-100 my-4" />

      {/* Features */}
      <ul className="flex flex-col gap-2 flex-1 mb-6">
        {plan.features.map((feat) => (
          <li key={feat} className="flex items-start gap-2 text-xs text-slate-600">
            <CheckCircle2
              className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", plan.popular ? "text-brand-500" : "text-emerald-500")}
              strokeWidth={2}
            />
            {feat}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        disabled={plan.current}
        onClick={() => onSelect(plan)}
        className={cn(
          "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all",
          plan.current
            ? "bg-slate-100 text-slate-400 cursor-default"
            : plan.popular
            ? "bg-brand-600 hover:bg-brand-700 text-white shadow-card-md hover:shadow-lift"
            : plan.id === "enterprise"
            ? "bg-slate-800 hover:bg-slate-900 text-white"
            : "border border-slate-200 hover:border-brand-400 text-slate-700 hover:text-brand-600 hover:bg-brand-50"
        )}
      >
        {!plan.current && <ArrowRight className="w-3.5 h-3.5" />}
        {plan.cta}
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function PlansPage() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const toast = useToast();

  // Mock current billing info
  const nextBillingDate = "—";
  const currentPlan     = PLANS.find((p) => p.current)!;

  // No self-serve checkout exists yet — route upgrade/sales enquiries to the
  // real support-ticket flow instead of pretending a payment flow exists.
  function handlePlanSelect(plan: Plan) {
    window.dispatchEvent(new CustomEvent("checkup:open-help", { detail: { category: "support" } }));
    toast.info(
      plan.id === "enterprise"
        ? "Raise a ticket and our sales team will reach out shortly."
        : `Raise a ticket to upgrade to ${plan.name} — our team will activate it for you.`,
    );
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

      {/* Page header */}
      <div>
        <h1 className="text-lg font-bold text-slate-800">Plans & Billing</h1>
        <p className="text-sm text-slate-400 mt-0.5">Choose the plan that fits your pharmacy</p>
      </div>

      {/* Current plan banner */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-4 bg-white border border-slate-200 rounded-2xl px-6 py-4 shadow-card"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <Zap className="w-5 h-5 text-slate-600" strokeWidth={1.8} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Current Plan</p>
            <p className="text-sm font-bold text-slate-800">{currentPlan.name} — Free</p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.8} />
            <span>Next billing: <strong className="text-slate-700">{nextBillingDate}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.8} />
            <span>No card on file</span>
          </div>
        </div>
      </motion.div>

      {/* Billing cycle toggle */}
      <div className="flex justify-center">
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-card">
          {(["monthly", "yearly"] as BillingCycle[]).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={cn(
                "flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold transition-all",
                cycle === c
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {c === "monthly" ? "Monthly" : "Yearly"}
              {c === "yearly" && (
                <span className={cn(
                  "text-[9px] font-black px-1.5 py-0.5 rounded-full",
                  cycle === "yearly" ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700"
                )}>
                  -20%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map((plan, i) => (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
          >
            <PlanCard plan={plan} cycle={cycle} onSelect={handlePlanSelect} />
          </motion.div>
        ))}
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-slate-300">
        All prices are in INR and exclusive of GST · Cancel anytime · 7-day free trial on Pro
      </p>
    </div>
    </div>
  );
}
