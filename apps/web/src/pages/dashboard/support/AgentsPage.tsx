import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, UserPlus, X, Loader2, AlertTriangle, Eye, EyeOff,
  TicketCheck, Clock, CheckCircle2, XCircle, Mail, Calendar,
  ShieldCheck, Power,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "@/components/Skeleton";
import { useToast } from "@/hooks/useToast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Agent = {
  id:             string;
  isActive:       boolean;
  lastAssignedAt: string | null;
  createdAt:      string;
  user: {
    id:          string;
    name:        string;
    email:       string;
    isActive:    boolean;
    lastLoginAt: string | null;
  };
  _count: { tickets: number };
};

// ── Create agent modal ────────────────────────────────────────────────────────

function CreateAgentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();

  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [errors,   setErrors]   = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () => api.post("/support/agents", { name, email, password }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: unknown) => toast.error((err as Error).message ?? "Failed to create agent"),
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim())                 e.name     = "Name required";
    if (!/\S+@\S+\.\S+/.test(email)) e.email    = "Valid email required";
    if (password.length < 8)          e.password = "Minimum 8 characters";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (validate()) mutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1,    opacity: 1, y: 0 }}
        exit={{   scale: 0.96, opacity: 0, y: 8 }}
        transition={{ duration: 0.15 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <UserPlus className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900">Add Support Agent</h2>
              <p className="text-[11px] text-slate-400">Agent will be assigned to Checkup Support Team</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: "" })); }}
              placeholder="e.g. Rahul Sharma"
              className={cn(
                "w-full border rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                errors.name ? "border-red-300 bg-red-50" : "border-slate-200",
              )}
            />
            {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
              Email Address <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: "" })); }}
              placeholder="agent@checkup.com"
              className={cn(
                "w-full border rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                errors.email ? "border-red-300 bg-red-50" : "border-slate-200",
              )}
            />
            {errors.email && <p className="text-[11px] text-red-500 mt-1">{errors.email}</p>}
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
              Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: "" })); }}
                placeholder="Min. 8 characters"
                className={cn(
                  "w-full border rounded-xl px-3 py-2.5 pr-10 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                  errors.password ? "border-red-300 bg-red-50" : "border-slate-200",
                )}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && <p className="text-[11px] text-red-500 mt-1">{errors.password}</p>}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[13px] text-slate-600 hover:text-slate-800 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-[13px] font-bold rounded-xl transition-colors shadow-sm"
            >
              {mutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</>
                : <><UserPlus className="w-4 h-4" />Create Agent</>}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ── Agent card ────────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  onToggle,
  isToggling,
}: {
  agent:      Agent;
  onToggle:   () => void;
  isToggling: boolean;
}) {
  return (
    <div className={cn(
      "bg-white rounded-2xl border transition-all",
      agent.isActive
        ? "border-slate-200 shadow-sm"
        : "border-slate-100 opacity-60",
    )}>
      {/* Top section */}
      <div className="flex items-start gap-4 p-5">
        {/* Avatar */}
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-[18px] flex-shrink-0 shadow-sm",
          agent.isActive
            ? "bg-gradient-to-br from-blue-500 to-indigo-600"
            : "bg-slate-300",
        )}>
          {agent.user.name.charAt(0).toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-bold text-slate-900">{agent.user.name}</p>
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
              agent.isActive
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-500 border-slate-200",
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full",
                agent.isActive ? "bg-emerald-500" : "bg-slate-400")} />
              {agent.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[12px] text-slate-500">
            <Mail className="w-3 h-3 text-slate-400" />
            {agent.user.email}
          </div>
        </div>

        {/* Toggle */}
        <button
          onClick={onToggle}
          disabled={isToggling}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all border",
            agent.isActive
              ? "border-red-200 text-red-600 hover:bg-red-50 bg-white"
              : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 bg-white",
          )}
        >
          {isToggling
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Power className="w-3.5 h-3.5" />}
          {agent.isActive ? "Deactivate" : "Activate"}
        </button>
      </div>

      {/* Stats strip */}
      <div className="flex items-center border-t border-slate-100 divide-x divide-slate-100">
        <div className="flex-1 flex items-center gap-2 px-4 py-2.5">
          <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <TicketCheck className="w-3 h-3 text-blue-500" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-slate-900 leading-none">{agent._count.tickets}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Tickets Assigned</p>
          </div>
        </div>

        <div className="flex-1 flex items-center gap-2 px-4 py-2.5">
          <div className="w-6 h-6 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
            <Clock className="w-3 h-3 text-slate-400" />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-slate-700 leading-none">
              {agent.lastAssignedAt
                ? new Date(agent.lastAssignedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                : "Never"}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Last Assigned</p>
          </div>
        </div>

        <div className="flex-1 flex items-center gap-2 px-4 py-2.5">
          <div className="w-6 h-6 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
            <Calendar className="w-3 h-3 text-slate-400" />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-slate-700 leading-none">
              {agent.user.lastLoginAt
                ? new Date(agent.user.lastLoginAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                : "Never"}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Last Login</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const toast = useToast();
  const qc    = useQueryClient();

  const [showCreate, setShowCreate]     = useState(false);
  const [togglingId, setTogglingId]     = useState<string | null>(null);

  const { data: agents = [], isLoading, error } = useQuery<Agent[]>({
    queryKey: ["support-agents"],
    queryFn:  async () => (await api.get<{ data: Agent[] }>("/support/agents")).data.data,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/support/agents/${id}`, { isActive }),
    onMutate:  ({ id }) => setTogglingId(id),
    onSettled: ()       => setTogglingId(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-agents"] });
      toast.success("Agent status updated");
    },
    onError: (err: unknown) => toast.error((err as Error).message),
  });

  const activeCount   = agents.filter((a) => a.isActive).length;
  const inactiveCount = agents.length - activeCount;

  return (
    <div className="flex flex-col h-full bg-[#f5f7fa] overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-[16px] font-bold text-slate-900">Support Agents</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {agents.length} total · {activeCount} active · Round-robin assignment
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          Add Agent
        </button>
      </div>

      {/* ── Summary bar ── */}
      {agents.length > 0 && (
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[12px] font-semibold text-slate-700">{activeCount} Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-slate-300" />
            <span className="text-[12px] font-semibold text-slate-500">{inactiveCount} Inactive</span>
          </div>
          <div className="flex items-center gap-2 ml-auto text-[11px] text-slate-400">
            <ShieldCheck className="w-3 h-3" />
            Agents are assigned tickets in round-robin order
          </div>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {isLoading ? (
          <ListSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-600">Failed to load agents</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-5">
            <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Users className="w-10 h-10 text-slate-300" />
            </div>
            <div className="text-center">
              <p className="text-[16px] font-bold text-slate-700">No agents yet</p>
              <p className="text-[13px] text-slate-400 mt-1 max-w-xs">
                Add your first support agent to start handling tickets with round-robin assignment.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-[13px] font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
            >
              <UserPlus className="w-4 h-4" />
              Add First Agent
            </button>
          </div>
        ) : (
          <div className="grid gap-4 max-w-3xl">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isToggling={togglingId === agent.id}
                onToggle={() => toggleMutation.mutate({ id: agent.id, isActive: !agent.isActive })}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Create modal ── */}
      <AnimatePresence>
        {showCreate && (
          <CreateAgentModal
            onClose={() => setShowCreate(false)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ["support-agents"] });
              toast.success("Support agent created successfully");
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
