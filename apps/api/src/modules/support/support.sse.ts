import type { ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

type SseConn = {
  id:     string;
  userId: string;
  role:   string;
  res:    ServerResponse;
};

const conns = new Map<string, SseConn>();

const AGENT_ROLES = new Set(["SUPPORT_AGENT", "PLATFORM_ADMIN"]);

function writeSafe(res: ServerResponse, chunk: string): void {
  try { res.write(chunk); } catch { /* connection already closed */ }
}

export function registerConn(userId: string, role: string, res: ServerResponse): string {
  const id = randomBytes(8).toString("hex");
  conns.set(id, { id, userId, role, res });
  return id;
}

export function removeConn(id: string): void {
  conns.delete(id);
}

// Notify only connected support agents / platform admins
export function notifyAgents(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const conn of conns.values()) {
    if (AGENT_ROLES.has(conn.role)) writeSafe(conn.res, payload);
  }
}

// Notify everyone (agents + pharmacy users). The frontend filters by ticketId.
export function notifyAll(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const conn of conns.values()) {
    writeSafe(conn.res, payload);
  }
}
