"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Plus,
  Search,
  MoreVertical,
  Edit2,
  UserX,
  UserCheck,
  X,
  Eye,
  EyeOff,
  ChevronDown,
  CheckCircle2,
  Crown,
  ShieldCheck,
  ShieldAlert,
  Stethoscope,
  BarChart2,
  Package,
  FileText,
  Settings,
  Lock,
  Phone,
  Mail,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────
type Role = "OWNER" | "PHARMACIST";

interface StaffMember {
  id:          string;
  name:        string;
  email:       string;
  phone:       string;
  role:        Role;
  isActive:    boolean;
  lastLoginAt: string | null;
  createdAt:   string;
}

// ─── Mock data — replace with API calls ──────────────────────
const INIT_STAFF: StaffMember[] = [
  {
    id: "1", name: "Pranav Sharma",   email: "pranav@checkup.com",  phone: "9876543210",
    role: "OWNER",       isActive: true,  lastLoginAt: new Date().toISOString(),                      createdAt: "2025-01-15",
  },
  {
    id: "2", name: "Anjali Singh",    email: "anjali@checkup.com",  phone: "9123456789",
    role: "PHARMACIST",  isActive: true,  lastLoginAt: new Date(Date.now() - 86_400_000).toISOString(), createdAt: "2025-03-10",
  },
  {
    id: "3", name: "Rohit Verma",     email: "rohit@checkup.com",   phone: "9988776655",
    role: "PHARMACIST",  isActive: false, lastLoginAt: new Date(Date.now() - 9 * 86_400_000).toISOString(), createdAt: "2025-06-01",
  },
  {
    id: "4", name: "Priya Mishra",    email: "priya@checkup.com",   phone: "8765432100",
    role: "PHARMACIST",  isActive: true,  lastLoginAt: null,                                          createdAt: "2026-04-22",
  },
];

