import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { CalendarEvent } from "./calendarUtils";

// ── Fetch events for a date range ─────────────────────────────────────────────
export function useCalendarEvents(from: string, to: string) {
  return useQuery<CalendarEvent[]>({
    queryKey: ["calendar-events", from, to],
    queryFn:  async () => {
      const { data } = await api.get("/calendar/events", { params: { from, to } });
      return data.data as CalendarEvent[];
    },
    staleTime: 30_000,
  });
}

// ── Today's event count (nav badge) ───────────────────────────────────────────
export function useCalendarTodayCount() {
  return useQuery<number>({
    queryKey: ["calendar-today-count"],
    queryFn:  async () => {
      const { data } = await api.get("/calendar/today-count");
      return (data.data as { count: number }).count;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

// ── Create manual event ───────────────────────────────────────────────────────
export function useCreateCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      title: string; description?: string; date: string;
      type?: string; allDay?: boolean;
    }) => {
      const { data } = await api.post("/calendar/events", body);
      return data.data as CalendarEvent;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      qc.invalidateQueries({ queryKey: ["calendar-today-count"] });
    },
  });
}

// ── Mark done / update ────────────────────────────────────────────────────────
export function useUpdateCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; isDone?: boolean; title?: string; date?: string }) => {
      const { data } = await api.patch(`/calendar/events/${id}`, body);
      return data.data as CalendarEvent;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      qc.invalidateQueries({ queryKey: ["calendar-today-count"] });
    },
  });
}

// ── Delete event ──────────────────────────────────────────────────────────────
export function useDeleteCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/calendar/events/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      qc.invalidateQueries({ queryKey: ["calendar-today-count"] });
    },
  });
}
