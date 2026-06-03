import { AnimatePresence, motion } from "framer-motion";
import { format, isToday } from "date-fns";
import { Plus, CalendarX } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENT_CONFIG, type CalendarEvent } from "./calendarUtils";
import { EventCard } from "./EventCard";

type Props = {
  day:       Date | null;
  events:    CalendarEvent[];
  onNewEvent: (date: Date) => void;
};

// ── Event type summary dots ───────────────────────────────────────────────────
function TypeSummary({ events }: { events: CalendarEvent[] }) {
  const byType = new Map<string, number>();
  for (const ev of events) byType.set(ev.type, (byType.get(ev.type) ?? 0) + 1);
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...byType.entries()].map(([type, count]) => {
        const cfg = EVENT_CONFIG[type as keyof typeof EVENT_CONFIG];
        if (!cfg) return null;
        return (
          <span
            key={type}
            className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold", cfg.bg, cfg.text)}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
            {count} {cfg.label}
          </span>
        );
      })}
    </div>
  );
}

export function DayPanel({ day, events, onNewEvent }: Props) {
  if (!day) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
        <CalendarX className="w-10 h-10 text-slate-200 mb-3" strokeWidth={1.4} />
        <p className="text-[13px] font-medium text-slate-500">Select a day</p>
        <p className="text-[11px] text-slate-400 mt-1 text-center">
          Click any date to see events
        </p>
      </div>
    );
  }

  const today = isToday(day);

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center text-[15px] font-black flex-shrink-0",
              today
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-700"
            )}>
              {format(day, "d")}
            </div>
            <div>
              <p className="text-[14px] font-bold text-slate-800 leading-tight">
                {format(day, "EEEE")}
                {today && <span className="ml-1.5 text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">Today</span>}
              </p>
              <p className="text-[11px] text-slate-400">{format(day, "d MMMM yyyy")}</p>
            </div>
          </div>

          {events.length > 0 && (
            <div className="mt-2.5">
              <TypeSummary events={events} />
            </div>
          )}
        </div>

        <button
          onClick={() => onNewEvent(day)}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-colors flex-shrink-0 ml-2"
        >
          <Plus className="w-3 h-3" strokeWidth={2.5} />
          Add
        </button>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        <AnimatePresence initial={false}>
          {events.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-12 text-slate-400"
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                <CalendarX className="w-6 h-6 text-slate-300" strokeWidth={1.4} />
              </div>
              <p className="text-[13px] font-medium text-slate-500">No events</p>
              <button
                onClick={() => onNewEvent(day)}
                className="text-[11px] text-blue-600 hover:underline mt-1 font-semibold"
              >
                + Add one
              </button>
            </motion.div>
          ) : (
            events.map(ev => <EventCard key={ev.id} event={ev} />)
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