// ─── Role config ──────────────────────────────────────────────
const ROLE_CONFIG = {
  OWNER: {
    label: "Owner", badgeCls: "bg-purple-50 text-purple-700 border-purple-200",
    iconBg: "bg-purple-100", iconColor: "text-purple-600", icon: Crown,
    description: "Full access to all features, settings, and staff management.",
    permissions: [
      { icon: BarChart2,   label: "Billing & Invoicing",  granted: true  },
      { icon: Package,     label: "Inventory Management", granted: true  },
      { icon: FileText,    label: "Purchase Orders",      granted: true  },
      { icon: Users,       label: "Staff Management",     granted: true  },
      { icon: BarChart2,   label: "Reports & Analytics",  granted: true  },
      { icon: Settings,    label: "Account & Settings",   granted: true  },
      { icon: ShieldCheck, label: "Audit Logs",           granted: true  },
      { icon: Lock,        label: "Delete & Deactivate",  granted: true  },
    ],
  },
  PHARMACIST: {
    label: "Pharmacist", badgeCls: "bg-blue-50 text-blue-700 border-blue-200",
    iconBg: "bg-blue-100", iconColor: "text-blue-600", icon: Stethoscope,
    description: "Day-to-day billing, inventory, and purchase operations.",
    permissions: [
      { icon: BarChart2,   label: "Billing & Invoicing",  granted: true  },
      { icon: Package,     label: "Inventory Management", granted: true  },
      { icon: FileText,    label: "Purchase Orders",      granted: true  },
      { icon: Users,       label: "Staff Management",     granted: false },
      { icon: BarChart2,   label: "Reports & Analytics",  granted: true  },
      { icon: Settings,    label: "Account & Settings",   granted: false },
      { icon: ShieldCheck, label: "Audit Logs",           granted: false },
      { icon: Lock,        label: "Delete & Deactivate",  granted: false },
    ],
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function avatarColor(name: string) {
  const colors = [
    "#3b82f6","#8b5cf6","#06b6d4","#10b981","#f59e0b",
    "#ef4444","#ec4899","#6366f1","#14b8a6","#f97316",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m <  1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Role badge ───────────────────────────────────────────────
function RoleBadge({ role }: { role: Role }) {
  const cfg  = ROLE_CONFIG[role];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold", cfg.badgeCls)}>
      <Icon className="w-3 h-3" strokeWidth={2} />
      {cfg.label}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold",
      active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", active ? "bg-emerald-500" : "bg-slate-400")} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

// ─── Form field ───────────────────────────────────────────────
function FormField({
  label, required, icon: Icon, placeholder, value, onChange,
  type = "text", hint, error, disabled,
}: {
  label: string; required?: boolean; icon: React.ElementType;
  placeholder: string; value: string; onChange: (v: string) => void;
  type?: string; hint?: string; error?: string; disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-600">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-150",
        disabled ? "bg-slate-50 border-slate-200 cursor-not-allowed" :
        error    ? "border-red-400 ring-1 ring-red-200 bg-white"     :
        focused  ? "border-brand-400 ring-1 ring-brand-200 bg-white" :
                   "border-slate-200 hover:border-slate-300 bg-white"
      )}>
        <Icon
          className={cn("w-3.5 h-3.5 flex-shrink-0", focused && !disabled ? "text-brand-500" : "text-slate-400")}
          strokeWidth={1.8}
        />
        <input
          type={type} placeholder={placeholder} value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          disabled={disabled}
          className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none disabled:cursor-not-allowed disabled:text-slate-400"
        />
      </div>
      {error && <p className="text-[10px] text-red-500 font-medium">{error}</p>}
      {hint && !error && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── Row actions menu ─────────────────────────────────────────
function RowActions({ member, onEdit, onToggle }: {
  member: StaffMember; onEdit: () => void; onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={  { opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-slate-100 shadow-card-lg py-1 z-20"
          >
            <button
              onClick={() => { onEdit(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.8} />
              Edit Details
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              onClick={() => { onToggle(); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium transition-colors",
                member.isActive ? "text-red-500 hover:bg-red-50" : "text-emerald-600 hover:bg-emerald-50"
              )}
            >
              {member.isActive
                ? <><UserX     className="w-3.5 h-3.5" strokeWidth={1.8} /> Deactivate</>
                : <><UserCheck className="w-3.5 h-3.5" strokeWidth={1.8} /> Reactivate</>
              }
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Filter select ────────────────────────────────────────────
function FilterSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-3 pr-8 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:border-slate-300 outline-none focus:border-brand-400 cursor-pointer transition-colors"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
    </div>
  );
}

// ─── Add / Edit Drawer ────────────────────────────────────────
function StaffDrawer({ member, onClose, onSave }: {
  member: StaffMember | null;
  onClose: () => void;
  onSave:  (data: Omit<StaffMember, "id" | "lastLoginAt" | "createdAt"> & { password?: string }) => void;
}) {
  const isEdit = member !== null;
  const [name,     setName]     = useState(member?.name  ?? "");
  const [email,    setEmail]    = useState(member?.email ?? "");
  const [phone,    setPhone]    = useState(member?.phone ?? "");
  const [role,     setRole]     = useState<Role>(member?.role ?? "PHARMACIST");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [errors,   setErrors]   = useState<Record<string, string>>({});

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim())                               e.name     = "Name is required";
    if (!email.trim())                              e.email    = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(email))          e.email    = "Enter a valid email";
    if (!isEdit && password.length < 8)             e.password = "Minimum 8 characters";
    if (phone && !/^[6-9]\d{9}$/.test(phone))      e.phone    = "Enter a valid 10-digit number";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    onSave({
      name: name.trim(), email: email.trim().toLowerCase(),
      phone: phone.trim(), role, isActive: member?.isActive ?? true,
      ...(password ? { password } : {}),
    });
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        aria-hidden
      />
      <motion.aside
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <p className="text-sm font-bold text-slate-800">{isEdit ? "Edit Staff Member" : "Add New Staff"}</p>
            <p className="text-xs text-slate-400 mt-0.5">{isEdit ? "Update details below" : "Fill details to create an account"}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Avatar preview */}
          {name && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-sm font-black shadow-inner flex-shrink-0"
                style={{ background: avatarColor(name) }}
              >
                {initials(name)}
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">{name}</p>
                <RoleBadge role={role} />
              </div>
            </motion.div>
          )}

          <FormField label="Full Name" required icon={Users} placeholder="e.g. Anjali Singh" value={name} onChange={setName} error={errors.name} />
          <FormField label="Email Address" required={!isEdit} icon={Mail} placeholder="staff@pharmacy.com" value={email} onChange={setEmail} type="email" disabled={isEdit} hint={isEdit ? "Email cannot be changed after creation" : undefined} error={errors.email} />
          <FormField label="Phone Number" icon={Phone} placeholder="98765 43210" value={phone} onChange={setPhone} type="tel" hint="10-digit Indian mobile number" error={errors.phone} />

          {/* Role selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600">Role <span className="text-red-400">*</span></label>
            <div className="grid grid-cols-2 gap-3">
              {(["OWNER", "PHARMACIST"] as Role[]).map((r) => {
                const cfg  = ROLE_CONFIG[r];
                const Icon = cfg.icon;
                const sel  = role === r;
                return (
                  <button
                    type="button" key={r} onClick={() => setRole(r)}
                    className={cn(
                      "relative flex flex-col items-start gap-2 p-3.5 rounded-xl border-2 text-left transition-all",
                      sel ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-slate-300 bg-white"
                    )}
                  >
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", sel ? "bg-brand-100" : cfg.iconBg)}>
                      <Icon className={cn("w-4 h-4", sel ? "text-brand-600" : cfg.iconColor)} strokeWidth={1.8} />
                    </div>
                    <div>
                      <p className={cn("text-xs font-bold", sel ? "text-brand-700" : "text-slate-700")}>{cfg.label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{r === "OWNER" ? "Full access" : "Billing & ops"}</p>
                    </div>
                    {sel && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-brand-500 absolute top-2.5 right-2.5" strokeWidth={2.2} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Password — add mode only */}
          {!isEdit && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-600">Password <span className="text-red-400">*</span></label>
              <div className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white transition-all",
                errors.password
                  ? "border-red-400 ring-1 ring-red-200"
                  : "border-slate-200 hover:border-slate-300 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200"
              )}>
                <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
                <input
                  type={showPw ? "text" : "password"} placeholder="Min. 8 characters"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 text-sm text-slate-800 placeholder-slate-300 bg-transparent outline-none"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  {showPw ? <EyeOff className="w-3.5 h-3.5" strokeWidth={1.8} /> : <Eye className="w-3.5 h-3.5" strokeWidth={1.8} />}
                </button>
              </div>
              {errors.password && <p className="text-[10px] text-red-500 font-medium">{errors.password}</p>}
              <p className="text-[10px] text-slate-400">Staff will use this to log in. They can change it later.</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit as any}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-[0.97] text-sm font-semibold text-white shadow-card-md transition-all duration-75"
          >
            {isEdit ? "Save Changes" : "Create Staff"}
          </button>
        </div>
      </motion.aside>
    </>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────
function ConfirmDialog({ member, onConfirm, onCancel }: {
  member: StaffMember; onConfirm: () => void; onCancel: () => void;
}) {
  const reactivate = !member.isActive;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
      >
        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4", reactivate ? "bg-emerald-50" : "bg-red-50")}>
          {reactivate
            ? <UserCheck     className="w-6 h-6 text-emerald-500" strokeWidth={1.8} />
            : <AlertTriangle className="w-6 h-6 text-red-400"     strokeWidth={1.8} />
          }
        </div>
        <p className="text-sm font-bold text-slate-800 text-center">{reactivate ? "Reactivate Staff?" : "Deactivate Staff?"}</p>
        <p className="text-xs text-slate-500 text-center mt-2 leading-relaxed">
          {reactivate
            ? <><strong>{member.name}</strong> will regain access to the system.</>
            : <><strong>{member.name}</strong> will lose all access. You can reactivate them later.</>
          }
        </p>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn("flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors", reactivate ? "bg-emerald-500 hover:bg-emerald-600" : "bg-red-500 hover:bg-red-600")}
          >
            {reactivate ? "Yes, Reactivate" : "Yes, Deactivate"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Members Tab ──────────────────────────────────────────────
function MembersTab({ staff, onEdit, onToggle }: {
  staff: StaffMember[]; onEdit: (m: StaffMember) => void; onToggle: (m: StaffMember) => void;
}) {
  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState<Role | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "active" | "inactive">("ALL");

  const filtered = staff.filter((m) => {
    const q = search.toLowerCase();
    return (
      (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.phone.includes(q)) &&
      (roleFilter   === "ALL" || m.role === roleFilter) &&
      (statusFilter === "ALL" || (statusFilter === "active" ? m.isActive : !m.isActive))
    );
  });

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2 flex-1 max-w-xs px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus-within:bg-white focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200 transition-all">
          <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" strokeWidth={1.8} />
          <input
            type="search" placeholder="Search name, email, phone…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-xs text-slate-800 placeholder-slate-400 bg-transparent outline-none"
          />
        </div>
        <FilterSelect value={roleFilter} onChange={(v) => setRoleFilter(v as any)} options={[
          { value: "ALL", label: "All Roles" }, { value: "OWNER", label: "Owner" }, { value: "PHARMACIST", label: "Pharmacist" },
        ]} />
        <FilterSelect value={statusFilter} onChange={(v) => setStatusFilter(v as any)} options={[
          { value: "ALL", label: "All Status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" },
        ]} />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Users className="w-6 h-6 text-slate-300" strokeWidth={1.4} />
            </div>
            <p className="text-sm font-semibold text-slate-500">No staff found</p>
            <p className="text-xs text-slate-300">Try adjusting your search or filters</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 sticky top-0">
                {["Staff Member", "Phone", "Role", "Status", "Last Login", ""].map((h, i) => (
                  <th key={i} className={cn(
                    "px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap",
                    i === 0 ? "text-left" : i === 5 ? "text-right w-12" : "text-center"
                  )}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
                {filtered.map((member) => (
                  <tr
                    key={member.id}
                    className={cn("border-b border-slate-50 hover:bg-slate-50/60 transition-colors", !member.isActive && "opacity-55")}
                  >
                    {/* Member */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-black flex-shrink-0 shadow-inner"
                          style={{ background: avatarColor(member.name) }}
                        >
                          {initials(member.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{member.name}</p>
                          <p className="text-[11px] text-slate-400">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-xs text-slate-600">{member.phone || "—"}</span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <RoleBadge role={member.role} />
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <StatusBadge active={member.isActive} />
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="text-[11px] text-slate-400">{timeAgo(member.lastLoginAt)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <RowActions member={member} onEdit={() => onEdit(member)} onToggle={() => onToggle(member)} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
        <p className="text-xs text-slate-400">
          Showing <strong className="text-slate-600">{filtered.length}</strong> of <strong className="text-slate-600">{staff.length}</strong> members
        </p>
        <p className="text-xs text-slate-400">
          {staff.filter((s) => s.isActive).length} active · {staff.filter((s) => !s.isActive).length} inactive
        </p>
      </div>
    </div>
  );
}

// ─── Roles Tab ────────────────────────────────────────────────
function RolesTab() {
  return (
    <div className="p-6 overflow-y-auto space-y-6">
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">System Roles</p>
        <p className="text-xs text-slate-400 leading-relaxed">
          Checkup Pharmacy has two built-in roles. Roles define what each staff member can access and perform within the system.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {(["OWNER", "PHARMACIST"] as Role[]).map((role, i) => {
          const cfg  = ROLE_CONFIG[role];
          const Icon = cfg.icon;
          return (
            <motion.div
              key={role}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
              className="bg-white rounded-2xl border border-slate-100 shadow-card overflow-hidden"
            >
              {/* Card header */}
              <div className={cn("px-5 py-4 flex items-center gap-3 border-b border-slate-100", role === "OWNER" ? "bg-purple-50/60" : "bg-blue-50/40")}>
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", cfg.iconBg)}>
                  <Icon className={cn("w-5 h-5", cfg.iconColor)} strokeWidth={1.8} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800">{cfg.label}</p>
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", cfg.badgeCls)}>{role}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{cfg.description}</p>
                </div>
              </div>

              {/* Permissions */}
              <div className="p-5 space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Permissions</p>
                {cfg.permissions.map(({ icon: PIcon, label, granted }) => (
                  <div key={label} className="flex items-center gap-2.5">
                    <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0", granted ? "bg-emerald-50" : "bg-slate-100")}>
                      <PIcon className={cn("w-3 h-3", granted ? "text-emerald-600" : "text-slate-400")} style={{ width: 12, height: 12 }} strokeWidth={1.8} />
                    </div>
                    <span className={cn("text-xs flex-1", granted ? "text-slate-700" : "text-slate-400 line-through")}>{label}</span>
                    {granted
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" strokeWidth={2.2} />
                      : <X            className="w-3.5 h-3.5 text-slate-300 flex-shrink-0"   strokeWidth={2}   />
                    }
                  </div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Info note */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
        <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
        <div>
          <p className="text-xs font-semibold text-amber-800">Custom roles are not supported yet</p>
          <p className="text-xs text-amber-600 mt-0.5">You can change a staff member's role by editing their profile. Role-level permissions shown above are enforced by the backend.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function StaffPage() {
  const [staff,         setStaff]         = useState<StaffMember[]>(INIT_STAFF);
  const [activeTab,     setActiveTab]     = useState<"members" | "roles">("members");
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [editTarget,    setEditTarget]    = useState<StaffMember | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<StaffMember | null>(null);

  const stats = {
    total:       staff.length,
    active:      staff.filter((s) => s.isActive).length,
    owners:      staff.filter((s) => s.role === "OWNER").length,
    pharmacists: staff.filter((s) => s.role === "PHARMACIST").length,
  };

  function handleSave(data: Omit<StaffMember, "id" | "lastLoginAt" | "createdAt"> & { password?: string }) {
    if (editTarget) {
      // TODO: PATCH /api/staff/:id
      setStaff((prev) => prev.map((s) => s.id === editTarget.id ? { ...s, ...data } : s));
    } else {
      // TODO: POST /api/staff
      setStaff((prev) => [...prev, { id: String(Date.now()), lastLoginAt: null, createdAt: new Date().toISOString().slice(0, 10), ...data }]);
    }
    setDrawerOpen(false);
    setEditTarget(null);
  }

  function handleToggle(m: StaffMember) {
    // TODO: DELETE /api/staff/:id (deactivate) or PATCH /api/staff/:id { isActive: true }
    setStaff((prev) => prev.map((s) => s.id === m.id ? { ...s, isActive: !s.isActive } : s));
    setConfirmTarget(null);
  }

  const TABS = [
    { id: "members" as const, label: "Staff Members",      count: stats.total },
    { id: "roles"   as const, label: "Roles & Permissions", count: 2          },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-0 bg-white border-b border-slate-100">

        {/* Title + CTA */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-bold text-slate-800">Staff Management</h1>
            <p className="text-sm text-slate-400 mt-0.5">Manage your pharmacy team and their access levels</p>
          </div>
          <button
            onClick={() => { setEditTarget(null); setDrawerOpen(true); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 active:scale-[0.97] text-sm font-bold text-white rounded-xl shadow-card-md transition-all duration-75"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Staff
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: "Total Staff",   value: stats.total,       color: "bg-brand-600"   },
            { label: "Active",        value: stats.active,      color: "bg-emerald-500" },
            { label: "Owners",        value: stats.owners,      color: "bg-purple-500"  },
            { label: "Pharmacists",   value: stats.pharmacists, color: "bg-blue-500"    },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="bg-white rounded-xl border border-slate-100 shadow-card px-4 py-3 flex items-center gap-3"
            >
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", s.color)}>
                <Users className="w-4 h-4 text-white" strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-xl font-black text-slate-800 leading-none">{s.value}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {TABS.map(({ id, label, count }) => (
            <button
              key={id} onClick={() => setActiveTab(id)}
              className={cn(
                "relative flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all rounded-t-xl",
                activeTab === id ? "text-brand-700 bg-brand-50" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              )}
            >
              {label}
              <span className={cn("text-[10px] font-black px-1.5 py-0.5 rounded-full", activeTab === id ? "bg-brand-200 text-brand-700" : "bg-slate-100 text-slate-500")}>
                {count}
              </span>
              {activeTab === id && (
                <motion.span
                  layoutId="staff-tab-indicator"
                  className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-brand-500"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden bg-surface-secondary">
        <AnimatePresence mode="wait">
          {activeTab === "members" ? (
            <motion.div key="members" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="h-full bg-white flex flex-col">
              <MembersTab staff={staff} onEdit={(m) => { setEditTarget(m); setDrawerOpen(true); }} onToggle={(m) => setConfirmTarget(m)} />
            </motion.div>
          ) : (
            <motion.div key="roles" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="h-full overflow-y-auto">
              <RolesTab />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Drawer ──────────────────────────────────────────── */}
      <AnimatePresence>
        {drawerOpen && (
          <StaffDrawer
            member={editTarget}
            onClose={() => { setDrawerOpen(false); setEditTarget(null); }}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>

      {/* ── Confirm dialog ───────────────────────────────────── */}
      <AnimatePresence>
        {confirmTarget && (
          <ConfirmDialog
            member={confirmTarget}
            onConfirm={() => handleToggle(confirmTarget)}
            onCancel={() => setConfirmTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
