import nodemailer from "nodemailer";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  if (!_transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    _transporter = nodemailer.createTransport({
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
  if (!transport) return;
  await transport.sendMail({
    from:    process.env.SMTP_FROM ?? "noreply@checkup.app",
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
    text:    opts.text,
  });
}
