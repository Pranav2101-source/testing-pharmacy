import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/lib/auth";
import { api, API_BASE_URL } from "@/lib/api-client";

const API_BASE = API_BASE_URL;

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
    if (!getAccessToken()) return;

    // `es` is assigned asynchronously, so cleanup has to close whatever exists at
    // the time it runs — and `cancelled` guards the case where the component
    // unmounts while the ticket request is still in flight, which would otherwise
    // open a stream nobody closes.
    let es: EventSource | null = null;
    let cancelled = false;

    async function connect() {
      let ticket: string;
      try {
        // Exchange the access token (sent as a header by the api client) for a
        // short-lived, stream-only ticket. Only the ticket goes in the URL, so the
        // real credential never reaches proxy logs or browser history.
        const res = await api.post<{ success: boolean; data: { ticket: string } }>(
          "/support/stream-ticket",
          {},
        );
        ticket = res.data.data.ticket;
      } catch {
        // Live updates are an enhancement, not a requirement — the ticket list and
        // detail views still poll and refetch normally. Failing quietly here is
        // correct; failing loudly would put an error in front of the user about a
        // feature they did not ask for.
        return;
      }
      if (cancelled) return;

      es = new EventSource(`${API_BASE}/support/stream?ticket=${encodeURIComponent(ticket)}`);
      attach(es);
    }

    function attach(source: EventSource) {
      // A new ticket was created — refresh agent queue + stats
      source.addEventListener("ticket:new", () => {
        void qc.invalidateQueries({ queryKey: ["support-tickets"] });
        void qc.invalidateQueries({ queryKey: ["support-stats"] });
      });

      // A ticket's status changed — refresh list, stats, and the specific ticket if open
      source.addEventListener("ticket:updated", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { ticketId: string };
        void qc.invalidateQueries({ queryKey: ["support-tickets"] });
        void qc.invalidateQueries({ queryKey: ["support-stats"] });
        if (ticketId && data.ticketId === ticketId) {
          void qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
        }
      });

      // A new message was posted — refresh the specific ticket detail if open
      source.addEventListener("message:new", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { ticketId: string };
        if (ticketId && data.ticketId === ticketId) {
          void qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
        }
        // Also nudge the list so unread-style indicators stay accurate
        void qc.invalidateQueries({ queryKey: ["support-tickets"] });
      });
    }

    void connect();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [qc, ticketId]);
}
