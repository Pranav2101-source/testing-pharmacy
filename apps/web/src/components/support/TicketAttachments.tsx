import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Monitor, Square, Upload, Trash2, CheckCircle2, File as FileIcon, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

// ── Screen Recorder Hook ──────────────────────────────────────────────────────

type RecordingState = "idle" | "recording" | "stopped";

export function useScreenRecorder() {
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

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
      });

      recorder.start(1000);
      setState("recording");
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err: unknown) {
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

export function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// ── Attachments Component ─────────────────────────────────────────────────────

type Props = {
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  recorder: ReturnType<typeof useScreenRecorder>;
  disabled?: boolean;
};

export function TicketAttachments({ files, setFiles, recorder, disabled }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    if (disabled) return;
    const validFiles: File[] = [];
    for (const file of Array.from(newFiles)) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`File ${file.name} exceeds 25MB limit.`);
        continue;
      }
      const validTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf", "video/mp4"];
      if (!validTypes.includes(file.type)) {
        toast.error(`File ${file.name} is not a supported format.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length > 0) setFiles((prev) => [...prev, ...validFiles]);
  }, [disabled, setFiles, toast]);

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (disabled) return;
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
  }, [disabled, handleFiles]);

  return (
    <div className="space-y-3">
      <label className="block text-[13px] font-semibold text-slate-700">
        Attachments & Screen Recording
      </label>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative border-2 border-dashed rounded-xl p-6 transition-all text-center flex flex-col items-center justify-center min-h-[140px]",
          disabled ? "opacity-50 cursor-not-allowed border-slate-200" :
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
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[12px] font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            Browse Files
          </button>
          {recorder.state === "idle" && !recorder.blob && (
            <button
              type="button"
              disabled={disabled}
              onClick={recorder.start}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[12px] font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
          disabled={disabled}
          accept="image/png,image/jpeg,image/jpg,application/pdf,video/mp4"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
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
                      disabled={disabled}
                      onClick={recorder.clear}
                      className="px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-red-600 text-[12px] font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => { recorder.clear(); recorder.start(); }}
                      className="px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[12px] font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))}
                    className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                  </button>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
