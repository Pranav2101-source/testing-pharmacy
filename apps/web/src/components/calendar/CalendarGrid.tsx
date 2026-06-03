import { memo } from "react";
import { motion } from "framer-motion";
import { format, isSameDay, isSameMonth, isToday } from "date-fns";
import { cn } from "@/lib/utils";
import { EVENT_CONFIG, type CalendarEvent } from "./calendarUtils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_DOTS = 4; // max event type dots shown per cell

type Props = {
  days:        Date[];
  currentMonth: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  selectedDay:  Date | null;
  onSelectDay:  (day: Date) => void;
};

const DayCell = memo(function DayCell({
  day, currentMonth, events, isSelected, onSelect,
}: {
  day:          Date;
  currentMonth: Date;
  events:       CalendarEvent[];
  isSelected:   boolean;
  onSelect:     () => void;
}) {
  const today       = isToday(day);
  const inMonth     = isSameMonth(day, currentMonth);
  const hasEvents   = events.length > 0;

  // Collect unique event types for dots (max MAX_DOTS)
  const uniqueTypes = [...new Set(events.map(e => e.type))].slice(0, MAX_DOTS);
  const overflow    = events.length > MAX_DOTS ? events.length - MAX_DOTS : 0;

  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onSelect}
      className={cn(
        "relative flex flex-col items-center justify-start pt-1.5 pb-1.5 px-1 rounded-xl",
        "min-h-[64px] w-full transition-all duration-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
        isSelected && "ring-2 ring-blue-500 bg-blue-50",
        !isSelected && hasEvents && inMonth && "hover:bg-slate-50",
        !isSelected && !hasEvents && "hover:bg-slate-50/60",
      )}
    >
      {/* Day number */}
      <span className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold transition-colors flex-shrink-0",
        today   && !isSelected && "bg-blue-600 text-white shadow-sm",
        today   &&  isSelected && "bg-blue-700 text-white shadow-sm",
        !today  &&  isSelected && "text-blue-700",
        !today  && !isSelected &&  inMonth && "text-slate-700",
        !today  && !isSelected && !inMonth && "text-slate-300",
      )}>
        {format(day, "d")}
      </span>

      {/* Event type dots */}
      {hasEvents && (
        <div className="flex flex-wrap gap-0.5 justify-center mt-1 px-0.5">
          {uniqueTypes.map(type => (
            <span
              key={type}
              className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", EVENT_CONFIG[type]?.dot ?? "bg-slate-400")}
            />
          ))}
          {overflow > 0 && (
            <span className="text-[8px] text-slate-400 font-bold leading-none mt-0.5">+{overflow}</span>
          )}
        </div>
      )}

      {/* Event count badge */}
      {events.length > 0 && (
        <span className={cn(
          "absolute top-1 right-1 min-w-[14px] h-3.5 rounded-full text-[8px] font-black flex items-center justify-center px-0.5",
          isSelected ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
        )}>
          {events.length}
        </span>
      )}
    </motion.button>
  );
});

export function CalendarGrid({ days, currentMonth, eventsByDate, selectedDay, onSelectDay }: Props) {
  return (
    <div className="flex flex-col gap-1 select-none">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map(wd => (
          <div key={wd} className="text-[11px] font-bold text-slate-400 uppercase tracking-wider text-center py-1">
            {wd}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const key    = format(day, "yyyy-MM-dd");
          const events = eventsByDate.get(key) ?? [];
          return (
            <DayCell
              key={i}
              day={day}
              currentMonth={currentMonth}
              events={events}
              isSelected={selectedDay ? isSameDay(day, selectedDay) : false}
              onSelect={() => onSelectDay(day)}
            />
          );
        })}
      </div>
    </div>
  );
}
