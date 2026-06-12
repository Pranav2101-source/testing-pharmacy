import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/lib/auth";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Opens an SSE connection to /support/stream and invalidates react-query caches
 * when ticket events arrive. EventSource reconnects automatically on network drops.
 *
 * @param ticketId — when set, also invalidates the specific ticket detail cache
 *                   on message:new and ticket:updated events for that ticket.
 */
export function useSupportStream(ticketId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    const es = new EventSource(`${API_BASE}/support/stream?token=${encodeURIComponent(token)}`);

    // A new ticket was created — refresh agent queue + stats
    es.addEventListener("ticket:new", () => {
      void qc.invalidateQueries({ queryKey: ["support-tickets"] });
      void qc.invalidateQueries({ queryKey: ["support-stats"] });
    });

    // A ticket's status changed — refresh list, stats, and the specific ticket if open
    es.addEventListener("ticket:updated", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { ticketId: string };
      void qc.invalidateQueries({ queryKey: ["support-tickets"] });
      void qc.invalidateQueries({ queryKey: ["support-stats"] });
      if (ticketId && data.ticketId === ticketId) {
        void qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      }
    });

    // A new message was posted — refresh the specific ticket detail if open
    es.addEventListener("message:new", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { ticketId: string };
      if (ticketId && data.ticketId === ticketId) {
        void qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      }
      // Also nudge the list so unread-style indicators stay accurate
      void qc.invalidateQueries({ queryKey: ["support-tickets"] });
    });

    return () => { es.close(); };
  }, [qc, ticketId]);
}
