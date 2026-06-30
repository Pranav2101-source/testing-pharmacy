import { Suspense } from "react";
import { Link, useLocation, Outlet } from "react-router-dom";
import { motion } from "framer-motion";
import { Building2, FileText, CreditCard, KeyRound, ArrowLeft, Users, Receipt, FileOutput, User, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard/settings/my-profile",       label: "My Profile",        icon: User       },
  { href: "/dashboard/settings/pharmacy-profile", label: "Pharmacy Profile",  icon: Building2  },
  { href: "/dashboard/settings/documents",        label: "Documents & Legal", icon: FileText   },
  { href: "/dashboard/settings/staff",            label: "Staff Management",  icon: Users      },
  { href: "/dashboard/settings/locations",         label: "Locations",         icon: MapPin     },
  { href: "/dashboard/settings/billing",          label: "Billing",           icon: Receipt    },
  { href: "/dashboard/settings/invoice",          label: "Invoice",           icon: FileOutput },
  { href: "/dashboard/settings/plans",            label: "Plans",             icon: CreditCard },
  { href: "/dashboard/settings/change-password",  label: "Change Password",   icon: KeyRound   },
];

export default function SettingsLayout() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-100 flex flex-col">
        <div className="px-5 pt-6 pb-4 border-b border-slate-100">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-slate-400 hover:text-brand-600 transition-colors text-xs font-medium mb-4 group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            Back to Dashboard
          </Link>
          <p className="text-slate-800 font-bold text-sm">Account & Settings</p>
          <p className="text-slate-400 text-xs mt-0.5">Manage your pharmacy account</p>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                  active
                    ? "text-brand-700 bg-brand-50"
                    : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="settings-indicator"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-brand-500"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon
                  className={cn("w-4 h-4 flex-shrink-0", active ? "text-brand-600" : "text-slate-400")}
                  strokeWidth={active ? 2.2 : 1.8}
                />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <p className="text-[10px] text-slate-300 text-center">Changes are saved per section</p>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden bg-surface-secondary">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
          </div>
        }>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
