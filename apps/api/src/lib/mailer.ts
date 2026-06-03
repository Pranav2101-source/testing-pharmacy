import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
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
    // SMTP not configured — skip silently (logs already captured in NotificationLog)
    return;
  }
  await transport.sendMail({
    from:    env.SMTP_FROM,
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
    text:    opts.text,
  });
}
