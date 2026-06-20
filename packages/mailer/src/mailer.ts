import { createTransport } from "nodemailer";
import type { Transporter } from "nodemailer";

let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  if (!_transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    _transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return _transporter;
}

export async function sendMail(opts: {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    // SMTP credentials not configured. In production this means password-reset
    // emails and other transactional mail are silently dropped. Set SMTP_HOST,
    // SMTP_USER, and SMTP_PASS to enable email delivery.
    console.warn(`[mailer] SMTP not configured — skipping email to ${opts.to}: "${opts.subject}"`);
    return;
  }
  try {
    await transport.sendMail({
      from:    process.env.SMTP_FROM ?? "noreply@checkup.app",
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    });
  } catch (err) {
    console.error(`[mailer] sendMail failed — to: ${opts.to}, subject: "${opts.subject}"`, err);
    throw err;
  }
}
