import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection, eodSummaryQueue } from "../queue.client.js";
import { notifyOwners } from "../../lib/notifications.js";

function buildHtml(data: {
  date:             string;
  pharmacyName:     string;
  invoiceCount:     number;
  totalSales:       number;
  totalReturns:     number;
  netSales:         number;
  paymentBreakdown: { mode: string; total: number; count: number }[];
  pendingCredit:    number;
  cancelledCount:   number;
}): string {
  const modeRows = data.paymentBreakdown.map((p) =>
    `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${p.mode}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${p.count}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">₹${p.total.toFixed(2)}</td>
    </tr>`,
  ).join("");

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px">
    <h2 style="color:#1a1a1a">End-of-Day Summary — ${data.pharmacyName}</h2>
    <p style="color:#888">${data.date}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr style="background:#f0f9ff">
        <td style="padding:12px 16px;font-size:18px;font-weight:bold;color:#1d4ed8">Total Sales</td>
        <td style="padding:12px 16px;font-size:22px;font-weight:bold;color:#1d4ed8;text-align:right">₹${data.totalSales.toFixed(2)}</td>
      </tr>
      <tr><td style="padding:8px 16px;color:#555">Invoices</td><td style="padding:8px 16px;text-align:right">${data.invoiceCount}</td></tr>
      <tr><td style="padding:8px 16px;color:#555">Returns</td><td style="padding:8px 16px;text-align:right;color:#dc2626">-₹${data.totalReturns.toFixed(2)}</td></tr>
      <tr style="background:#f0fdf4">
        <td style="padding:8px 16px;font-weight:600;color:#166534">Net Sales</td>
        <td style="padding:8px 16px;font-weight:600;color:#166534;text-align:right">₹${data.netSales.toFixed(2)}</td>
      </tr>
      ${data.pendingCredit > 0 ? `<tr><td style="padding:8px 16px;color:#d97706">Pending Credit</td><td style="padding:8px 16px;text-align:right;color:#d97706">₹${data.pendingCredit.toFixed(2)}</td></tr>` : ""}
      ${data.cancelledCount > 0 ? `<tr><td style="padding:8px 16px;color:#6b7280">Cancelled Invoices</td><td style="padding:8px 16px;text-align:right">${data.cancelledCount}</td></tr>` : ""}
    </table>
    ${data.paymentBreakdown.length > 0 ? `
    <h3 style="color:#374151;margin:20px 0 8px">Payment Breakdown</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:8px 10px;text-align:left">Mode</th>
        <th style="padding:8px 10px;text-align:center">Invoices</th>
        <th style="padding:8px 10px;text-align:right">Amount</th>
      </tr></thead>
      <tbody>${modeRows}</tbody>
    </table>` : ""}
    <hr style="margin-top:32px">
    <p style="color:#888;font-size:12px">Automated EOD report from Checkup Pharmacy.</p>
  </body></html>`;
}

export const eodSummaryWorker = new Worker(
  "eod-summary",
  async (job) => {
    const { pharmacyId } = job.data as { pharmacyId?: string };

    if (!pharmacyId) {
      const pharmacies = await prisma.pharmacy.findMany({
        where:  { isActive: true },
        select: { id: true },
      });
      await Promise.all(
        pharmacies.map((p) =>
          eodSummaryQueue.add(`pharmacy:${p.id}`, { pharmacyId: p.id }, {
            removeOnComplete: { count: 1 },
            removeOnFail:     { count: 3 },
          }),
        ),
      );
      job.log(`Dispatched ${pharmacies.length} eod-summary job(s)`);
      return;
    }

    const pharmacy = await prisma.pharmacy.findUnique({
      where:  { id: pharmacyId },
      select: { id: true, name: true },
    });
    if (!pharmacy) return;

    const now        = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateStr    = todayStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    const [salesAgg, returnsAgg, paymentBreakdown, pendingCredit, cancelledCount] = await Promise.all([
      prisma.invoice.aggregate({
        where:  { pharmacyId: pharmacy.id, createdAt: { gte: todayStart }, isCancelled: false },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      prisma.salesReturn.aggregate({
        where: { pharmacyId: pharmacy.id, createdAt: { gte: todayStart } },
        _sum:  { totalAmount: true },
      }),
      prisma.invoice.groupBy({
        by:     ["paymentMode"],
        where:  { pharmacyId: pharmacy.id, createdAt: { gte: todayStart }, isCancelled: false },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      prisma.invoice.aggregate({
        where: { pharmacyId: pharmacy.id, paymentStatus: "PENDING", isCancelled: false },
        _sum:  { totalAmount: true },
      }),
      prisma.invoice.count({
        where: { pharmacyId: pharmacy.id, createdAt: { gte: todayStart }, isCancelled: true },
      }),
    ]);

    const totalSales   = salesAgg._sum.totalAmount ?? 0;
    const invoiceCount = salesAgg._count.id;

    if (invoiceCount === 0) return;

    const totalReturns = returnsAgg._sum.totalAmount ?? 0;
    const netSales     = totalSales - totalReturns;
    const pendingAmt   = pendingCredit._sum.totalAmount ?? 0;

    const breakdown = paymentBreakdown.map((p) => ({
      mode:  p.paymentMode as string,
      total: p._sum.totalAmount ?? 0,
      count: p._count.id,
    }));

    const message =
      `EOD Summary — ${pharmacy.name} — ${dateStr}\n\n` +
      `Sales: ₹${totalSales.toFixed(2)} (${invoiceCount} invoices)\n` +
      `Returns: ₹${totalReturns.toFixed(2)}\n` +
      `Net: ₹${netSales.toFixed(2)}\n` +
      (pendingAmt > 0 ? `Pending Credit: ₹${pendingAmt.toFixed(2)}\n` : "") +
      (cancelledCount > 0 ? `Cancelled: ${cancelledCount}\n` : "") +
      `\nBreakdown: ${breakdown.map((p) => `${p.mode} ₹${p.total.toFixed(2)}`).join(" | ")}`;

    await notifyOwners(prisma, pharmacy.id, {
      subject: `EOD Summary — ${dateStr} — ₹${totalSales.toFixed(2)} — ${pharmacy.name}`,
      message,
      html:    buildHtml({ date: dateStr, pharmacyName: pharmacy.name, invoiceCount, totalSales, totalReturns, netSales, paymentBreakdown: breakdown, pendingCredit: pendingAmt, cancelledCount }),
    });

    job.log(`[${pharmacy.name}] EOD summary sent: ₹${totalSales.toFixed(2)} in ${invoiceCount} invoices`);
  },
  { connection, concurrency: 5 },
);
