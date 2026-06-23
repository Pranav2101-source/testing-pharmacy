// ─── Types ────────────────────────────────────────────────────────────────────

export type PrintPharmacy = {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  drugLicense?: string | null;
};

export type PrintPOItem = {
  medicineName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  purchaseRate: number;
  mrp: number;
  gstRate: number;
  amount: number;
};

export type PrintPO = {
  orderNumber: string;
  orderedAt: string;
  expectedDate?: string | null;
  invoiceNo?: string | null;
  notes?: string | null;
  subtotal: number;
  totalGst: number;
  totalAmount: number;
  supplier: { name: string; phone?: string | null; email?: string | null };
  items: PrintPOItem[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtExpiry(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ─── HTML Generator ───────────────────────────────────────────────────────────

function generatePOHTML(po: PrintPO, pharmacy: PrintPharmacy): string {
  const addressLine = [pharmacy.address, pharmacy.city, pharmacy.state, pharmacy.pincode]
    .filter(Boolean).join(", ");

  const metaLine = [
    pharmacy.gstin      ? `GSTIN: ${pharmacy.gstin}`           : "",
    pharmacy.drugLicense ? `DL: ${pharmacy.drugLicense}`        : "",
    pharmacy.phone       ? `Ph: ${pharmacy.phone}`              : "",
  ].filter(Boolean).join("  ·  ");

  const itemRows = po.items.map((item, i) => `
    <tr>
      <td class="sr">${i + 1}</td>
      <td>
        <div class="med-name">${item.medicineName}</div>
        <div class="med-meta">Batch: ${item.batchNumber} &nbsp;·&nbsp; Expiry: ${fmtExpiry(item.expiryDate)} &nbsp;·&nbsp; MRP: ₹${inr(item.mrp)}</div>
      </td>
      <td class="num">${item.quantity}</td>
      <td class="num">₹${inr(item.purchaseRate)}</td>
      <td class="num">${item.gstRate}%</td>
      <td class="num bold">₹${inr(item.amount)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Purchase Order — ${po.orderNumber}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#1e293b;background:#f0f4f8}

    /* ── Action bar (screen only) ── */
    .bar{position:fixed;top:0;left:0;right:0;z-index:100;background:#0a1a52;display:flex;align-items:center;justify-content:space-between;padding:12px 28px;gap:16px}
    .bar-info{}
    .bar-title{font-size:14px;font-weight:700;color:#fff}
    .bar-sub{font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px}
    .bar-actions{display:flex;gap:8px;flex-shrink:0}
    .btn{border:none;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;line-height:1}
    .btn-primary{background:#3b82f6;color:#fff}
    .btn-primary:hover{background:#2563eb}
    .btn-ghost{background:rgba(255,255,255,0.12);color:#fff}
    .btn-ghost:hover{background:rgba(255,255,255,0.2)}

    /* ── Page shell ── */
    .page{max-width:820px;margin:76px auto 48px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10)}

    /* ── Header ── */
    .header{background:linear-gradient(135deg,#0a1a52 0%,#162870 100%);color:#fff;padding:28px 36px;display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
    .ph-name{font-size:22px;font-weight:800;letter-spacing:-0.4px;line-height:1.2}
    .ph-addr{font-size:11px;color:rgba(255,255,255,0.6);margin-top:5px;line-height:1.7}
    .po-badge{text-align:right;flex-shrink:0}
    .po-label{font-size:10px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,0.5);text-transform:uppercase}
    .po-num{font-size:22px;font-weight:800;margin-top:4px}
    .po-chip{display:inline-block;margin-top:8px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);border-radius:20px;padding:3px 12px;font-size:10px;font-weight:600;letter-spacing:0.5px;color:rgba(255,255,255,0.8)}

    /* ── Meta strip ── */
    .meta{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #e2e8f0}
    .meta-block{padding:20px 36px}
    .meta-block+.meta-block{border-left:1px solid #e2e8f0}
    .meta-lbl{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
    .meta-val{font-size:13px;font-weight:700;color:#0f172a;line-height:1.4}
    .meta-sub{font-size:11px;color:#64748b;margin-top:3px;line-height:1.5}

    /* ── Items table ── */
    .table-wrap{padding:0 36px 28px}
    .table-hdr{display:flex;align-items:center;gap:10px;padding:22px 0 14px;border-bottom:2px solid #0a1a52}
    .table-hdr-title{font-size:11px;font-weight:800;color:#0a1a52;text-transform:uppercase;letter-spacing:1.5px}
    .item-ct{font-size:11px;color:#94a3b8;font-weight:500}
    table{width:100%;border-collapse:collapse;margin-top:2px}
    th{text-align:left;padding:10px 8px 10px 0;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;background:#fff;white-space:nowrap}
    td{padding:11px 8px 11px 0;border-bottom:1px solid #f1f5f9;vertical-align:top}
    tr:last-child td{border-bottom:none}
    .sr{color:#cbd5e1;font-size:11px;width:28px;padding-right:0}
    .med-name{font-weight:600;color:#0f172a;font-size:12.5px;line-height:1.3}
    .med-meta{font-size:10px;color:#94a3b8;margin-top:3px;line-height:1.4}
    .num{text-align:right;white-space:nowrap}
    .bold{font-weight:700;color:#0f172a}

    /* ── Totals ── */
    .totals{margin:0 36px;padding-top:16px;border-top:2px solid #e2e8f0}
    .tot-row{display:flex;justify-content:flex-end;gap:0;padding:5px 0}
    .tot-lbl{color:#64748b;font-size:12.5px;min-width:160px;text-align:right;padding-right:24px}
    .tot-val{font-size:12.5px;font-weight:600;min-width:110px;text-align:right}
    .grand{background:#0a1a52;color:#fff;border-radius:8px;margin:14px 36px 28px;padding:13px 20px;display:flex;justify-content:flex-end;align-items:center;gap:0}
    .grand .tot-lbl{color:rgba(255,255,255,0.75);font-size:13px;font-weight:600}
    .grand .tot-val{font-size:17px;font-weight:800;color:#fff}

    /* ── Footer ── */
    .footer{display:grid;grid-template-columns:1fr 1fr;gap:32px;padding:20px 36px 32px;border-top:1px solid #e2e8f0}
    .notes-lbl{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .notes-txt{font-size:12px;color:#64748b;line-height:1.6}
    .notes-gen{font-size:10.5px;color:#cbd5e1;margin-top:10px;font-style:italic}
    .sign{text-align:right}
    .sign-space{height:44px}
    .sign-line{border-top:1.5px solid #334155;display:inline-block;width:170px;margin-top:0}
    .sign-lbl{font-size:10px;color:#94a3b8;margin-top:6px;text-transform:uppercase;letter-spacing:1px;font-weight:600}
    .sign-name{font-size:12px;font-weight:700;color:#0f172a;margin-top:2px}

    /* ── Print ── */
    @media print{
      .bar{display:none!important}
      body{background:#fff}
      .page{margin:0;box-shadow:none;border-radius:0;max-width:100%}
      .header,.grand{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
  </style>
</head>
<body>

  <div class="bar">
    <div class="bar-info">
      <div class="bar-title">Purchase Order — ${po.orderNumber}</div>
      <div class="bar-sub">Save as PDF → File → Print → Change destination to "Save as PDF"</div>
    </div>
    <div class="bar-actions">
      <button class="btn btn-primary" onclick="window.print()">🖨&nbsp; Print / Save as PDF</button>
      <button class="btn btn-ghost" onclick="window.close()">✕ Close</button>
    </div>
  </div>

  <div class="page">

    <!-- Header -->
    <div class="header">
      <div>
        <div class="ph-name">${pharmacy.name}</div>
        <div class="ph-addr">
          ${addressLine ? `${addressLine}<br>` : ""}
          ${metaLine}
        </div>
      </div>
      <div class="po-badge">
        <div class="po-label">Purchase Order</div>
        <div class="po-num">${po.orderNumber}</div>
        <div class="po-chip">DRAFT</div>
      </div>
    </div>

    <!-- Meta -->
    <div class="meta">
      <div class="meta-block">
        <div class="meta-lbl">Order Details</div>
        <div class="meta-val">${fmt(po.orderedAt)}</div>
        ${po.expectedDate ? `<div class="meta-sub">Expected Delivery: ${fmt(po.expectedDate)}</div>` : ""}
        ${po.invoiceNo    ? `<div class="meta-sub">Ref No: ${po.invoiceNo}</div>`                     : ""}
      </div>
      <div class="meta-block">
        <div class="meta-lbl">Supplier</div>
        <div class="meta-val">${po.supplier.name}</div>
        ${po.supplier.phone ? `<div class="meta-sub">📞 ${po.supplier.phone}</div>` : ""}
        ${po.supplier.email ? `<div class="meta-sub">✉ ${po.supplier.email}</div>` : ""}
      </div>
    </div>

    <!-- Items -->
    <div class="table-wrap">
      <div class="table-hdr">
        <span class="table-hdr-title">Items Ordered</span>
        <span class="item-ct">${po.items.length} medicine${po.items.length !== 1 ? "s" : ""}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th class="sr">#</th>
            <th>Medicine</th>
            <th class="num">Qty</th>
            <th class="num">Rate (₹)</th>
            <th class="num">GST</th>
            <th class="num">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>

    <!-- Totals -->
    <div class="totals">
      <div class="tot-row">
        <span class="tot-lbl">Subtotal</span>
        <span class="tot-val">₹${inr(po.subtotal)}</span>
      </div>
      <div class="tot-row">
        <span class="tot-lbl">GST (CGST + SGST)</span>
        <span class="tot-val">₹${inr(po.totalGst)}</span>
      </div>
    </div>
    <div class="grand">
      <span class="tot-lbl">Grand Total</span>
      <span class="tot-val">₹${inr(po.totalAmount)}</span>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div>
        <div class="notes-lbl">Notes</div>
        <div class="notes-txt">${po.notes || "Please confirm availability and expected delivery date at your earliest convenience."}</div>
        <div class="notes-gen">Generated via Checkup Pharmacy OS</div>
      </div>
      <div class="sign">
        <div class="sign-space"></div>
        <div class="sign-line"></div>
        <div class="sign-lbl">Authorised Signatory</div>
        <div class="sign-name">${pharmacy.name}</div>
      </div>
    </div>

  </div>

  <script>
    // Auto-trigger print after page fully renders
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 500);
    });
  </script>
</body>
</html>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function openPOPrintWindow(po: PrintPO, pharmacy: PrintPharmacy): void {
  const html = generatePOHTML(po, pharmacy);
  const win  = window.open("", "_blank", "width=960,height=800,scrollbars=yes");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for this site and try again.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export function openPOWhatsApp(po: PrintPO, pharmacy: PrintPharmacy): boolean {
  const raw = po.supplier.phone?.replace(/\D/g, "");
  if (!raw) return false;
  const phone = raw.startsWith("91") ? raw : `91${raw}`;

  const lines = [
    `*Purchase Order: ${po.orderNumber}*`,
    `From: *${pharmacy.name}*`,
    ``,
    `📅 Date: ${fmt(po.orderedAt)}`,
    po.expectedDate ? `🚚 Expected Delivery: ${fmt(po.expectedDate)}` : "",
    ``,
    `*${po.items.length} medicine${po.items.length !== 1 ? "s" : ""} | Total: ₹${inr(po.totalAmount)}*`,
    ``,
    `Please confirm availability and delivery date at your earliest.`,
    ``,
    `Thank you,`,
    `_${pharmacy.name}_`,
    pharmacy.phone ? `Ph: ${pharmacy.phone}` : "",
  ].filter((l) => l !== undefined && !(l === "" && false)).join("\n");

  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines)}`, "_blank");
  return true;
}
