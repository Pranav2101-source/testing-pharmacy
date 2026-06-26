import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Loader2, AlertTriangle, Send, Paperclip, X,
  ChevronDown, CheckCircle2, Monitor, FileText, User, Users,
  Building2, Phone, Mail, MapPin, UserPlus, Hash, Globe,
  Calendar, Clock, Tag, ShieldCheck, ExternalLink, Activity
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isSupportStaff, isPlatformAdmin, getStoredUser } from "@/lib/auth";
import { useToast } from "@/hooks/useToast";
import { useSupportStream } from "@/hooks/useSupportStream";
import { TicketStatusBadge, type TicketStatus } from "@/components/support/TicketStatusBadge";
import { TicketActivityTimeline, type TicketActivity } from "@/components/support/TicketActivityTimeline";
import { Combine, Link as LinkIcon, Split, AlertOctagon, Eye, Copy, Users as Followers } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Attachment = {
  id: string; fileName: string; fileUrl: string;
  fileSize: number; mimeType: string; fileType: "IMAGE" | "VIDEO" | "DOCUMENT";
};

type Message = {
  id: string; message: string; createdAt: string;
  sender: { id: string; name: string; role: string };
  attachments: Attachment[];
};

type Ticket = {
  id: string; ticketNumber: string; status: string; language: string;
  description: string; mobile: string; altMobile?: string;
  createdAt: string; resolvedAt?: string; customTitle?: string;
  category: { id: string; name: string };
  raisedBy: { id: string; name: string; role: string; email: string | null; phone: string | null };
  assignedAgent?: { id: string; user: { id: string; name: string } } | null;
  pharmacy: {
    id: string; name: string; phone: string | null; email: string | null;
    address: string | null; city: string | null; state: string | null;
    gstin: string | null; drugLicense: string | null;
  };
  messages: Message[];
  attachments: Attachment[];
};

const ALL_STATUSES: TicketStatus[] = [
  "OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_USER", "RESOLVED", "CLOSED",
];

const SUPPORT_ROLES = ["SUPPORT_AGENT", "PLATFORM_ADMIN"];

// ── Authenticated media hook ──────────────────────────────────────────────────
// The attachment endpoint requires a Bearer token. <img src> and <video src>
// don't send auth headers, so we fetch via axios and create a blob URL.

function useAuthUrl(fileUrl: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl = "";
    const base = import.meta.env.VITE_API_URL?.replace("/api", "") ?? "http://localhost:4000";
    const src  = fileUrl.startsWith("http") ? fileUrl : `${base}${fileUrl}`;

    api.get<Blob>(src, { responseType: "blob" })
      .then((res) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(res.data);
        setBlobUrl(objectUrl);
      })
      .catch(() => { if (alive) setError(true); });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl]);

  return { url: blobUrl, error };
}

// ── Attachment renderers ──────────────────────────────────────────────────────

function MediaImage({ att }: { att: Attachment }) {
  const { url, error } = useAuthUrl(att.fileUrl);

  if (error) return (
    <div className="w-32 h-20 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
      <AlertTriangle className="w-4 h-4 text-slate-400" />
    </div>
  );
  if (!url) return (
    <div className="w-32 h-20 rounded-lg bg-slate-100 border border-slate-200 animate-pulse" />
  );
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-slate-200 hover:opacity-90 transition-opacity">
      <img src={url} alt={att.fileName} className="h-36 w-auto max-w-[280px] object-cover" />
    </a>
  );
}

function MediaVideo({ att }: { att: Attachment }) {
  const { url, error } = useAuthUrl(att.fileUrl);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-900 max-w-sm">
      {error ? (
        <div className="h-28 flex flex-col items-center justify-center gap-2 text-slate-400">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-[11px]">Could not load video</span>
        </div>
      ) : !url ? (
        <div className="h-28 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : (
        <video src={url} controls className="w-full max-h-64" preload="metadata" />
      )}
      <div className="px-3 py-2 flex items-center gap-2 bg-slate-900 border-t border-white/10">
        <Monitor className="w-3 h-3 text-slate-400 flex-shrink-0" />
        <span className="text-[11px] text-slate-300 truncate flex-1">{att.fileName}</span>
        <span className="text-[10px] text-slate-500 flex-shrink-0">
          {(att.fileSize / (1024 * 1024)).toFixed(1)} MB
        </span>
      </div>
    </div>
  );
}

