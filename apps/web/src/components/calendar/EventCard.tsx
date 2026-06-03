import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Trash2, ExternalLink, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  EVENT_CONFIG,
  RELATED_ROUTE,
  type CalendarEvent,
} from "./calendarUtils";
import { useUpdateCalendarEvent, useDeleteCalendarEvent } from "./useCalendarEvents";

export function EventCard({ event }: { event: CalendarEvent }) {
  const navigate   = useNavigate();
  const update     = useUpdateCalendarEvent();
  const remove     = useDeleteCalendarEvent();
  const cfg        = EVENT_CONFIG[event.type];
  const canEdit    = !event.isAutomatic;
  const deepLink   = event.relatedId && event.relatedType
    ? RELATED_ROUTE[event.relatedType]?.(event.relatedId)
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "group flex items-start gap-3 p-3 rounded-xl border transition-all duration-100",
        event.isDone
          ? "opacity-50 bg-slate-50 border-slate-100"
          : cn(cfg.bg, cfg.border),
      )}
    >
      {/* Color dot */}
      <span className={cn("mt-1 w-2 h-2 rounded-full flex-shrink-0", cfg.dot)} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-[13px] font-semibold leading-snug",
          event.isDone ? "line-through text-slate-400" : cfg.text
        )}>
          {event.title}
        </p>

        {event.description && (
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-2">
            {event.description}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {/* Type chip */}
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md",
            cfg.bg, cfg.text
          )}>
            {cfg.label}
          </span>

          {/* Time */}
          {!event.allDay && (
            <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
              <Clock className="w-2.5 h-2.5" />
              {format(new Date(event.date), "hh:mm a")}
            </span>
          )}

          {event.isAutomatic && (
            <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
              AUTO
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Deep-link to source record */}
        {deepLink && (
          <button
            onClick={() => navigate(deepLink)}
            className="w-6 h-6 rounded-md bg-white/80 hover:bg-white flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors"
            title="View source"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        )}

        {/* Mark done (manual only) */}
        {canEdit && !event.isDone && (
          <button
            onClick={() => update.mutate({ id: event.id, isDone: true })}
            disabled={update.isPending}
            className="w-6 h-6 rounded-md bg-white/80 hover:bg-emerald-50 flex items-center justify-center text-slate-400 hover:text-emerald-600 transition-colors"
            title="Mark done"
          >
            <Check className="w-3 h-3" />
          </button>
        )}

        {/* Delete (manual only) */}
        {canEdit && (
          <button
            onClick={() => remove.mutate(event.id)}
            disabled={remove.isPending}
            className="w-6 h-6 rounded-md bg-white/80 hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
