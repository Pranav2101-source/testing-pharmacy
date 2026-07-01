import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Calendar, ShieldAlert, BellRing } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

import { PharmacySelector } from "./PharmacySelector";
import { AgentSelector } from "./AgentSelector";
import { TicketPriority, Priority } from "./TicketPriority";
import { TicketDescription } from "./TicketDescription";
import { TicketAttachments, useScreenRecorder } from "./TicketAttachments";

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = { id: string; name: string };

const SLA_OPTIONS = [
  { value: "SLA_4H", label: "4 Hours" },
  { value: "SLA_8H", label: "8 Hours" },
  { value: "SLA_24H", label: "24 Hours" },
  { value: "SLA_48H", label: "48 Hours" },
  { value: "SLA_72H", label: "72 Hours" },
] as const;

type AdminDraftState = {
  subject: string;
  categoryId: string;
  priority: Priority;
  pharmacyId: string;
  assignmentType: "UNASSIGNED" | "ROUND_ROBIN" | "MANUAL";
  agentId: string;
  sla: string;
  dueDate: string;
  description: string;
  internalNote: string;
  notifyAgent: boolean;
  notifyPharmacy: boolean;
};

const DRAFT_KEY = "admin_ticket_draft";

type Props = {
  onClose: () => void;
  onSaved: (ticketNumber: string) => void;
};

