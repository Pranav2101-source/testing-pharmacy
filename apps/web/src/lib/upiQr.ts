// ─── UPI deep-link helper ─────────────────────────────────────────────────────
// Builds the standard UPI intent URL (NPCI spec) that the invoice QR encodes, so
// any UPI app resolves a "pay this pharmacy" scan. Rendered as a synchronous SVG
// by <QRCodeSVG> (qrcode.react) — no async, so it is always on the page when
// window.print() fires. Amount / note are added only when supplied.

export type UpiParams = {
  /** Payee VPA, e.g. "pharmacy@upi". Required — no VPA, no QR. */
  pa: string;
  /** Payee name shown in the UPI app. */
  pn?: string;
  /** Amount in rupees. Omitted for an open "enter amount" QR. */
  am?: number;
  /** Transaction note, e.g. the invoice number. */
  tn?: string;
};

export function buildUpiUri({ pa, pn, am, tn }: UpiParams): string {
  const params = new URLSearchParams();
  params.set("pa", pa);
  if (pn) params.set("pn", pn);
  if (am != null && am > 0) {
    params.set("am", am.toFixed(2));
    params.set("cu", "INR");
  }
  if (tn) params.set("tn", tn);
  // UPI apps choke on "+" for spaces — normalise to %20.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}
