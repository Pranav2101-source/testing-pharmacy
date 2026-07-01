import React from "react";
import { Activity, XCircle, AlertTriangle, LogIn } from "lucide-react";
import type { AuditKPIs } from "../audit.types";

interface AuditKPICardsProps {
  data?: AuditKPIs;
  isLoading: boolean;
}

export function AuditKPICards({ data, isLoading }: AuditKPICardsProps) {
  const cards = [
    {
      title: "Total Audit Events",
      value: data?.totalEvents ?? 0,
      icon: Activity,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Failed Actions",
      value: data?.failedActions ?? 0,
      icon: XCircle,
      color: "text-red-600",
      bg: "bg-red-50",
    },
    {
      title: "Security Alerts",
      value: data?.securityAlerts ?? 0,
      icon: AlertTriangle,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      title: "Login Events",
      value: data?.loginEvents ?? 0,
      icon: LogIn,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white p-6 rounded-xl border border-surface-200 animate-pulse h-32" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div key={idx} className="bg-white p-6 rounded-xl border border-surface-200 shadow-sm flex items-center gap-4">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${card.bg}`}>
              <Icon className={`w-6 h-6 ${card.color}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-surface-500">{card.title}</p>
              <h3 className="text-2xl font-bold text-surface-900 mt-1">
                {card.value.toLocaleString()}
              </h3>
            </div>
          </div>
        );
      })}
    </div>
  );
}
