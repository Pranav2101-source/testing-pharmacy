import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ListSkeleton } from "@/components/Skeleton";
import {
  ChevronLeft, ChevronRight, Plus, RefreshCw, Loader2, CalendarDays,
} from "lucide-react";
import { format, addMonths, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import {
  EVENT_CONFIG,
  getCalendarDays,
  groupEventsByDate,
  getMonthRange,
  type CalendarEventType,
} from "@/components/calendar/calendarUtils";
import { useCalendarEvents } from "@/components/calendar/useCalendarEvents";
import { CalendarGrid }       from "@/components/calendar/CalendarGrid";
import { DayPanel }           from "@/components/calendar/DayPanel";
import { CreateEventModal }   from "@/components/calendar/CreateEventModal";

// ── Filter chip ───────────────────────────────────────────────────────────────
function FilterChip({
  type, active, count, onClick,
}: { type: CalendarEventType; active: boolean; count: number; onClick: () => void }) {
  const cfg = EVENT_CONFIG[type];
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all border",
        active
          ? cn(cfg.bg, cfg.text, cfg.border)
          : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
      {count > 0 && (
        <span className={cn(
          "text-[9px] font-black rounded-full px-1 min-w-[14px] text-center",
          active ? "bg-white/60" : "bg-slate-100"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDay,  setSelectedDay]  = useState<Date | null>(() => new Date());
  const [modalOpen,    setModalOpen]    = useState(false);
  const [modalDate,    setModalDate]    = useState<Date | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<CalendarEventType>>(new Set());

  const { from, to } = getMonthRange(currentMonth);
  const { data: events = [], isLoading, refetch } = useCalendarEvents(from, to);

  // Filter + group
  const filteredEvents = useMemo(() =>
    activeFilters.size === 0
      ? events
      : events.filter(e => activeFilters.has(e.type as CalendarEventType)),
    [events, activeFilters]
  );

  const eventsByDate  = useMemo(() => groupEventsByDate(filteredEvents), [filteredEvents]);
  const calendarDays  = useMemo(() => getCalendarDays(currentMonth), [currentMonth]);

  // Events for selected day
  const selectedDayKey    = selectedDay ? format(selectedDay, "yyyy-MM-dd") : null;
  const selectedDayEvents = selectedDayKey ? (eventsByDate.get(selectedDayKey) ?? []) : [];

  // Count per type (for filter chips)
  const countByType = useMemo(() => {
    const map = new Map<CalendarEventType, number>();
    for (const ev of events) {
      const t = ev.type as CalendarEventType;
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return map;
  }, [events]);

  const visibleTypes = useMemo(
    () => [...countByType.keys()].sort(),
    [countByType]
  );

  function toggleFilter(type: CalendarEventType) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) { next.delete(type); } else { next.add(type); }
      return next;
    });
  }

  function openNewEvent(date: Date) {
    setModalDate(date);
    setModalOpen(true);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50/40">

      {/* ── Page header ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
            <CalendarDays className="w-4 h-4 text-blue-600" strokeWidth={1.9} />
          </div>
          <div>
            <h1 className="text-[16px] font-black text-slate-800">Calendar</h1>
            <p className="text-[11px] text-slate-400">Pharmacy events, reminders & alerts</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter chips */}
          {visibleTypes.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {visibleTypes.map(t => (
                <FilterChip
                  key={t}
                  type={t}
                  active={activeFilters.has(t)}
                  count={countByType.get(t) ?? 0}
                  onClick={() => toggleFilter(t)}
                />
              ))}
              {activeFilters.size > 0 && (
                <button
                  onClick={() => setActiveFilters(new Set())}
                  className="text-[11px] text-slate-400 hover:text-slate-600 font-semibold px-2 py-1 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div className="h-4 w-px bg-slate-200" />

          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-blue-600 font-semibold border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:border-blue-300 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>

          <button
            onClick={() => openNewEvent(selectedDay ?? new Date())}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[12px] font-bold transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            New Event
          </button>
        </div>
      </motion.div>

      {/* ── Main content ────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: Calendar grid */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-white border-r border-slate-200">

          {/* Month navigator */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 flex-shrink-0">
            <button
              onClick={() => setCurrentMonth(m => subMonths(m, 1))}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <h2 className="text-[15px] font-black text-slate-800">
                {format(currentMonth, "MMMM yyyy")}
              </h2>
              <button
                onClick={() => { setCurrentMonth(new Date()); setSelectedDay(new Date()); }}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-md transition-colors"
              >
                Today
              </button>
            </div>

            <button
              onClick={() => setCurrentMonth(m => addMonths(m, 1))}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Grid area */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {isLoading ? (
              <ListSkeleton />
            ) : (
              <CalendarGrid
                days={calendarDays}
                currentMonth={currentMonth}
                eventsByDate={eventsByDate}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
              />
            )}

            {/* Month event summary */}
            {!isLoading && events.length > 0 && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  This month — {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[...countByType.entries()].map(([type, count]) => {
                    const cfg = EVENT_CONFIG[type as CalendarEventType];
                    return cfg ? (
                      <span
                        key={type}
                        className={cn("flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border", cfg.bg, cfg.text, cfg.border)}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
                        {count} {cfg.label}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Day panel */}
        <div className="w-80 xl:w-96 flex-shrink-0 bg-white overflow-hidden flex flex-col">
          <DayPanel
            day={selectedDay}
            events={selectedDayEvents}
            onNewEvent={openNewEvent}
          />
        </div>
      </div>

      {/* Create event modal */}
      <CreateEventModal
        open={modalOpen}
        initialDate={modalDate}
        onClose={() => { setModalOpen(false); setModalDate(null); }}
      />
    </div>
  );
}
