// ─── Deposit / refund voucher ─────────────────────────────────────────────────
//
// A customer who hands over money against no bill still needs a piece of paper
// saying so. This builds that slip and prints it.
//
// Deliberately NOT part of the invoice print pipeline (`invoiceRendererFor` and its
// four layouts). A voucher is not a bill: it has no line items, no GST, and no
// invoice number, and running it through a renderer built to satisfy tax-invoice
// rules would mean either fabricating those fields or teaching every layout that
// they can be absent. This is the same standalone-builder shape as poPrint.ts.

export type VoucherPharmacy = {
  name: string;
  address?: string | null;
  phone?: string | null;
  drugLicense?: string | null;
  gstin?: string | null;
};

export type VoucherEntry = {
  /** "ADV-2026-00001" — what the customer quotes back when asking about the money. */
  entryNumber: string | null;
  kind: "ADVANCE" | "REFUND";
  amount: number;
  paymentMode: string | null;
  reference?: string | null;
  notes?: string | null;
  entryAt: string;
  customerName: string;
  customerPhone?: string | null;
  /** Balances after this entry, so the slip answers "what do I have left" on its own. */
  advanceBalanceAfter: number;
  duesBalanceAfter: number;
};

function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function row(label: string, value: string): string {
  return `<tr><td class="k">${escHtml(label)}</td><td class="v">${escHtml(value)}</td></tr>`;
}

export function buildVoucherHtml(entry: VoucherEntry, pharmacy: VoucherPharmacy): string {
  const isRefund = entry.kind === "REFUND";
  const title = isRefund ? "Refund Voucher" : "Advance Receipt";
  const moneyLabel = isRefund ? "Amount refunded" : "Amount received";

  const rows = [
    row("Date", fmtDateTime(entry.entryAt)),
    entry.entryNumber ? row("Voucher no.", entry.entryNumber) : "",
    row("Received from", entry.customerName),
    entry.customerPhone ? row("Phone", entry.customerPhone) : "",
    entry.paymentMode ? row("Mode", entry.paymentMode) : "",
    entry.reference ? row("Reference", entry.reference) : "",
    entry.notes ? row("Note", entry.notes) : "",
  ].join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escHtml(title)} ${escHtml(entry.entryNumber ?? "")}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px;
         color: #0f172a; font-size: 13px; }
  .sheet { max-width: 520px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 10px; padding: 22px; }
  .ph { text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 16px; }
  .ph h1 { margin: 0; font-size: 17px; letter-spacing: .2px; }
  .ph p { margin: 3px 0 0; font-size: 11px; color: #64748b; }
  .title { text-align: center; font-size: 12px; font-weight: 700; letter-spacing: 1.5px;
           text-transform: uppercase; color: #4338ca; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 0; vertical-align: top; }
  td.k { color: #64748b; width: 42%; }
  td.v { font-weight: 600; text-align: right; }
  .amount { margin: 16px 0; padding: 14px; background: #f1f5f9; border-radius: 8px;
            display: flex; justify-content: space-between; align-items: baseline; }
  .amount span { font-size: 11px; font-weight: 700; text-transform: uppercase;
                 letter-spacing: .8px; color: #475569; }
  .amount strong { font-size: 22px; }
  .balances { border-top: 1px dashed #cbd5e1; padding-top: 10px; margin-top: 4px; }
  .sign { margin-top: 34px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b; }
  .sign div { border-top: 1px solid #94a3b8; padding-top: 5px; width: 42%; text-align: center; }
  @media print { body { padding: 0; } .sheet { border: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="ph">
      <h1>${escHtml(pharmacy.name)}</h1>
      ${pharmacy.address ? `<p>${escHtml(pharmacy.address)}</p>` : ""}
      ${pharmacy.phone ? `<p>Ph: ${escHtml(pharmacy.phone)}</p>` : ""}
      ${pharmacy.drugLicense ? `<p>DL: ${escHtml(pharmacy.drugLicense)}</p>` : ""}
    </div>

    <div class="title">${escHtml(title)}</div>

    <table>${rows}</table>

    <div class="amount">
      <span>${escHtml(moneyLabel)}</span>
      <strong>&#8377;${escHtml(inr(entry.amount))}</strong>
    </div>

    <table class="balances">
      ${row("Advance now held", "₹" + inr(entry.advanceBalanceAfter))}
      ${entry.duesBalanceAfter > 0 ? row("Outstanding dues", "₹" + inr(entry.duesBalanceAfter)) : ""}
    </table>

    <div class="sign">
      <div>Customer</div>
      <div>For ${escHtml(pharmacy.name)}</div>
    </div>
  </div>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}

export function openVoucherPrintWindow(entry: VoucherEntry, pharmacy: VoucherPharmacy): void {
  const win = window.open("", "_blank", "width=620,height=760,scrollbars=yes");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for this site to print the voucher.");
    return;
  }
  win.document.open();
  win.document.write(buildVoucherHtml(entry, pharmacy));
  win.document.close();
  win.focus();
}
