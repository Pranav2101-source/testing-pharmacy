import type { Db } from "@pharmacy/database";
import { sendMail } from "./mailer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifyParams = {
  pharmacyId: string;
  type?:      "EMAIL" | "SMS" | "WHATSAPP"; // default EMAIL
  recipient:  string;
  subject:    string;
  message:    string; // plain text — stored in DB, used for SMS/WhatsApp later
  html?:      string; // rich body for email
};

// ─── Core dispatcher ──────────────────────────────────────────────────────────
// Never throws. Creates a NotificationLog, attempts delivery, updates status.

export async function sendNotification(db: Db, params: NotifyParams): Promise<void> {
  const type = params.type ?? "EMAIL";

  let logId: string | null = null;

  try {
    const log = await db.notificationLog.create({
      data: {
        pharmacyId: params.pharmacyId,
        type:       type as any,
        recipient:  params.recipient,
        subject:    params.subject,
        message:    params.message,
        status:     "PENDING",
      },
    });
    logId = log.id;
  } catch {
    // DB write failed — skip silently (don't crash caller)
    return;
  }

  try {
    if (type === "EMAIL") {
      await sendMail({
        to:      params.recipient,
        subject: params.subject,
        html:    params.html ?? `<p style="font-family:Arial,sans-serif">${params.message.replace(/\n/g, "<br>")}</p>`,
        text:    params.message,
      });
    }
    // SMS / WhatsApp: drop-in provider here later (MSG91, Twilio, Gupshup)
    // if (type === "SMS")      await sendSms(params.recipient, params.message);
    // if (type === "WHATSAPP") await sendWhatsapp(params.recipient, params.message);

    await db.notificationLog.update({
      where: { id: logId! },
      data:  { status: "SENT", sentAt: new Date() },
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    await db.notificationLog.update({
      where: { id: logId! },
      data:  { status: "FAILED", error: error.slice(0, 500) },
    }).catch(() => {});
  }
}

// ─── In-app notification (bell only — no email/SMS) ───────────────────────────
// Creates a single NotificationLog record immediately visible in the bell.
// One record per pharmacy (broadcast to all logged-in users of that pharmacy).

export async function inAppNotify(
  db:         Db,
  pharmacyId: string,
  params:     { subject: string; message: string },
): Promise<void> {
  try {
    await db.notificationLog.create({
      data: {
        pharmacyId,
        type:      "IN_APP" as any,
        recipient: "in-app",
        subject:   params.subject,
        message:   params.message,
        status:    "SENT",
        sentAt:    new Date(),
      },
    });
  } catch {
    // Never throw — notifications are best-effort
  }
}

// ─── Convenience: notify all active OWNER users of a pharmacy ─────────────────

export async function notifyOwners(
  db:         Db,
  pharmacyId: string,
  params:     { subject: string; message: string; html?: string },
): Promise<void> {
  const owners = await db.user.findMany({
    where:  { pharmacyId, role: "OWNER", isActive: true },
    select: { email: true },
  });

  if (owners.length === 0) return;

  await Promise.allSettled(
    owners.map((o) =>
      sendNotification(db, {
        pharmacyId,
        recipient: o.email,
        subject:   params.subject,
        message:   params.message,
        html:      params.html,
      }),
    ),
  );
}
