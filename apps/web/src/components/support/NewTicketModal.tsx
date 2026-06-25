import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, ChevronDown, Loader2, Monitor, Square, Upload, Trash2,
  CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = { id: string; name: string };

type RecordingState = "idle" | "recording" | "stopped";

// ── Screen Recorder ───────────────────────────────────────────────────────────

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
      // User cancelled or permission denied — stay idle
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

const LANGUAGES = [
  { value: "ENGLISH", label: "English" },
  { value: "HINDI",   label: "Hindi / हिंदी" },
] as const;

export function NewTicketModal({ onClose, onSaved }: Props) {
  const toast = useToast();
  const qc    = useQueryClient();

  const [categoryId,   setCategoryId]   = useState("");
  const [customTitle,  setCustomTitle]  = useState("");
  const [language,     setLanguage]     = useState<"ENGLISH" | "HINDI">("ENGLISH");
  const [description,  setDescription]  = useState("");
  const [mobile,       setMobile]       = useState("");
  const [altMobile,    setAltMobile]    = useState("");
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [errors,       setErrors]       = useState<Record<string, string>>({});

  const recorder = useScreenRecorder();
  const fileRef  = useRef<HTMLInputElement>(null);

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

  // ── Submit mutation ─────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      // 1. Create ticket
      const ticketRes = await api.post<{ data: { id: string; ticketNumber: string } }>(
        "/support/tickets",
        { categoryId, customTitle: isOtherCategory ? customTitle : undefined,
          language, description, mobile,
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

      // 3. Upload screenshot if present
      if (screenshotFile) {
        const fd = new FormData();
        fd.append("file", screenshotFile, screenshotFile.name);
        await api.post(`/support/tickets/${ticketId}/attachments`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      return ticketNumber;
    },
    onSuccess: (ticketNumber) => {
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      onSaved(ticketNumber);
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
    if (!/^[6-9]\d{9}$/.test(mobile))     e.mobile      = "Enter a valid 10-digit mobile";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validate()) createMutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1,    opacity: 1 }}
        exit={{   scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.16 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center">
              <Monitor className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900">Raise Support Ticket</h2>
              <p className="text-[11px] text-slate-400">Our team will respond shortly</p>
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Category */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
              Category <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                value={categoryId}
                onChange={(e) => { setCategoryId(e.target.value); setErrors((p) => ({ ...p, categoryId: "" })); }}
                className={cn(
                  "w-full appearance-none border rounded-xl px-3 py-2.5 text-[13px] text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all pr-8",
                  errors.categoryId ? "border-red-300" : "border-slate-200",
                )}
              >
                <option value="">Select Category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
            {errors.categoryId && <p className="text-[11px] text-red-500 mt-1">{errors.categoryId}</p>}
          </div>

          {/* Custom title for "Other" */}
          <AnimatePresence>
            {isOtherCategory && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{   height: 0,    opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="pt-1">
                  <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                    Issue Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => { setCustomTitle(e.target.value); setErrors((p) => ({ ...p, customTitle: "" })); }}
                    placeholder="Briefly describe the issue"
                    maxLength={200}
                    className={cn(
                      "w-full border rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                      errors.customTitle ? "border-red-300" : "border-slate-200",
                    )}
                  />
                  {errors.customTitle && <p className="text-[11px] text-red-500 mt-1">{errors.customTitle}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Language */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
              Preferred Language <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLanguage(l.value)}
                  className={cn(
                    "flex-1 py-2 px-3 rounded-xl border text-[12px] font-semibold transition-all",
                    language === l.value
                      ? "bg-blue-50 border-blue-400 text-blue-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile numbers */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                Mobile <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => { setMobile(e.target.value); setErrors((p) => ({ ...p, mobile: "" })); }}
                placeholder="10-digit number"
                maxLength={10}
                className={cn(
                  "w-full border rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                  errors.mobile ? "border-red-300" : "border-slate-200",
                )}
              />
              {errors.mobile && <p className="text-[11px] text-red-500 mt-1">{errors.mobile}</p>}
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Alt. Mobile</label>
              <input
                type="tel"
                value={altMobile}
                onChange={(e) => setAltMobile(e.target.value)}
                placeholder="Optional"
                maxLength={10}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: "" })); }}
              placeholder="Describe your issue in detail…"
              rows={4}
              maxLength={2000}
              className={cn(
                "w-full border rounded-xl px-3 py-2.5 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all",
                errors.description ? "border-red-300" : "border-slate-200",
              )}
            />
            <div className="flex items-center justify-between mt-1">
              {errors.description
                ? <p className="text-[11px] text-red-500">{errors.description}</p>
                : <span />}
              <span className="text-[10px] text-slate-400">{description.length}/2000</span>
            </div>
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-2">
              Attachments <span className="text-[11px] font-normal text-slate-400">(optional)</span>
            </label>

            <div className="space-y-2">
              {/* Screen Recording */}
              <div className={cn(
                "rounded-xl border p-3 transition-colors",
                recorder.state === "recording" ? "border-red-300 bg-red-50" :
                recorder.blob               ? "border-emerald-300 bg-emerald-50" :
                                              "border-slate-200 bg-slate-50",
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center",
                      recorder.state === "recording" ? "bg-red-100" :
                      recorder.blob               ? "bg-emerald-100" : "bg-white border border-slate-200",
                    )}>
                      <Monitor className={cn("w-3.5 h-3.5",
                        recorder.state === "recording" ? "text-red-600" :
                        recorder.blob               ? "text-emerald-600" : "text-slate-500",
                      )} />
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-slate-700">Screen Recording</p>
                      <p className="text-[10px] text-slate-400">
                        {recorder.state === "recording"
                          ? `Recording… ${formatDuration(recorder.duration)}`
                          : recorder.blob
                            ? `Recorded (${formatDuration(recorder.duration)})`
                            : "Capture your screen to show the issue"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {recorder.blob && (
                      <button
                        type="button"
                        onClick={recorder.clear}
                        className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 transition-colors"
                      >
                        <Trash2 className="w-3 h-3 text-slate-400 hover:text-red-500" />
                      </button>
                    )}
                    {recorder.state === "idle" && !recorder.blob && (
                      <button
                        type="button"
                        onClick={recorder.start}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded-lg transition-colors"
                      >
                        <Monitor className="w-3 h-3" />
                        Start
                      </button>
                    )}
                    {recorder.state === "recording" && (
                      <button
                        type="button"
                        onClick={recorder.stop}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold rounded-lg transition-colors"
                      >
                        <Square className="w-3 h-3" />
                        Stop
                      </button>
                    )}
                    {recorder.blob && (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Ready
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Screenshot upload */}
              <div className={cn(
                "rounded-xl border p-3 transition-colors",
                screenshotFile ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50",
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center",
                      screenshotFile ? "bg-emerald-100" : "bg-white border border-slate-200",
                    )}>
                      <Upload className={cn("w-3.5 h-3.5", screenshotFile ? "text-emerald-600" : "text-slate-500")} />
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-slate-700">Screenshot</p>
                      <p className="text-[10px] text-slate-400">
                        {screenshotFile ? screenshotFile.name : "Upload a screenshot (PNG, JPG)"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {screenshotFile && (
                      <button
                        type="button"
                        onClick={() => setScreenshotFile(null)}
                        className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 transition-colors"
                      >
                        <Trash2 className="w-3 h-3 text-slate-400" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-semibold rounded-lg transition-colors"
                    >
                      <Upload className="w-3 h-3" />
                      Browse
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setScreenshotFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] text-slate-600 hover:text-slate-800 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-[13px] font-bold rounded-xl transition-colors shadow-sm"
          >
            {createMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" />Submitting…</>
              : "Submit Ticket"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
