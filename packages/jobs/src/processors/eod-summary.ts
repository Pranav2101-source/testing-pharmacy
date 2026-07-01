import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { inAppNotify } from "@pharmacy/mailer";

async function processPharmacy(pharmacyId: string): Promise<void> {
  const pharmacy = await prisma.pharmacy.findUnique({
    where:  { id: pharmacyId },
    select: { id: true, name: true },
  });
  if (!pharmacy) return;

  const now              = new Date();
  const IST_OFFSET_MS    = 5.5 * 60 * 60 * 1_000;
  const istNow           = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnightUtc   = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
  const todayStart       = new Date(istMidnightUtc.getTime() - IST_OFFSET_MS);
  const dateStr          = istMidnightUtc.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

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

  const totalSales   = Number(salesAgg._sum.totalAmount ?? 0);
  const invoiceCount = salesAgg._count.id;
  if (invoiceCount === 0) return;

  const totalReturns = Number(returnsAgg._sum.totalAmount ?? 0);
  const netSales     = totalSales - totalReturns;
  const pendingAmt   = Number(pendingCredit._sum.totalAmount ?? 0);
  const breakdown    = paymentBreakdown.map((p) => ({
    mode:  p.paymentMode as string,
    total: Number(p._sum.totalAmount ?? 0),
    count: p._count.id,
  }));

  const message =
    `Sales: ₹${totalSales.toFixed(2)} (${invoiceCount} invoices)\n` +
    `Returns: ₹${totalReturns.toFixed(2)}\n` +
    `Net: ₹${netSales.toFixed(2)}\n` +
    (pendingAmt > 0 ? `Pending Credit: ₹${pendingAmt.toFixed(2)}\n` : "") +
    (cancelledCount > 0 ? `Cancelled: ${cancelledCount}\n` : "") +
    `\nBreakdown: ${breakdown.map((p) => `${p.mode} ₹${p.total.toFixed(2)}`).join(" | ")}`;

  await inAppNotify(prisma, pharmacy.id, {
    subject: `EOD Summary — ${dateStr} — ₹${totalSales.toFixed(2)}`,
    message,
  });

  console.info(`[eod-summary][${pharmacy.name}] sent: ₹${totalSales.toFixed(2)} in ${invoiceCount} invoices`);
}

export async function eodSummaryHandler(_jobs: Job[]): Promise<void> {
  const pharmacies = await prisma.pharmacy.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  const results = await Promise.allSettled(pharmacies.map((p) => processPharmacy(p.id)));
  const failed  = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[eod-summary] ${failed.length}/${pharmacies.length} pharmacies failed`);
    for (const f of failed) {
      if (f.status === "rejected") console.error("[eod-summary] error:", f.reason);
    }
  }
}
