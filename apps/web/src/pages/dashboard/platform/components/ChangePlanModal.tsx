import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useToast } from "@/hooks/useToast";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Zap, Crown, Building2, Sparkles, CreditCard,
  CheckCircle2, ArrowRight, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  subscriptionId: string;
  currentPlan: string;
  onClose: () => void;
};

const PLANS = [
  {
    id: "Free",
    icon: Zap,
    label: "Free",
    price: { monthly: 0, yearly: 0, quarterly: 0 },
    features: ["5 doctors", "100 patients", "Basic billing", "Email support"],
    color: "slate",
  },
  {
    id: "Standard",
    icon: Crown,
    label: "Standard",
    price: { monthly: 999, yearly: 9590, quarterly: 2697 },
    features: ["15 doctors", "1,000 patients", "Full billing + inventory", "Priority support", "SMS notifications"],
    color: "indigo",
    popular: true,
  },
  {
    id: "Professional",
    icon: Sparkles,
    label: "Professional",
    price: { monthly: 2499, yearly: 23990, quarterly: 6747 },
    features: ["50 doctors", "10,000 patients", "EMR + CRM", "API access", "WhatsApp + analytics", "Dedicated support"],
    color: "violet",
  },
  {
    id: "Enterprise",
    icon: Building2,
    label: "Enterprise",
    price: { monthly: 4999, yearly: 47990, quarterly: 13497 },
    features: ["Unlimited doctors", "Unlimited patients", "All features", "Custom integrations", "SLA + account manager", "On-premise option"],
    color: "amber",
  },
];

const CYCLES = [
  { key: "MONTHLY", label: "Monthly" },
  { key: "QUARTERLY", label: "Quarterly" },
  { key: "YEARLY", label: "Yearly", badge: "Save 20%" },
] as const;

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function ChangePlanModal({ subscriptionId, currentPlan, onClose }: Props) {
  const [selectedPlan, setSelectedPlan] = useState(currentPlan);
  const [cycle, setCycle] = useState<"MONTHLY" | "QUARTERLY" | "YEARLY">("MONTHLY");
  const [step, setStep] = useState<"select" | "confirm">("select");

  const toast = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const plan = PLANS.find((p) => p.id === selectedPlan);
      const amount = plan ? plan.price[cycle.toLowerCase() as keyof typeof plan.price] : 0;
      const { data } = await api.patch(`/platform/subscriptions/${subscriptionId}/plan`, {
        planName: selectedPlan,
        billingCycle: cycle,
        amount,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-detail", subscriptionId] });
      qc.invalidateQueries({ queryKey: ["sub-list"] });
      qc.invalidateQueries({ queryKey: ["sub-stats"] });
      toast.success("Plan changed successfully");
      onClose();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to change plan"),
  });

  const currentPlanData = PLANS.find((p) => p.id === currentPlan);
  const targetPlanData = PLANS.find((p) => p.id === selectedPlan);
  const isUpgrade = PLANS.findIndex((p) => p.id === selectedPlan) > PLANS.findIndex((p) => p.id === currentPlan);
  const isDowngrade = PLANS.findIndex((p) => p.id === selectedPlan) < PLANS.findIndex((p) => p.id === currentPlan);
  const isSame = selectedPlan === currentPlan;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">

          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-100">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{step === "select" ? "Change Plan" : "Confirm Plan Change"}</h2>
              <p className="text-sm text-slate-500 mt-0.5">Currently on <span className="font-semibold text-slate-900">{currentPlan}</span></p>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button>
          </div>

          {step === "select" ? (
            <div className="p-6 space-y-6">
              {/* Cycle Selector */}
              <div className="flex items-center justify-center gap-1 p-1 bg-slate-100 rounded-xl w-fit mx-auto">
                {CYCLES.map((c) => (
                  <button key={c.key} onClick={() => setCycle(c.key as typeof cycle)} className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all relative", cycle === c.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                    {c.label}
                    {"badge" in c && c.badge && <span className="absolute -top-2 -right-2 text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-bold">{c.badge}</span>}
                  </button>
                ))}
              </div>

              {/* Plan Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {PLANS.map((plan) => {
                  const Icon = plan.icon;
                  const price = plan.price[cycle.toLowerCase() as keyof typeof plan.price];
                  const isCurrent = plan.id === currentPlan;
                  const isSelected = plan.id === selectedPlan;

                  const colorMap: Record<string, { bg: string; ring: string; icon: string }> = {
                    slate: { bg: "bg-slate-50", ring: "ring-slate-300", icon: "text-slate-600" },
                    indigo: { bg: "bg-indigo-50", ring: "ring-indigo-400", icon: "text-indigo-600" },
                    violet: { bg: "bg-violet-50", ring: "ring-violet-400", icon: "text-violet-600" },
                    amber: { bg: "bg-amber-50", ring: "ring-amber-400", icon: "text-amber-600" },
                  };
                  const c = colorMap[plan.color] || colorMap["slate"]!;

                  return (
                    <div key={plan.id} onClick={() => setSelectedPlan(plan.id)}
                      className={cn("relative p-4 rounded-xl border-2 cursor-pointer transition-all",
                        isSelected ? `${c.bg} border-brand-500 ring-2 ring-brand-500/20` : "border-slate-200 hover:border-slate-300 bg-white")}>
                      {plan.popular && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full tracking-wide">POPULAR</span>}
                      {isCurrent && <span className="absolute -top-2.5 right-3 bg-slate-700 text-white text-[9px] font-bold px-2 py-0.5 rounded-full tracking-wide">CURRENT</span>}
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-3", c.bg, c.icon)}><Icon className="w-5 h-5" /></div>
                      <h3 className="font-bold text-slate-900">{plan.label}</h3>
                      <p className="text-xl font-extrabold text-slate-900 mt-1">{price === 0 ? "Free" : formatCurrency(price)}<span className="text-xs font-normal text-slate-500">/{cycle.toLowerCase().slice(0, -2) + (cycle === "MONTHLY" ? "mo" : cycle === "YEARLY" ? "yr" : "qtr")}</span></p>
                      <ul className="mt-3 space-y-1.5">
                        {plan.features.map((f) => (
                          <li key={f} className="flex items-center gap-1.5 text-xs text-slate-600"><CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" /> {f}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              {/* Continue */}
              <div className="flex justify-end pt-2">
                <button disabled={isSame} onClick={() => setStep("confirm")}
                  className={cn("flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all",
                    isSame ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-brand-600 text-white hover:bg-brand-700 shadow-lg shadow-brand-600/20")}>
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* Confirmation Step */
            <div className="p-6 space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                <div className="flex items-center justify-between">
                  <div className="text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase">Current</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">{currentPlan}</p>
                    {currentPlanData && <p className="text-xs text-slate-500">{formatCurrency(currentPlanData.price[cycle.toLowerCase() as keyof typeof currentPlanData.price])}</p>}
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <ArrowRight className={cn("w-6 h-6", isUpgrade ? "text-emerald-500" : "text-amber-500")} />
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", isUpgrade ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                      {isUpgrade ? "UPGRADE" : "DOWNGRADE"}
                    </span>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase">New Plan</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">{selectedPlan}</p>
                    {targetPlanData && <p className="text-xs text-slate-500">{formatCurrency(targetPlanData.price[cycle.toLowerCase() as keyof typeof targetPlanData.price])}</p>}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep("select")} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900">← Back</button>
                <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
                  className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm hover:bg-brand-700 shadow-lg shadow-brand-600/20 disabled:opacity-60">
                  {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm {isUpgrade ? "Upgrade" : "Downgrade"}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
