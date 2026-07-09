import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, CornerDownLeft, ArrowUp, ArrowDown,
  Home, ShoppingCart, Receipt, Package2, FlaskConical, Truck, BarChart3,
  Users, Stethoscope, ClipboardList, Banknote, FileText, MapPin, PlusCircle,
  PackagePlus, FilePlus2, Settings, LifeBuoy, Calendar, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";

// ─── Command Palette ──────────────────────────────────────────────────────────
// A global Ctrl/Cmd+K launcher: jump to any page or fire a quick action from
// anywhere in the app, without hunting through menus. Opens on the keyboard
// shortcut or via the "open-command-palette" window event (dispatched by the
// top-nav search box). Keyboard-first: ↑/↓ to move, ↵ to run, Esc to close.

type Role = string;

interface Command {
  id:      string;
  label:   string;
  hint?:   string;
  group:   "Actions" | "Go to";
  icon:    React.ElementType;
  keywords?: string;              // extra searchable text (synonyms)
  to:      string;                // route to navigate to
  roles?:  Role[];                // if set, only these roles see it
}

const COMMANDS: Command[] = [
  // ── Quick actions ──
  { id: "new-bill",   label: "New Bill",            hint: "Start a sale invoice",     group: "Actions", icon: PlusCircle,  keywords: "sell sale pos checkout invoice out", to: "/dashboard/billing/new" },
  { id: "add-stock",  label: "Add Stock",           hint: "Record received stock",    group: "Actions", icon: PackagePlus, keywords: "inventory receive batch grn add", to: "/dashboard/inventory?action=add-stock", roles: ["OWNER", "MANAGER"] },
  { id: "new-po",     label: "New Purchase Order",  hint: "Order from a supplier",    group: "Actions", icon: FilePlus2,   keywords: "purchase buy supplier po reorder in", to: "/dashboard/purchase?create-po=1", roles: ["OWNER", "MANAGER"] },

  // ── Navigation ──
  { id: "home",         label: "Home",          group: "Go to", icon: Home,          keywords: "dashboard overview",        to: "/dashboard" },
  { id: "billing",      label: "Sales / Billing", group: "Go to", icon: Receipt,     keywords: "invoices sales bills pos",  to: "/dashboard/billing" },
  { id: "purchase",     label: "Purchases",     group: "Go to", icon: ShoppingCart,  keywords: "po grn suppliers inward",   to: "/dashboard/purchase" },
  { id: "inventory",    label: "Inventory",     group: "Go to", icon: Package2,      keywords: "stock batches ledger expiry", to: "/dashboard/inventory" },
  { id: "medicines",    label: "Medicines",     group: "Go to", icon: FlaskConical,  keywords: "catalogue drugs products",  to: "/dashboard/medicines" },
  { id: "suppliers",    label: "Suppliers",     group: "Go to", icon: Truck,         keywords: "vendors distributors",      to: "/dashboard/suppliers" },
  { id: "customers",    label: "Customers",     group: "Go to", icon: Users,         keywords: "patients clients",          to: "/dashboard/customers" },
  { id: "doctors",      label: "Doctors",       group: "Go to", icon: Stethoscope,   keywords: "prescribers",               to: "/dashboard/doctors" },
  { id: "prescriptions",label: "Prescriptions", group: "Go to", icon: ClipboardList, keywords: "rx schedule h",             to: "/dashboard/prescriptions" },
  { id: "reports",      label: "Reports",       group: "Go to", icon: BarChart3,     keywords: "gst analytics sales expiry", to: "/dashboard/reports", roles: ["OWNER", "MANAGER"] },
  { id: "dues",         label: "Dues",          group: "Go to", icon: Wallet,        keywords: "money owed payable receivable outstanding credit supplier customer", to: "/dashboard/dues", roles: ["OWNER", "MANAGER"] },
  { id: "cash",         label: "Cash Closure",  group: "Go to", icon: Banknote,      keywords: "day end reconciliation",    to: "/dashboard/cash-closure" },
  { id: "quotations",   label: "Quotations",    group: "Go to", icon: FileText,      keywords: "quotes pricing",            to: "/dashboard/quotations" },
  { id: "locations",    label: "Locations",     group: "Go to", icon: MapPin,        keywords: "shelf rack",                to: "/dashboard/locations", roles: ["OWNER", "MANAGER"] },
  { id: "calendar",     label: "Calendar",      group: "Go to", icon: Calendar,      keywords: "schedule reminders",        to: "/dashboard/calendar" },
  { id: "settings",     label: "Settings",      group: "Go to", icon: Settings,      keywords: "profile pharmacy config account", to: "/dashboard/settings/pharmacy-profile" },
  { id: "support",      label: "Support",       group: "Go to", icon: LifeBuoy,      keywords: "help tickets",              to: "/dashboard/support" },
];

