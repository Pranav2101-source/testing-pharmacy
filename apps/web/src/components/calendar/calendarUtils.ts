import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, format, isSameDay, isSameMonth, isToday, addMonths, subMonths } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────
export type CalendarEventType =
  | "EXPIRY_ALERT"
  | "CREDIT_DUE"
  | "PO_DELIVERY"
  | "BILL_REMINDER"
  | "STOCK_AUDIT"
  | "LICENSE_RENEWAL"
  | "CUSTOM";

export type CalendarEvent = {
  id:           string;
  title:        string;
  description:  string | null;
  date:         string;
  endDate:      string | null;
  allDay:       boolean;
  type:         CalendarEventType;
  color:        string | null;
  relatedId:    string | null;
  relatedType:  string | null;
  isDone:       boolean;
  isAutomatic:  boolean;
  createdAt:    string | null;
};

// ── Event type config ─────────────────────────────────────────────────────────
export const EVENT_CONFIG: Record<
  CalendarEventType,
  { label: string; dot: string; bg: string; text: string; border: string }
> = {
  EXPIRY_ALERT:    { label: "Expiry Alert",    dot: "bg-red-500",    bg: "bg-red-50",     text: "text-red-700",    border: "border-red-200"    },
  CREDIT_DUE:      { label: "Credit Due",      dot: "bg-amber-500",  bg: "bg-amber-50",   text: "text-amber-800",  border: "border-amber-200"  },
  PO_DELIVERY:     { label: "PO Delivery",     dot: "bg-blue-500",   bg: "bg-blue-50",    text: "text-blue-700",   border: "border-blue-200"   },
  BILL_REMINDER:   { label: "Bill Reminder",   dot: "bg-violet-500", bg: "bg-violet-50",  text: "text-violet-700", border: "border-violet-200" },
  STOCK_AUDIT:     { label: "Stock Audit",     dot: "bg-cyan-500",   bg: "bg-cyan-50",    text: "text-cyan-700",   border: "border-cyan-200"   },
  LICENSE_RENEWAL: { label: "License Renewal", dot: "bg-orange-500", bg: "bg-orange-50",  text: "text-orange-700", border: "border-orange-200" },
  CUSTOM:          { label: "Custom",          dot: "bg-slate-500",  bg: "bg-slate-50",   text: "text-slate-700",  border: "border-slate-200"  },
};

// Which types are manually creatable by the user
export const MANUAL_EVENT_TYPES: CalendarEventType[] = [
  "BILL_REMINDER", "STOCK_AUDIT", "LICENSE_RENEWAL", "CUSTOM",
];

// ── Route map for relatedType deep-links ──────────────────────────────────────
export const RELATED_ROUTE: Record<string, (id: string) => string> = {
  inventory:      (_id) => `/dashboard/inventory`,
  invoice:        (id) => `/dashboard/billing/${id}`,
  purchase_order: (_id) => `/dashboard/purchase`,
};

// ── Calendar grid helpers ─────────────────────────────────────────────────────
export function getCalendarDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end   = endOfWeek(endOfMonth(month),     { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const key = format(new Date(ev.date), "yyyy-MM-dd");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ev);
  }
  return map;
}

export function getMonthRange(month: Date): { from: string; to: string } {
  const from = startOfMonth(subMonths(month, 1));
  const to   = endOfMonth(addMonths(month, 1));
  return {
    from: from.toISOString(),
    to:   to.toISOString(),
  };
}

export { format, isSameDay, isSameMonth, isToday, addMonths, subMonths };
