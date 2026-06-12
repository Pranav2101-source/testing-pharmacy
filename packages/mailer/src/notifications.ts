import type { Db } from "@pharmacy/database";
import { sendMail } from "./mailer.js";

type NotifyParams = {
  pharmacyId: string;
  type?:      "EMAIL" | "SMS" | "WHATSAPP";
  recipient:  string;
  subject:    string;
  message:    string;
  html?:      string;
};

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