function scoreMatch(cmd: Command, q: string): number {
  if (!q) return 1;
  const hay = `${cmd.label} ${cmd.hint ?? ""} ${cmd.keywords ?? ""}`.toLowerCase();
  const label = cmd.label.toLowerCase();
  if (label.startsWith(q)) return 3;      // best: label prefix
  if (label.includes(q))   return 2;      // label substring
  if (hay.includes(q))     return 1;      // keyword/hint match
  return 0;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open,   setOpen]   = useState(false);
  const [query,  setQuery]  = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  const role = getStoredUser()?.role ?? "";

  const visible = useMemo(
    () => COMMANDS.filter((c) => !c.roles || c.roles.includes(role)),
    [role],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible
      .map((c) => ({ c, s: scoreMatch(c, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [visible, query]);

  // Group results while preserving the score-sorted order within each group.
  const groups = useMemo(() => {
    const order: Command["group"][] = ["Actions", "Go to"];
    return order
      .map((g) => ({ group: g, items: filtered.filter((c) => c.group === g) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  // Flat list mirrors render order — the cursor indexes into this.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const close = useCallback(() => { setOpen(false); setQuery(""); setCursor(0); }, []);

  const run = useCallback((cmd: Command | undefined) => {
    if (!cmd) return;
    close();
    navigate(cmd.to);
  }, [close, navigate]);

  // Global open triggers: Ctrl/Cmd+K and the custom event from the top-nav search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);

  // Focus the input when opened; reset cursor when the result set changes.
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 20); }, [open]);
  useEffect(() => { setCursor(0); }, [query]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter")   { e.preventDefault(); run(flat[cursor]); }
    else if (e.key === "Escape")  { e.preventDefault(); close(); }
  }

  if (!open) return null;

  let idx = -1; // running index across groups for cursor mapping

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm px-4 pt-[12vh]"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onMouseDown={close}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -8 }} transition={{ duration: 0.14 }}
          className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search pages and actions…"
              className="flex-1 text-[15px] text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none"
            />
            <kbd className="text-[10px] font-semibold text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">Esc</kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
            {flat.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-slate-400">
                No matches for “{query}”
              </div>
            ) : groups.map((g) => (
              <div key={g.group}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{g.group}</p>
                {g.items.map((cmd) => {
                  idx++;
                  const active = idx === cursor;
                  const rowIdx = idx;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      data-idx={rowIdx}
                      onMouseEnter={() => setCursor(rowIdx)}
                      onClick={() => run(cmd)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                        active ? "bg-blue-50" : "hover:bg-slate-50",
                      )}
                    >
                      <span className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                        active ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500")}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-semibold text-slate-800 truncate">{cmd.label}</span>
                        {cmd.hint && <span className="block text-[11px] text-slate-400 truncate">{cmd.hint}</span>}
                      </span>
                      {active && <CornerDownLeft className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-400">
            <span className="flex items-center gap-1"><ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> navigate</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" /> open</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
