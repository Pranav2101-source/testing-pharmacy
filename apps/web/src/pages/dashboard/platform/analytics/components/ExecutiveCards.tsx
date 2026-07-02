import { TrendingUp, TrendingDown, DollarSign, Users, Building2, FileText, LifeBuoy, Activity } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { KPICard } from "../analytics.types";

const iconMap: Record<string, React.ReactNode> = {
  mrr: <DollarSign className="w-5 h-5" />,
  arr: <DollarSign className="w-5 h-5" />,
  pharmacies: <Building2 className="w-5 h-5" />,
  doctors: <Users className="w-5 h-5" />,
  patients: <Users className="w-5 h-5" />,
  prescriptions: <FileText className="w-5 h-5" />,
  tickets: <LifeBuoy className="w-5 h-5" />,
  uptime: <Activity className="w-5 h-5" />,
};

const colorMap: Record<string, string> = {
  mrr: "indigo",
  arr: "indigo",
  pharmacies: "emerald",
  doctors: "blue",
  patients: "blue",
  prescriptions: "violet",
  tickets: "amber",
  uptime: "emerald"
};

export function ExecutiveCards({ cards, onCardClick }: { cards: KPICard[], onCardClick?: (key: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card, idx) => {
        const isClickable = card.to || (onCardClick && card.key === "newPharmacies");
        const content = (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className={cn(
              "bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col relative overflow-hidden group hover-lift card-glow-hover h-full",
              isClickable ? "cursor-pointer" : ""
            )}
          >
            <div className="flex justify-between items-start mb-4 relative z-10">
            <div className={cn(
              "p-3 rounded-xl",
              `bg-${colorMap[card.key]}-50 text-${colorMap[card.key]}-600`
            )}>
              {iconMap[card.key]}
            </div>
            {card.change !== 0 && (
              <div className={cn(
                "px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1",
                card.change > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
              )}>
                {card.change > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {card.change > 0 ? "+" : ""}{card.change}%
              </div>
            )}
          </div>
          
          <div className="relative z-10">
            <h3 className="text-slate-500 font-medium text-sm">{card.label}</h3>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{card.formattedValue}</p>
            </div>
            {card.changeLabel && (
              <p className="text-xs text-slate-400 mt-1">{card.changeLabel}</p>
            )}
          </div>
          
          {/* Sparkline decorative background */}
          <div className="absolute bottom-0 left-0 right-0 h-20 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={card.sparkline.map((val, i) => ({ val, i }))}>
                <Area 
                  type="monotone" 
                  dataKey="val" 
                  stroke={card.change >= 0 ? "#10b981" : "#ef4444"} 
                  fill={card.change >= 0 ? "#10b981" : "#ef4444"} 
                  strokeWidth={2} 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
        );
        
        if (onCardClick && card.key === "newPharmacies") {
          return (
            <div key={card.key} onClick={() => onCardClick(card.key)} className="block h-full outline-none focus:ring-2 focus:ring-slate-400 rounded-2xl cursor-pointer">
              {content}
            </div>
          );
        }

        return card.to ? (
          <Link to={card.to} key={card.key} className="block h-full outline-none focus:ring-2 focus:ring-slate-400 rounded-2xl">
            {content}
          </Link>
        ) : content;
      })}
    </div>
  );
}