export function AdminTicketModal({ onClose, onSaved }: Props) {
  const toast = useToast();
  const qc = useQueryClient();

  // ── State ───────────────────────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [pharmacyId, setPharmacyId] = useState("");
  const [assignmentType, setAssignmentType] = useState<"UNASSIGNED" | "ROUND_ROBIN" | "MANUAL">("ROUND_ROBIN");
  const [agentId, setAgentId] = useState("");
  const [sla, setSla] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  
  const [internalNote, setInternalNote] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyInApp, setNotifyInApp] = useState(true);

  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const recorder = useScreenRecorder();
  const isMounted = useRef(false);
  const isSubjectManuallyEdited = useRef(false);

  // ── Fetch queries for auto-generation ───────────────────────────────────
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["support-categories"],
    queryFn: async () => {
      const res = await api.get<{ data: Category[] }>("/support/categories");
      return res.data.data;
    },
    staleTime: Infinity,
  });

  const { data: pharmacies = [] } = useQuery<{id: string; name: string}[]>({
    queryKey: ["admin-pharmacies"],
    queryFn: async () => {
      const res = await api.get<{ data: {id: string; name: string}[] }>("/support/pharmacies");
      return res.data.data;
    },
  });

  // ── Auto-generate Subject ───────────────────────────────────────────────
  useEffect(() => {
    if (!categoryId || !pharmacyId) return;
    if (isSubjectManuallyEdited.current) return; // Never overwrite if manually edited

    const categoryName = categories.find((c) => c.id === categoryId)?.name || "Issue";
    const pharmacyName = pharmacies.find((p) => p.id === pharmacyId)?.name || "Pharmacy";
    setSubject(`${categoryName} - ${pharmacyName}`);
  }, [categoryId, pharmacyId, categories, pharmacies]);

  // ── Draft Handling ──────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved) as AdminDraftState;
        if (draft.subject) setSubject(draft.subject);
        if (draft.categoryId) setCategoryId(draft.categoryId);
        if (draft.priority) setPriority(draft.priority);
        if (draft.pharmacyId) setPharmacyId(draft.pharmacyId);
        if (draft.assignmentType) setAssignmentType(draft.assignmentType);
        if (draft.agentId) setAgentId(draft.agentId);
        if (draft.sla) setSla(draft.sla);
        if (draft.dueDate) setDueDate(draft.dueDate);
        if (draft.description) setDescription(draft.description);
        // Notes and notification prefs kept separate from payload, can still be drafted
        if (draft.internalNote) setInternalNote(draft.internalNote);
      }
    } catch {
      // ignore
    }
    isMounted.current = true;
  }, []);

  const saveDraft = () => {
    const draft: AdminDraftState = {
      subject, categoryId, priority, pharmacyId, assignmentType, agentId, sla, dueDate, description, internalNote, notifyAgent: notifyEmail, notifyPharmacy: notifyInApp
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    toast.success("Draft saved locally");
  };

  useEffect(() => {
    if (!isMounted.current) return;
    const draft: AdminDraftState = {
      subject, categoryId, priority, pharmacyId, assignmentType, agentId, sla, dueDate, description, internalNote, notifyAgent: notifyEmail, notifyPharmacy: notifyInApp
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [subject, categoryId, priority, pharmacyId, assignmentType, agentId, sla, dueDate, description, internalNote, notifyEmail, notifyInApp]);


  // ── Submit ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      // Note: internalNote is currently kept in component state only per user instructions 
      // since backend persistence isn't fully ready. It is NOT mixed with description.

      // 1. Create ticket via our single role-aware endpoint
      const ticketRes = await api.post<{ data: { id: string; ticketNumber: string } }>(
        "/support/tickets",
        {
          categoryId,
          customTitle: subject, // Using subject for customTitle
          priority,
          pharmacyId,
          assignmentType,
          agentId: assignmentType === "MANUAL" ? agentId : undefined,
          sla: sla || undefined,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
          description,
        }
      );
      
      const { id: ticketId, ticketNumber } = ticketRes.data.data;

      // 2. Upload attachments
      if (recorder.blob) {
        const fd = new FormData();
        fd.append("file", recorder.blob, "screen-recording.webm");
        await api.post(`/support/tickets/${ticketId}/attachments`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      }

      if (files.length > 0) {
        await Promise.all(files.map(file => {
          const fd = new FormData();
          fd.append("file", file, file.name);
          return api.post(`/support/tickets/${ticketId}/attachments`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        }));
      }

      return ticketNumber;
    },
    onSuccess: (ticketNumber) => {
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      localStorage.removeItem(DRAFT_KEY);
      onSaved(ticketNumber);
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message ?? "Failed to create ticket");
    },
  });

  function validate() {
    const e: Record<string, string> = {};
    if (!subject.trim()) e.subject = "Subject is required";
    if (!categoryId) e.categoryId = "Category is required";
    if (!pharmacyId) e.pharmacyId = "Pharmacy is required";
    if (description.trim().length < 10) e.description = "Description must be at least 10 characters";
    
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validate()) createMutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !createMutation.isPending) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.98, opacity: 0, y: 10 }}
        animate={{ scale: 1,    opacity: 1, y: 0 }}
        exit={{   scale: 0.98, opacity: 0, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between px-8 py-5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center shadow-sm">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-[18px] font-bold text-slate-900 leading-tight">Create Support Ticket</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">Admin Helpdesk • Create a ticket for a pharmacy or an internal issue.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={createMutation.isPending}
            className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body - Two Columns */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col lg:flex-row min-h-0 bg-white">
          
          {/* Left Column - Main Details */}
          <div className="flex-1 p-8 space-y-6 lg:border-r border-slate-100 flex flex-col">
            
            <div className="grid grid-cols-2 gap-6">
              <PharmacySelector value={pharmacyId} onChange={(v) => { setPharmacyId(v); setErrors(p => ({...p, pharmacyId: ""})) }} error={errors.pharmacyId} />
              
              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => { setCategoryId(e.target.value); setErrors(p => ({...p, categoryId: ""})) }}
                  className={cn(
                    "w-full border rounded-xl px-4 py-2.5 text-[14px] focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all bg-white",
                    errors.categoryId ? "border-red-300 ring-4 ring-red-50" : "border-slate-200",
                    !categoryId && "text-slate-500"
                  )}
                >
                  <option value="" disabled>Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {errors.categoryId && <p className="text-[12px] text-red-500 mt-1.5">{errors.categoryId}</p>}
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Ticket Subject <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => { 
                  setSubject(e.target.value); 
                  isSubjectManuallyEdited.current = true;
                  setErrors(p => ({...p, subject: ""})) 
                }}
                placeholder="Login Issue - ABC Pharmacy"
                maxLength={200}
                className={cn(
                  "w-full border rounded-xl px-4 py-2.5 text-[14px] focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all font-medium text-slate-900",
                  errors.subject ? "border-red-300 ring-4 ring-red-50" : "border-slate-200"
                )}
              />
              {errors.subject && <p className="text-[12px] text-red-500 mt-1.5">{errors.subject}</p>}
            </div>

            <TicketDescription value={description} onChange={(v) => { setDescription(v); setErrors(p => ({...p, description: ""})) }} error={errors.description} />
            
            <TicketAttachments files={files} setFiles={setFiles} recorder={recorder} />

          </div>

          {/* Right Column - Admin Meta */}
          <div className="w-full lg:w-[380px] p-8 space-y-8 bg-slate-50/50">
            
            <TicketPriority value={priority} onChange={setPriority} />

            <AgentSelector 
              assignmentType={assignmentType} 
              agentId={agentId} 
              onChange={(type, id) => {
                setAssignmentType(type);
                setAgentId(id);
              }} 
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">SLA Level</label>
                <select
                  value={sla}
                  onChange={(e) => setSla(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[13px] focus:ring-2 focus:ring-blue-100 bg-white"
                >
                  <option value="">Standard SLA</option>
                  {SLA_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Due Date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-[13px] focus:ring-2 focus:ring-blue-100 bg-white"
                  />
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200">
              <label className="flex items-center gap-2 text-[14px] font-bold text-slate-900 mb-4">
                <BellRing className="w-4 h-4 text-slate-400" /> Notifications & Notes
              </label>
              
              <div className="space-y-3 mb-5">
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-[13px] font-medium text-slate-700">Email Notification</span>
                </label>
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={notifyInApp} onChange={(e) => setNotifyInApp(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-[13px] font-medium text-slate-700">In-App Notification</span>
                </label>
                <label className="flex items-center gap-3 opacity-50 cursor-not-allowed" title="Coming Soon">
                  <input type="checkbox" disabled checked={false} className="w-4 h-4 rounded border-slate-300 text-slate-400" />
                  <span className="text-[13px] font-medium text-slate-500">SMS Notification</span>
                </label>
                <label className="flex items-center gap-3 opacity-50 cursor-not-allowed" title="Coming Soon">
                  <input type="checkbox" disabled checked={false} className="w-4 h-4 rounded border-slate-300 text-slate-400" />
                  <span className="text-[13px] font-medium text-slate-500">WhatsApp Notification</span>
                </label>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Internal Note</label>
                <textarea
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Private notes (pharmacy will not see this)"
                  rows={4}
                  className="w-full border border-yellow-200 bg-yellow-50/50 rounded-xl px-3 py-2.5 text-[13px] focus:ring-2 focus:ring-yellow-200 focus:border-yellow-400 transition-all resize-none"
                />
              </div>
            </div>

          </div>
        </form>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-slate-200 bg-white flex items-center justify-between flex-shrink-0 z-10">
          <button
            type="button"
            onClick={onClose}
            disabled={createMutation.isPending}
            className="px-5 py-2.5 text-[14px] text-slate-600 hover:text-slate-900 font-semibold transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          
          <div className="flex gap-3">
            <button
              type="button"
              onClick={saveDraft}
              disabled={createMutation.isPending}
              className="px-6 py-2.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-[14px] font-semibold rounded-xl transition-all"
            >
              Save Draft
            </button>
            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending || (recorder.state === "recording")}
              className={cn(
                "px-8 py-2.5 bg-slate-900 hover:bg-black text-white text-[14px] font-bold rounded-xl transition-all shadow-md",
                createMutation.isPending ? "opacity-70 cursor-not-allowed" : "hover:-translate-y-0.5",
                (recorder.state === "recording") && "opacity-50 grayscale"
              )}
            >
              {createMutation.isPending ? (
                <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</span>
              ) : (
                "Create Ticket"
              )}
            </button>
          </div>
        </div>

      </motion.div>
    </div>
  );
}
