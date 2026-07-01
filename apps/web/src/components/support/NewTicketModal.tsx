import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, ChevronDown, Loader2, Monitor, Square, Upload, Trash2,
  CheckCircle2, AlertTriangle, File as FileIcon, Clock, ArrowRight, Image as ImageIcon,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = { id: string; name: string };

type Priority = "Low" | "Medium" | "High" | "Urgent";
const PRIORITIES: Priority[] = ["Low", "Medium", "High", "Urgent"];

const PRIORITY_COLORS: Record<Priority, string> = {
  Low:    "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200",
  Medium: "bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200",
  High:   "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200",
  Urgent: "bg-red-50 text-red-700 hover:bg-red-100 border-red-200",
};

const LANGUAGES = [
  { value: "ENGLISH", label: "English" },
  { value: "HINDI",   label: "Hindi / हिंदी" },
] as const;

type DraftState = {
  categoryId:  string;
  customTitle: string;
  language:    "ENGLISH" | "HINDI";
  mobile:      string;
  altMobile:   string;
  description: string;
  priority:    Priority;
};

const DRAFT_KEY = "ticket_draft";
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// ── Screen Recorder ───────────────────────────────────────────────────────────

type RecordingState = "idle" | "recording" | "stopped";

function useScreenRecorder() {
  const [state,     setState]     = useState<RecordingState>("idle");
  const [blob,      setBlob]      = useState<Blob | null>(null);
  const [duration,  setDuration]  = useState(0);
  const mediaRef    = useRef<MediaRecorder | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const chunksRef   = useRef<BlobPart[]>([]);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      streamRef.current  = stream;
      chunksRef.current  = [];

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRef.current   = recorder;

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const recorded = new Blob(chunksRef.current, { type: mimeType });
        setBlob(recorded);
        setState("stopped");
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
      };

      // Stop if user closes the browser's native share dialog
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
      });

      recorder.start(1000);
      setState("recording");
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err: unknown) {
      // User cancelled or permission denied
      if ((err as Error)?.name !== "NotAllowedError") {
        console.error("Screen capture error:", err);
      }
    }
  };

  const stop = () => {
    mediaRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const clear = () => {
    setBlob(null);
    setState("idle");
    setDuration(0);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return { state, blob, duration, start, stop, clear };
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type Props = {
  onClose:  () => void;
  onSaved:  (ticketNumber: string) => void;
};

export function NewTicketModal({ onClose, onSaved }: Props) {
  const toast = useToast();
  const qc    = useQueryClient();

  const [categoryId,   setCategoryId]   = useState("");
  const [customTitle,  setCustomTitle]  = useState("");
  const [language,     setLanguage]     = useState<"ENGLISH" | "HINDI">("ENGLISH");
  const [priority,     setPriority]     = useState<Priority>("Medium");
  const [description,  setDescription]  = useState("");
  const [mobile,       setMobile]       = useState("");
  const [altMobile,    setAltMobile]    = useState("");
  
  const [files,        setFiles]        = useState<File[]>([]);
  const [isDragging,   setIsDragging]   = useState(false);
  const [errors,       setErrors]       = useState<Record<string, string>>({});
  const [successData,  setSuccessData]  = useState<{ id: string; ticketNumber: string } | null>(null);

  const recorder = useScreenRecorder();
  const fileRef  = useRef<HTMLInputElement>(null);
  const formRef  = useRef<HTMLFormElement>(null);
  const isMounted = useRef(false);

  // ── Load Draft ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved) as DraftState;
        if (draft.categoryId) setCategoryId(draft.categoryId);
        if (draft.customTitle) setCustomTitle(draft.customTitle);
        if (draft.language) setLanguage(draft.language);
        if (draft.mobile) setMobile(draft.mobile);
        if (draft.altMobile) setAltMobile(draft.altMobile);
        if (draft.description) setDescription(draft.description);
        if (draft.priority) setPriority(draft.priority);
      }
    } catch {
      // ignore
    }
    isMounted.current = true;
  }, []);

  // ── Save Draft ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMounted.current || successData) return;
    const draft: DraftState = { categoryId, customTitle, language, mobile, altMobile, description, priority };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [categoryId, customTitle, language, mobile, altMobile, description, priority, successData]);

  // ── Paste Screenshot ────────────────────────────────────────────────────
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (successData) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) handleFiles(pastedFiles);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [successData]);

  // ── Fetch categories ────────────────────────────────────────────────────
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["support-categories"],
    queryFn: async () => {
      const res = await api.get<{ data: Category[] }>("/support/categories");
      return res.data.data;
    },
    staleTime: Infinity,
  });

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isOtherCategory  = selectedCategory?.name === "Other";

  // ── File Handling ───────────────────────────────────────────────────────
  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const validFiles: File[] = [];
    for (const file of Array.from(newFiles)) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`File ${file.name} exceeds 25MB limit.`);
        continue;
      }
      // Supported: PNG, JPG, PDF, MP4
      const validTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf", "video/mp4"];
      if (!validTypes.includes(file.type)) {
        toast.error(`File ${file.name} is not a supported format.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length > 0) setFiles((prev) => [...prev, ...validFiles]);
  }, [toast]);

  // ── Submit mutation ─────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      // 1. Create ticket
      // We prepend Priority to description since schema doesn't natively support it yet
      const finalDescription = `[Priority: ${priority}]\n\n${description}`;

      const ticketRes = await api.post<{ data: { id: string; ticketNumber: string } }>(
        "/support/tickets",
        { categoryId, customTitle: isOtherCategory ? customTitle : undefined,
          language, description: finalDescription, mobile,
          altMobile: altMobile || undefined },
      );
      const { id: ticketId, ticketNumber } = ticketRes.data.data;

      // 2. Upload recording if present
      if (recorder.blob) {
        const fd = new FormData();
        fd.append("file", recorder.blob, "screen-recording.webm");
        await api.post(`/support/tickets/${ticketId}/attachments`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      // 3. Upload files if present
      if (files.length > 0) {
        await Promise.all(files.map(file => {
          const fd = new FormData();
          fd.append("file", file, file.name);
          return api.post(`/support/tickets/${ticketId}/attachments`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }));
      }

      return ticketRes.data.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      localStorage.removeItem(DRAFT_KEY);
      setSuccessData(data);
    },
    onError: (err: unknown) => {
      toast.error((err as Error).message ?? "Failed to create ticket");
    },
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!categoryId)                       e.categoryId  = "Please select a category";
    if (isOtherCategory && !customTitle.trim()) e.customTitle = "Please describe the issue";
    if (description.trim().length < 10)    e.description = "At least 10 characters required";
    if (mobile.length !== 10)              e.mobile      = "Enter a valid 10-digit mobile";
    setErrors(e);

    if (Object.keys(e).length > 0) {
      // Scroll to first error
      const firstError = Object.keys(e)[0];
      const el = formRef.current?.querySelector(`[name="${firstError}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validate()) createMutation.mutate();
  }

  const charsRemaining = 2000 - description.length;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !createMutation.isPending && !successData) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1,    opacity: 1, y: 0 }}
        exit={{   scale: 0.95, opacity: 0, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {successData ? (
          // ── SUCCESS STATE ──
          <div className="flex flex-col items-center justify-center p-12 text-center h-96">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", delay: 0.1, bounce: 0.5 }}
              className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6"
            >
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </motion.div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Ticket Submitted Successfully</h2>
            <p className="text-slate-500 mb-6 max-w-sm">
              Your ticket ID is <strong className="text-slate-700">#{successData.ticketNumber}</strong>. 
              Our support team has been notified and will respond within the expected SLA.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  onClose();
                  onSaved(successData.ticketNumber);
                }}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[14px] font-semibold rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          // ── FORM STATE ──
          <>
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between px-6 py-5 border-b border-slate-100 bg-white z-10">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
                  <Monitor className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-[18px] font-bold text-slate-900 leading-tight">Raise Support Ticket</h2>
                  <p className="text-[12px] text-slate-500 mt-0.5">Describe your issue and our team will assist you ASAP.</p>
                </div>
              </div>
              <button
                onClick={onClose}
                disabled={createMutation.isPending}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form ref={formRef} onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Category */}
                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      name="categoryId"
                      value={categoryId}
                      onChange={(e) => { setCategoryId(e.target.value); setErrors((p) => ({ ...p, categoryId: "" })); }}
                      className={cn(
                        "w-full appearance-none border rounded-xl px-3 py-2.5 text-[14px] text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all pr-8",
                        errors.categoryId ? "border-red-300 ring-4 ring-red-50" : "border-slate-200",
                        !categoryId && "text-slate-400"
                      )}
                    >
                      <option value="" disabled>Select the issue category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id} className="text-slate-800">{c.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                  {errors.categoryId && <p className="text-[12px] text-red-500 mt-1.5">{errors.categoryId}</p>}
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Priority</label>
                  <div className="flex flex-wrap gap-2">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg border text-[13px] font-semibold transition-all",
                          priority === p ? PRIORITY_COLORS[p] : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Custom title for "Other" */}
              <AnimatePresence>
                {isOtherCategory && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-1">
                      <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                        Issue Title <span className="text-red-500">*</span>
                      </label>
                      <input
                        name="customTitle"
                        type="text"
                        value={customTitle}
                        onChange={(e) => { setCustomTitle(e.target.value); setErrors((p) => ({ ...p, customTitle: "" })); }}
                        placeholder="Briefly describe the issue"
                        maxLength={200}
                        className={cn(
                          "w-full border rounded-xl px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                          errors.customTitle ? "border-red-300 ring-4 ring-red-50" : "border-slate-200",
                        )}
                      />
                      {errors.customTitle && <p className="text-[12px] text-red-500 mt-1.5">{errors.customTitle}</p>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Language (Segmented Control) */}
                <div>
                  <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                    Preferred Language <span className="text-red-500">*</span>
                  </label>
                  <div className="relative flex p-1 bg-slate-100 rounded-xl">
                    {LANGUAGES.map((l) => {
                      const isActive = language === l.value;
                      return (
                        <button
                          key={l.value}
                          type="button"
                          onClick={() => setLanguage(l.value)}
                          className={cn(
                            "relative flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-colors z-10",
                            isActive ? "text-blue-700" : "text-slate-500 hover:text-slate-700"
                          )}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="language-bg"
                              className="absolute inset-0 bg-white rounded-lg shadow-sm -z-10"
                              transition={{ type: "spring", stiffness: 300, damping: 25 }}
                            />
                          )}
                          {l.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Mobile numbers */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                      Mobile <span className="text-red-500">*</span>
                    </label>
                    <input
                      name="mobile"
                      type="text"
                      value={mobile}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setMobile(val);
                        if (val.length === 10) setErrors((p) => ({ ...p, mobile: "" }));
                      }}
                      placeholder="10-digit number"
                      maxLength={10}
                      className={cn(
                        "w-full border rounded-xl px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                        errors.mobile ? "border-red-300 ring-4 ring-red-50" : "border-slate-200",
                      )}
                    />
                    {errors.mobile && <p className="text-[12px] text-red-500 mt-1.5">{errors.mobile}</p>}
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                      Alt. Mobile
                    </label>
                    <input
                      type="text"
                      value={altMobile}
                      onChange={(e) => setAltMobile(e.target.value.replace(/\D/g, ''))}
                      placeholder="Optional"
                      maxLength={10}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">If primary unreachable</p>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  name="description"
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: "" })); }}
                  placeholder="Include error messages, affected pages, and steps to reproduce the issue..."
                  rows={5}
                  maxLength={2000}
                  className={cn(
                    "w-full border rounded-xl px-3 py-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                    errors.description ? "border-red-300 ring-4 ring-red-50" : "border-slate-200",
                  )}
                />
                <div className="flex items-center justify-between mt-1.5">
                  {errors.description
                    ? <p className="text-[12px] text-red-500">{errors.description}</p>
                    : <p className="text-[11px] text-slate-500">Ctrl+V to paste screenshots anywhere</p>}
                  <span className={cn("text-[11px] font-medium", charsRemaining < 100 ? "text-orange-500" : "text-slate-400")}>
                    {charsRemaining.toLocaleString()} characters remaining
                  </span>
                </div>
              </div>

              {/* Attachments Section */}
              <div className="space-y-3">
                <label className="block text-[13px] font-semibold text-slate-700">
                  Attachments & Screen Recording
                </label>

                {/* Dropzone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    "relative border-2 border-dashed rounded-xl p-6 transition-all text-center flex flex-col items-center justify-center min-h-[140px]",
                    isDragging ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50 hover:bg-slate-100/50"
                  )}
                >
                  <div className="w-12 h-12 bg-white shadow-sm rounded-full flex items-center justify-center mb-3">
                    <Upload className="w-5 h-5 text-blue-600" />
                  </div>
                  <p className="text-[14px] text-slate-700 font-medium mb-1">
                    Drag & Drop or Paste (Ctrl+V)
                  </p>
                  <p className="text-[12px] text-slate-500 mb-4 max-w-[280px]">
                    Supports PNG, JPG, PDF, MP4 (Max 25MB). You can paste screenshots directly from clipboard.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[12px] font-semibold rounded-lg shadow-sm transition-colors"
                    >
                      Browse Files
                    </button>
                    {/* Screen Recorder trigger */}
                    {recorder.state === "idle" && !recorder.blob && (
                      <button
                        type="button"
                        onClick={recorder.start}
                        className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[12px] font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                      >
                        <Monitor className="w-4 h-4 text-blue-600" />
                        Record Screen
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/jpg,application/pdf,video/mp4"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) handleFiles(e.target.files);
                      e.target.value = ''; // Reset so same file can be selected again
                    }}
                  />
                </div>

                {/* Recorder Active State */}
                <AnimatePresence>
                  {(recorder.state === "recording" || recorder.blob) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className={cn(
                        "rounded-xl border p-4 flex items-center justify-between",
                        recorder.state === "recording" ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center shadow-sm",
                            recorder.state === "recording" ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600"
                          )}>
                            <Monitor className="w-5 h-5" />
                          </div>
                          <div>
                            <p className={cn("text-[13px] font-bold", recorder.state === "recording" ? "text-red-700" : "text-emerald-700")}>
                              Screen Recording
                            </p>
                            <p className="text-[12px] text-slate-600 font-medium">
                              {recorder.state === "recording" ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                  Recording {formatDuration(recorder.duration)}
                                </span>
                              ) : (
                                `Recorded (${formatDuration(recorder.duration)})`
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          {recorder.state === "recording" ? (
                            <button
                              type="button"
                              onClick={recorder.stop}
                              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[12px] font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                            >
                              <Square className="w-3 h-3 fill-current" /> Stop
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={recorder.clear}
                                className="px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-red-600 text-[12px] font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => { recorder.clear(); recorder.start(); }}
                                className="px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[12px] font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                              >
                                <Monitor className="w-3.5 h-3.5" /> Retake
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* File List */}
                <AnimatePresence>
                  {files.length > 0 && (
                    <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      {files.map((file, idx) => (
                        <motion.div
                          key={`${file.name}-${idx}`}
                          initial={{ scale: 0.95, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.95, opacity: 0 }}
                          className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl shadow-sm group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                              {file.type.startsWith("image/") ? <ImageIcon className="w-4 h-4 text-slate-500" /> : <FileIcon className="w-4 h-4 text-slate-500" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-slate-700 truncate pr-2" title={file.name}>
                                {file.name}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {(file.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))}
                            className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                          </button>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </form>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-between flex-shrink-0 z-10 sticky bottom-0">
              <button
                type="button"
                onClick={onClose}
                disabled={createMutation.isPending}
                className="px-4 py-2 text-[14px] text-slate-600 hover:text-slate-900 font-semibold transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || (recorder.state === "recording")}
                className={cn(
                  "flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-bold rounded-xl transition-all shadow-md shadow-blue-600/20",
                  createMutation.isPending ? "opacity-70 cursor-not-allowed" : "hover:-translate-y-0.5",
                  (recorder.state === "recording") && "opacity-50 grayscale"
                )}
              >
                {createMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                ) : (
                  <>Submit Ticket <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
