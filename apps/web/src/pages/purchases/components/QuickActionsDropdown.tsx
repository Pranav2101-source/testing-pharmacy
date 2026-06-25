import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, ChevronDown, ArrowRight,
  Banknote, FileText, AlertTriangle, BarChart3,
  Lightbulb, FileSpreadsheet, ClipboardList,
  ShieldAlert, Truck, Building2,
  TrendingUp, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import type { Tab, PanelType, QABtn, FullSupplier } from "../types";

export function QuickActionsDropdown({ tab, onTabChange, onPanelOpen, onOpenCreate, pendingApprovals, overdueCount }: {
  tab:              Tab;
  onTabChange:      (t: Tab) => void;
  onPanelOpen:      (p: PanelType) => void;
  onOpenCreate:     () => void;
  pendingApprovals: number;
  overdueCount:     number;
}) {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);
  const navigate        = useNavigate();

  async function exportDistributors() {
    try {
      const { data } = await api.get("/suppliers", { params: { limit: 1000 } });
      const rows: FullSupplier[] = data.data.items ?? [];
      const header = ["Name", "Phone", "Email", "City", "State", "GSTIN", "Drug License", "Credit Limit", "Credit Days", "Payment Terms", "Outstanding"];
      const csvRows = rows.map((s) => [
        s.name, s.phone ?? "", s.email ?? "", s.city ?? "", s.state ?? "",
        s.gstin ?? "", s.dlNumber ?? "", s.creditLimit, s.creditDays, s.paymentTerms ?? "", s.ledgerBalance,
      ]);
      const csv = [header, ...csvRows]
        .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `distributors-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* best-effort export */ }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  const menus: Record<Tab, QABtn[]> = {
    purchase: [
      { icon: Banknote,       label: "Record Payment",    sub: "Log a payment to distributor",   action: () => onPanelOpen("quick-payment"),   iconBg: "bg-emerald-100", iconCls: "text-emerald-600" },
      { icon: FileText,       label: "Raise Credit Note", sub: "Track supplier-issued credit",    action: () => onPanelOpen("credit-note"),     iconBg: "bg-blue-100",    iconCls: "text-blue-600"    },
      { icon: AlertTriangle,  label: "Overdue Bills",     sub: "Bills past payment due date",     action: () => onPanelOpen("overdue-bills"),   badge: overdueCount,  danger: overdueCount > 0, iconBg: "bg-red-100", iconCls: "text-red-600" },
      { icon: BarChart3,      label: "Purchase Analytics",sub: "Monthly spend & cost analysis",   action: () => navigate("/dashboard/reports?tab=purchases"), divider: true, iconBg: "bg-violet-100", iconCls: "text-violet-600" },
    ],
    "gate-inward": [
      { icon: Lightbulb,      label: "Auto Suggest",      sub: "Reorder low-stock medicines",    action: () => onPanelOpen("auto-suggest"),    iconBg: "bg-amber-100",   iconCls: "text-amber-600"   },
      { icon: FileSpreadsheet,label: "Import CSV",        sub: "Bulk-add GRN items from Excel",  action: () => onOpenCreate(),                 iconBg: "bg-teal-100",    iconCls: "text-teal-600"    },
      { icon: ClipboardList,  label: "View POs",          sub: "Go to Purchase Orders tab",      action: () => onTabChange("po"),              divider: true, iconBg: "bg-blue-100", iconCls: "text-blue-600" },
      { icon: Banknote,       label: "Record Payment",    sub: "Log payment after GRN confirm",  action: () => onPanelOpen("quick-payment"),   iconBg: "bg-emerald-100", iconCls: "text-emerald-600" },
    ],
    po: [
      { icon: ShieldAlert,    label: "Pending Approvals", sub: "POs awaiting owner sign-off",    action: () => onPanelOpen("pending-approvals"), badge: pendingApprovals, danger: pendingApprovals > 0, iconBg: "bg-orange-100", iconCls: "text-orange-600" },
      { icon: Lightbulb,      label: "Auto Suggest",      sub: "Reorder recommendations",        action: () => onPanelOpen("auto-suggest"),    divider: true, iconBg: "bg-amber-100", iconCls: "text-amber-600" },
      { icon: Truck,          label: "Go to Gate Inward", sub: "Receive goods against a PO",     action: () => onTabChange("gate-inward"),     iconBg: "bg-amber-100",   iconCls: "text-amber-600"   },
      { icon: Building2,      label: "Manage Distributors",sub:"Add or edit distributors",       action: () => onTabChange("distributors"),    iconBg: "bg-slate-100",   iconCls: "text-slate-600"   },
    ],
    returns: [
      { icon: FileText,       label: "Raise Credit Note", sub: "Track credit from this return",  action: () => onPanelOpen("credit-note"),     iconBg: "bg-blue-100",    iconCls: "text-blue-600"    },
      { icon: Banknote,       label: "Record Payment",    sub: "Settle outstanding balance",     action: () => onPanelOpen("quick-payment"),  divider: true, iconBg: "bg-emerald-100", iconCls: "text-emerald-600" },
      { icon: TrendingUp,     label: "View Purchases",    sub: "See all confirmed invoices",     action: () => onTabChange("purchase"),        iconBg: "bg-violet-100",  iconCls: "text-violet-600"  },
    ],
    distributors: [
      { icon: Zap,            label: "New Purchase Order",sub: "Place a PO with a distributor", action: () => onTabChange("po"),               iconBg: "bg-blue-100",    iconCls: "text-blue-600"    },
      { icon: Banknote,       label: "Record Payment",    sub: "Log a supplier payment",         action: () => onPanelOpen("quick-payment"),  divider: true, iconBg: "bg-emerald-100", iconCls: "text-emerald-600" },
      { icon: AlertTriangle,  label: "Overdue Bills",     sub: "Check outstanding dues",         action: () => onPanelOpen("overdue-bills"),  badge: overdueCount, danger: overdueCount > 0, iconBg: "bg-red-100", iconCls: "text-red-600" },
      { icon: Download,       label: "Export List",       sub: "Download distributor CSV",       action: () => exportDistributors(),           iconBg: "bg-teal-100",    iconCls: "text-teal-600"    },
    ],
  };

  const items        = menus[tab] ?? [];
  const totalAlerts  = (pendingApprovals ?? 0) + (overdueCount ?? 0);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex items-center gap-1.5 border text-[13px] font-semibold h-8 px-3 rounded-lg transition-all",
          open
            ? "bg-slate-100 border-slate-300 text-slate-700 shadow-inner-sm"
            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 shadow-card",
        )}>
        <Zap className="w-3.5 h-3.5 text-amber-500" strokeWidth={2.2} />
        Quick Actions
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform text-slate-400", open && "rotate-180")} />
        {totalAlerts > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center ring-2 ring-white">
            {totalAlerts > 9 ? "9+" : totalAlerts}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1,    y: 0   }}
            exit={{    opacity: 0, scale: 0.95, y: -4  }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-2xl shadow-card-lg z-40 overflow-hidden py-1.5">
            {items.map((item, i) => (
              <div key={i}>
                {item.divider && <div className="my-1 border-t border-slate-100" />}
                <button
                  onClick={() => pick(item.action)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors",
                    item.danger && item.badge && item.badge > 0 ? "hover:bg-red-50" : "",
                  )}>
                  <div className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm",
                    item.danger && item.badge && item.badge > 0 ? "bg-red-100" : (item.iconBg ?? "bg-slate-100"),
                  )}>
                    <item.icon className={cn("w-4 h-4",
                      item.danger && item.badge && item.badge > 0 ? "text-red-600" : (item.iconCls ?? "text-slate-500"))} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[13px] font-bold leading-tight",
                      item.danger && item.badge && item.badge > 0 ? "text-red-700" : "text-slate-800")}>
                      {item.label}
                    </p>
                    <p className="text-[11px] text-slate-400 leading-tight mt-0.5 truncate">{item.sub}</p>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={cn(
                      "ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                      item.danger ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700",
                    )}>
                      {item.badge}
                    </span>
                  )}
                  {!item.badge && <ArrowRight className="w-3 h-3 text-slate-300 ml-auto flex-shrink-0" />}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