function MediaDoc({ att }: { att: Attachment }) {
  const { url } = useAuthUrl(att.fileUrl);
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] font-medium transition-colors",
        url
          ? "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
          : "bg-slate-50 border-slate-200 text-slate-400 cursor-wait",
      )}
    >
      {url ? <FileText className="w-3.5 h-3.5 text-slate-500" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      <span className="truncate max-w-[180px]">{att.fileName}</span>
    </a>
  );
}

function AttachmentBlock({ att }: { att: Attachment }) {
  if (att.fileType === "IMAGE") return <MediaImage att={att} />;
  if (att.fileType === "VIDEO") return <MediaVideo att={att} />;
  return <MediaDoc att={att} />;
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const me        = getStoredUser();
  const isSupport = SUPPORT_ROLES.includes(msg.sender.role);
  const isMe      = msg.sender.id === me?.id;
  const align     = isMe ? "flex-row-reverse" : "flex-row";

  return (
    <div className={cn("flex gap-3", align)}>
      {/* Avatar */}
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5 shadow-sm",
        isSupport
          ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white"
          : "bg-gradient-to-br from-slate-500 to-slate-700 text-white",
      )}>
        {isSupport
          ? msg.sender.name.charAt(0).toUpperCase()
          : <User className="w-3.5 h-3.5" />}
      </div>

      {/* Bubble */}
      <div className={cn("flex flex-col gap-1 max-w-[68%]", isMe ? "items-end" : "items-start")}>
        {/* Meta */}
        <div className={cn("flex items-center gap-2 px-1", isMe ? "flex-row-reverse" : "flex-row")}>
          <span className="text-[12px] font-semibold text-slate-700">
            {isMe ? "You" : msg.sender.name}
          </span>
          {isSupport && (
            <span className="text-[9px] font-bold tracking-wide uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
              Support
            </span>
          )}
          <span className="text-[10px] text-slate-400">
            {new Date(msg.createdAt).toLocaleString("en-IN", {
              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
            })}
          </span>
        </div>

        {/* Text bubble */}
        {msg.message && (
          <div className={cn(
            "px-4 py-2.5 text-[13px] leading-relaxed shadow-sm",
            isMe
              ? "bg-blue-600 text-white rounded-2xl rounded-tr-sm"
              : "bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-sm",
          )}>
            {msg.message}
          </div>
        )}

        {/* Attachments */}
        {msg.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {msg.attachments.map((a) => <AttachmentBlock key={a.id} att={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Assign / reassign dropdown ────────────────────────────────────────────────

type AgentOption = { id: string; isActive: boolean; user: { name: string } };

function AssignDropdown({
  ticketId,
  currentAgent,
}: {
  ticketId:     string;
  currentAgent?: { id: string; user: { id: string; name: string } } | null;
}) {
  const [open, setOpen] = useState(false);
  const qc    = useQueryClient();
  const toast = useToast();
  const ref   = useRef<HTMLDivElement>(null);
  const isReassign = !!currentAgent;

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOut, { passive: true });
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  const { data: agents = [] } = useQuery<AgentOption[]>({
    queryKey: ["support-agents"],
    queryFn:  async () => (await api.get<{ data: AgentOption[] }>("/support/agents")).data.data,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (agentId: string) =>
      api.patch(`/support/tickets/${ticketId}/assign`, { agentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success(isReassign ? "Ticket reassigned" : "Ticket assigned");
      setOpen(false);
    },
    onError: (err: unknown) => toast.error((err as Error).message),
  });

  const active = agents.filter((a) => a.isActive);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={mutation.isPending}
        className={cn(
          "flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-all border",
          isReassign
            ? "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
            : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100",
        )}
      >
        {mutation.isPending
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <UserPlus className="w-3 h-3" />}
        {isReassign ? currentAgent.user.name : "Assign Agent"}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180",
          isReassign ? "text-slate-400" : "text-amber-500")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl border border-slate-200 shadow-xl z-30 py-1.5 overflow-hidden"
          >
            {isReassign && (
              <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Reassign to
              </p>
            )}
            {active.length === 0 ? (
              <div className="px-3 py-4 flex flex-col items-center gap-2 text-center">
                <Users className="w-5 h-5 text-slate-300" />
                <p className="text-[12px] text-slate-500 font-medium">No active agents</p>
                <Link
                  to="/dashboard/support/agents"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-semibold"
                >
                  Go to Agents page
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            ) : (
              active.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => mutation.mutate(agent.id)}
                  disabled={agent.id === currentAgent?.id}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-[12px] transition-colors text-left",
                    agent.id === currentAgent?.id
                      ? "bg-blue-50 cursor-default"
                      : "hover:bg-slate-50",
                  )}
                >
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                    {agent.user.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-slate-700 flex-1">{agent.user.name}</span>
                  {agent.id === currentAgent?.id && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />
                  )}
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Status selector ───────────────────────────────────────────────────────────

function StatusSelector({ ticketId, current }: { ticketId: string; current: string }) {
  const [open, setOpen] = useState(false);
  const qc    = useQueryClient();
  const toast = useToast();
  const ref   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOut, { passive: true });
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  const mutation = useMutation({
    mutationFn: (status: TicketStatus) =>
      api.patch(`/support/tickets/${ticketId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Status updated");
      setOpen(false);
    },
    onError: (err: unknown) => toast.error((err as Error).message),
  });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={mutation.isPending}
        className="flex items-center gap-2 h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-[12px] font-semibold text-slate-700"
      >
        {mutation.isPending
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <TicketStatusBadge status={current as TicketStatus} />}
        <ChevronDown className={cn("w-3 h-3 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-slate-200 shadow-xl z-30 py-1 overflow-hidden"
          >
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => mutation.mutate(s)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-[12px] hover:bg-slate-50 transition-colors text-left",
                  s === current && "bg-blue-50/50",
                )}
              >
                <TicketStatusBadge status={s} />
                {s === current && <CheckCircle2 className="w-3 h-3 text-blue-500" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Info sidebar (agents only) ────────────────────────────────────────────────

function SidebarRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2">
      <span className="text-[11px] text-slate-400 w-20 flex-shrink-0 pt-0.5 font-medium">{label}</span>
      <span className="text-[12px] text-slate-800 font-medium flex-1 min-w-0 break-words">{value}</span>
    </div>
  );
}

function SidebarSection({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2 px-4 pt-4 pb-1">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{title}</span>
      </div>
      <div className="px-4 pb-3 divide-y divide-slate-50">{children}</div>
    </div>
  );
}

function InfoSidebar({ ticket, isAdmin }: { ticket: Ticket; isAdmin: boolean }) {
  return (
    <aside className="hidden lg:flex flex-col w-[300px] flex-shrink-0 border-l border-slate-200 bg-white overflow-y-auto">

      {/* Ticket details */}
      <SidebarSection title="Ticket Details" icon={Hash}>
        <SidebarRow label="Status"
          value={<TicketStatusBadge status={ticket.status as TicketStatus} />} />
        <SidebarRow label="Category" value={ticket.category.name} />
        <SidebarRow label="Language"
          value={ticket.language === "HINDI" ? "Hindi / हिंदी" : "English"} />
        <SidebarRow label="Created"
          value={new Date(ticket.createdAt).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
          })} />
        {ticket.resolvedAt && (
          <SidebarRow label="Resolved"
            value={new Date(ticket.resolvedAt).toLocaleDateString("en-IN", {
              day: "2-digit", month: "short", year: "numeric",
            })} />
        )}
      </SidebarSection>

      {/* Pharmacy */}
      <SidebarSection title="Pharmacy" icon={Building2}>
        <div className="py-2">
          <p className="text-[13px] font-bold text-slate-900">{ticket.pharmacy.name}</p>
          {(ticket.pharmacy.city || ticket.pharmacy.state) && (
            <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {[ticket.pharmacy.city, ticket.pharmacy.state].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
        {ticket.pharmacy.phone && (
          <SidebarRow label="Phone" value={
            <a href={`tel:${ticket.pharmacy.phone}`} className="text-blue-600 hover:underline">
              {ticket.pharmacy.phone}
            </a>
          } />
        )}
        {ticket.pharmacy.email && (
          <SidebarRow label="Email" value={
            <a href={`mailto:${ticket.pharmacy.email}`} className="text-blue-600 hover:underline truncate block">
              {ticket.pharmacy.email}
            </a>
          } />
        )}
        {ticket.pharmacy.gstin && (
          <SidebarRow label="GSTIN" value={
            <span className="font-mono text-[11px]">{ticket.pharmacy.gstin}</span>
          } />
        )}
        {ticket.pharmacy.drugLicense && (
          <SidebarRow label="Drug Lic." value={ticket.pharmacy.drugLicense} />
        )}
      </SidebarSection>

      {/* Contact */}
      <SidebarSection title="Contact" icon={User}>
        <div className="py-2 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
            {ticket.raisedBy.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-[13px] font-bold text-slate-900">{ticket.raisedBy.name}</p>
            <p className="text-[10px] text-slate-500 capitalize">
              {ticket.raisedBy.role.toLowerCase().replace("_", " ")}
            </p>
          </div>
        </div>
        <SidebarRow label="Mobile" value={
          <a href={`tel:${ticket.mobile}`} className="text-blue-600 hover:underline">
            {ticket.mobile}
          </a>
        } />
        {ticket.altMobile && (
          <SidebarRow label="Alt Mobile" value={ticket.altMobile} />
        )}
        {ticket.raisedBy.email && (
          <SidebarRow label="Email" value={
            <a href={`mailto:${ticket.raisedBy.email}`} className="text-blue-600 hover:underline truncate block">
              {ticket.raisedBy.email}
            </a>
          } />
        )}
      </SidebarSection>

      {/* Assignment */}
      <SidebarSection title="Assignment" icon={ShieldCheck}>
        {ticket.assignedAgent ? (
          <div className="py-2 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
              {ticket.assignedAgent.user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-[12px] font-bold text-slate-900">{ticket.assignedAgent.user.name}</p>
              <p className="text-[10px] text-slate-400">Support Agent</p>
            </div>
          </div>
        ) : (
          <div className="py-2">
            <span className="text-[12px] text-amber-600 font-medium">Unassigned</span>
          </div>
        )}
      </SidebarSection>

      {/* Enterprise Actions */}
      {isAdmin && (
        <SidebarSection title="Enterprise Actions" icon={AlertTriangle}>
          <div className="py-3 flex flex-col gap-2">
            <button disabled className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg opacity-60 cursor-not-allowed transition-all" title="Coming Soon">
              <Combine className="w-3.5 h-3.5" /> Merge Ticket
            </button>
            <button disabled className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg opacity-60 cursor-not-allowed transition-all" title="Coming Soon">
              <LinkIcon className="w-3.5 h-3.5" /> Link Related Ticket
            </button>
            <button disabled className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg opacity-60 cursor-not-allowed transition-all" title="Coming Soon">
              <Split className="w-3.5 h-3.5" /> Split Ticket
            </button>
            <button disabled className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-rose-500 bg-rose-50 border border-rose-200 rounded-lg opacity-60 cursor-not-allowed transition-all" title="Coming Soon">
              <AlertOctagon className="w-3.5 h-3.5" /> Escalate Ticket
            </button>
            <div className="flex gap-2 mt-1">
              <button disabled className="flex-1 flex justify-center items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg opacity-60 cursor-not-allowed" title="Coming Soon">
                <Eye className="w-3 h-3" /> Watch
              </button>
              <button disabled className="flex-1 flex justify-center items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg opacity-60 cursor-not-allowed" title="Coming Soon">
                <Followers className="w-3 h-3" /> Followers
              </button>
            </div>
          </div>
        </SidebarSection>
      )}

    </aside>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TicketDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast    = useToast();
  const qc       = useQueryClient();
  // Read at render time — module-level constants would be stale after login/logout.
  const isAgent  = isSupportStaff();
  const isAdmin  = isPlatformAdmin();

  // SSE: push updates from server (new messages, status changes) without polling
  useSupportStream(id);

  const [message,    setMessage]    = useState("");
  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: ticket, isLoading, error } = useQuery<Ticket>({
    queryKey: ["support-ticket", id],
    queryFn:  async () => (await api.get<{ data: Ticket }>(`/support/tickets/${id}`)).data.data,
    refetchInterval: 120_000, // SSE handles real-time; this is a fallback safety net
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ticket?.messages.length]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [message]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const text = message.trim();
      if (!text && !fileToSend) return;
      if (text) await api.post(`/support/tickets/${id}/messages`, { message: text });
      if (fileToSend) {
        const fd = new FormData();
        fd.append("file", fileToSend, fileToSend.name);
        await api.post(`/support/tickets/${id}/attachments`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
    },
    onSuccess: () => {
      setMessage("");
      setFileToSend(null);
      qc.invalidateQueries({ queryKey: ["support-ticket", id] });
    },
    onError: (err: unknown) => toast.error((err as Error).message ?? "Failed to send"),
  });

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() && !fileToSend) return;
    sendMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
          <p className="text-[13px] text-slate-400">Loading ticket…</p>
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 bg-slate-50">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <div className="text-center">
          <p className="text-[15px] font-semibold text-slate-700">Ticket not found</p>
          <p className="text-[13px] text-slate-400 mt-1">This ticket may have been removed or you don't have access.</p>
        </div>
        <button
          onClick={() => navigate("/dashboard/support")}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-[13px] font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tickets
        </button>
      </div>
    );
  }

  const isClosed = ticket.status === "CLOSED" || ticket.status === "RESOLVED";

  // Mock activity logic for now
  const mockActivities: TicketActivity[] = [
    {
      id: "act_1",
      type: "CREATED",
      actor: ticket.raisedBy,
      createdAt: ticket.createdAt,
      details: "Ticket created",
    },
    ...(ticket.assignedAgent ? [{
      id: "act_2",
      type: "ASSIGNED" as const,
      actor: { id: "system", name: "System", role: "SYSTEM" },
      createdAt: ticket.createdAt,
      details: `Assigned to ${ticket.assignedAgent.user.name}`,
    }] : []),
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f5f7fa]">

      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200 flex-shrink-0 z-10">
        <button
          onClick={() => navigate("/dashboard/support")}
          className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 hover:border-slate-300 transition-all flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-mono text-[13px] font-extrabold text-blue-600 flex-shrink-0 tracking-tight">
            {ticket.ticketNumber}
          </span>
          <span className="text-slate-300 flex-shrink-0">·</span>
          <span className="text-[13px] font-semibold text-slate-700 truncate">
            {ticket.category.name}
            {ticket.customTitle && <span className="text-slate-400 font-normal"> — {ticket.customTitle}</span>}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isAdmin ? (
            <AssignDropdown ticketId={ticket.id} currentAgent={ticket.assignedAgent} />
          ) : ticket.assignedAgent ? (
            <div className="hidden sm:flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-slate-50 text-[12px] text-slate-600 font-medium">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[9px] font-bold">
                {ticket.assignedAgent.user.name.charAt(0).toUpperCase()}
              </div>
              {ticket.assignedAgent.user.name}
            </div>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-amber-200 bg-amber-50 text-[12px] text-amber-700 font-medium">
              Unassigned
            </span>
          )}

          {isAgent ? (
            <StatusSelector ticketId={ticket.id} current={ticket.status} />
          ) : (
            <TicketStatusBadge status={ticket.status as TicketStatus} />
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Thread panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Description */}
          <div className="flex-shrink-0 bg-white border-b border-slate-200 px-5 py-4">
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Tag className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Issue Description
                  </span>
                  <div className="flex items-center gap-2 ml-auto text-[11px] text-slate-400">
                    <Globe className="w-3 h-3" />
                    {ticket.language === "HINDI" ? "Hindi / हिंदी" : "English"}
                    {!isAgent && (
                      <>
                        <span className="text-slate-300">·</span>
                        <Phone className="w-3 h-3" />
                        {ticket.mobile}
                      </>
                    )}
                  </div>
                </div>
                <p className="text-[13px] text-slate-700 leading-relaxed">{ticket.description}</p>
              </div>
            </div>
            {/* Ticket-level attachments */}
            {ticket.attachments.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100">
                {ticket.attachments.map((a) => <AttachmentBlock key={a.id} att={a} />)}
              </div>
            )}
          </div>

          {/* Messages thread */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            {ticket.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <Send className="w-5 h-5 text-slate-300" />
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-semibold text-slate-600">No messages yet</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">Start the conversation below.</p>
                </div>
              </div>
            ) : (
              ticket.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
            )}
            <div ref={bottomRef} />
          </div>

          {/* Activity Timeline (visible to Admins only) */}
          {isAdmin && (
            <div className="flex-shrink-0 bg-slate-50 border-t border-slate-200 px-5 py-4 max-h-[30vh] overflow-y-auto">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-slate-500" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Activity Timeline</span>
              </div>
              <TicketActivityTimeline activities={mockActivities} />
            </div>
          )}

          {/* Compose */}
          {!isClosed ? (
            <div className="flex-shrink-0 bg-white border-t border-slate-200 px-4 py-3">
              {/* File preview */}
              {fileToSend && (
                <div className="flex items-center gap-2 mb-2.5 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl">
                  <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  <span className="text-[12px] text-blue-700 font-medium flex-1 truncate">{fileToSend.name}</span>
                  <span className="text-[10px] text-blue-400">
                    {(fileToSend.size / 1024).toFixed(0)} KB
                  </span>
                  <button onClick={() => setFileToSend(null)} className="text-blue-400 hover:text-blue-600 ml-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <form onSubmit={handleSend} className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-slate-600 hover:border-slate-300 transition-all flex-shrink-0"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*,.pdf"
                  className="hidden"
                  onChange={(e) => setFileToSend(e.target.files?.[0] ?? null)}
                />

                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e); }
                  }}
                  placeholder={`Reply in ${ticket.language === "HINDI" ? "Hindi or English" : "English"}…`}
                  rows={1}
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all min-h-[40px] max-h-[120px]"
                />

                <button
                  type="submit"
                  disabled={sendMutation.isPending || (!message.trim() && !fileToSend)}
                  className="w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-200 flex items-center justify-center transition-colors flex-shrink-0 shadow-sm"
                >
                  {sendMutation.isPending
                    ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                    : <Send className="w-4 h-4 text-white" />}
                </button>
              </form>
              <p className="text-[10px] text-slate-400 mt-1.5 ml-11">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          ) : (
            <div className="flex-shrink-0 bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-[13px] text-slate-500">
                Ticket is <span className="font-semibold">{ticket.status.toLowerCase()}</span> — no further replies.
              </p>
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        {isAgent && <InfoSidebar ticket={ticket} isAdmin={isAdmin} />}
      </div>
    </div>
  );
}
