import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CalendarDays, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { EVENT_CONFIG, MANUAL_EVENT_TYPES, type CalendarEventType } from "./calendarUtils";
import { useCreateCalendarEvent } from "./useCalendarEvents";

type Props = {
  open:        boolean;
  initialDate: Date | null;
  onClose:     () => void;
};

export function CreateEventModal({ open, initialDate, onClose }: Props) {
  const create     = useCreateCalendarEvent();
  const titleRef   = useRef<HTMLInputElement>(null);

  const [title, setTitle]         = useState("");
  const [description, setDesc]    = useState("");
  const [date, setDate]           = useState("");
  const [type, setType]           = useState<CalendarEventType>("CUSTOM");
  const [error, setError]         = useState<string | null>(null);

  // Reset + pre-fill date when modal opens
  useEffect(() => {
    if (!open) return;
    setTitle(""); setDesc(""); setError(null); setType("CUSTOM");
    setDate(initialDate ? format(initialDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"));
    setTimeout(() => titleRef.current?.focus(), 80);
  }, [open, initialDate]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required"); return; }
    if (!date)         { setError("Date is required"); return; }
    setError(null);
    try {
      await create.mutateAsync({
        title:       title.trim(),
        description: description.trim() || undefined,
        date:        new Date(date).toISOString(),
        type,
        allDay:      true,
      });
      onClose();
    } catch {
      setError("Failed to create event. Please try again.");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{   opacity: 0, scale: 0.96,  y: 8  }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed z-50 inset-0 flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto overflow-hidden"
              style={{ boxShadow: "0 24px 64px -12px rgba(0,0,0,0.22), 0 4px 16px -4px rgba(0,0,0,0.10)" }}>

              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                  <CalendarDays className="w-4 h-4 text-blue-600" strokeWidth={1.9} />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-800">New Calendar Event</h2>
                  <p className="text-[11px] text-slate-400">Add a reminder or scheduled task</p>
                </div>
                <button onClick={onClose} className="ml-auto w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-5 space-y-4">

                {/* Event type pills */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Event Type
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {MANUAL_EVENT_TYPES.map(t => {
                      const cfg = EVENT_CONFIG[t];
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setType(t)}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all border",
                            type === t ? cn(cfg.bg, cfg.text, cfg.border, "ring-2 ring-offset-1", cfg.dot.replace("bg-", "ring-")) : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                          )}
                        >
                          <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={titleRef}
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. License renewal due"
                    maxLength={200}
                    className="w-full text-[14px] border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all placeholder-slate-400"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full text-[14px] border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Notes <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDesc(e.target.value)}
                    placeholder="Any details…"
                    rows={2}
                    maxLength={500}
                    className="w-full text-[13px] border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all resize-none placeholder-slate-400"
                  />
                </div>

                {/* Error */}
                {error && (
                  <p className="text-[12px] text-red-600 font-medium bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                    {error}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={create.isPending}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-[13px] font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save Event
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
