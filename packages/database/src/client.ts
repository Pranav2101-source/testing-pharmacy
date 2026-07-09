import { PrismaClient } from "@prisma/client";

// Append pool settings to the database URL so Prisma's query engine enforces
// the connection limit and pool timeout at the driver level rather than relying
// on Prisma's default per-process heuristic (min(2×cpu+1, 10)).
function buildDatasourceUrl(): string | undefined {
  const base    = process.env["DATABASE_URL"];
  if (!base) return undefined;

  const poolSize    = Number(process.env["DB_POOL_SIZE"]    ?? 10);
  const poolTimeout = Number(process.env["DB_POOL_TIMEOUT"] ?? 10);

  // Avoid double-appending if the URL already contains pool params
  if (base.includes("connection_limit")) return base;

  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}connection_limit=${poolSize}&pool_timeout=${poolTimeout}`;
}

// ── Decimal → number conversion at the client boundary ───────────────────────
// All money columns are NUMERIC(12,2) in Postgres: storage and SQL aggregation
// are exact (no float drift in creditUsed increments or GST sums). Prisma
// surfaces NUMERIC as Decimal objects, but the entire application — and the
// JSON API contract — works in plain numbers. The result extensions below
// convert every money field to number on read AND override the generated types,
// so the rest of the codebase continues to compile against `number`.
// NUMERIC(12,2) values (≤ 10 digits before the point) are exactly representable
// in a JS double, so the conversion is lossless.
//
// NOT covered by result extensions (convert explicitly with Number(...) at the
// call site): aggregate/_sum/_avg, groupBy results, and $queryRaw rows.

const createClient = () => {
  const base = new PrismaClient({
    log: process.env["NODE_ENV"] === "development"
      ? ["query", "error", "warn"]
      : ["error"],
    datasources: {
      db: { url: buildDatasourceUrl() },
    },
  });

  return base.$extends({
    result: {
      medicine: {
        gstRate:    { needs: { gstRate: true },    compute: (m) => m.gstRate.toNumber() },
        catalogMrp: { needs: { catalogMrp: true }, compute: (m) => m.catalogMrp === null ? null : m.catalogMrp.toNumber() },
      },
      inventory: {
        purchaseRate: { needs: { purchaseRate: true }, compute: (i) => i.purchaseRate.toNumber() },
        mrp:          { needs: { mrp: true },          compute: (i) => i.mrp.toNumber() },
      },
      customer: {
        defaultDiscount: { needs: { defaultDiscount: true }, compute: (c) => c.defaultDiscount.toNumber() },
        creditLimit:     { needs: { creditLimit: true },     compute: (c) => c.creditLimit.toNumber() },
        creditUsed:      { needs: { creditUsed: true },      compute: (c) => c.creditUsed.toNumber() },
      },
      supplier: {
        creditLimit:   { needs: { creditLimit: true },   compute: (s) => s.creditLimit.toNumber() },
        ledgerBalance: { needs: { ledgerBalance: true }, compute: (s) => s.ledgerBalance.toNumber() },
      },
      purchaseOrder: {
        subtotal:    { needs: { subtotal: true },    compute: (p) => p.subtotal.toNumber() },
        totalGst:    { needs: { totalGst: true },    compute: (p) => p.totalGst.toNumber() },
        totalAmount: { needs: { totalAmount: true }, compute: (p) => p.totalAmount.toNumber() },
      },
      invoice: {
        subtotal:       { needs: { subtotal: true },       compute: (i) => i.subtotal.toNumber() },
        discountAmount: { needs: { discountAmount: true }, compute: (i) => i.discountAmount.toNumber() },
        taxableAmount:  { needs: { taxableAmount: true },  compute: (i) => i.taxableAmount.toNumber() },
        cgst:           { needs: { cgst: true },           compute: (i) => i.cgst.toNumber() },
        sgst:           { needs: { sgst: true },           compute: (i) => i.sgst.toNumber() },
        igst:           { needs: { igst: true },           compute: (i) => i.igst.toNumber() },
        totalGst:       { needs: { totalGst: true },       compute: (i) => i.totalGst.toNumber() },
        totalAmount:    { needs: { totalAmount: true },    compute: (i) => i.totalAmount.toNumber() },
        returnedAmount: { needs: { returnedAmount: true }, compute: (i) => i.returnedAmount.toNumber() },
      },
      invoiceItem: {
        mrp:           { needs: { mrp: true },           compute: (i) => i.mrp.toNumber() },
        rate:          { needs: { rate: true },          compute: (i) => i.rate.toNumber() },
        purchaseRate:  { needs: { purchaseRate: true },  compute: (i) => i.purchaseRate.toNumber() },
        discount:      { needs: { discount: true },      compute: (i) => i.discount.toNumber() },
        gstRate:       { needs: { gstRate: true },       compute: (i) => i.gstRate.toNumber() },
        cgst:          { needs: { cgst: true },          compute: (i) => i.cgst.toNumber() },
        sgst:          { needs: { sgst: true },          compute: (i) => i.sgst.toNumber() },
        igst:          { needs: { igst: true },          compute: (i) => i.igst.toNumber() },
        taxableAmount: { needs: { taxableAmount: true }, compute: (i) => i.taxableAmount.toNumber() },
        amount:        { needs: { amount: true },        compute: (i) => i.amount.toNumber() },
      },
      invoicePayment: {
        amount: { needs: { amount: true }, compute: (p) => p.amount.toNumber() },
      },
      salesReturn: {
        subtotal:       { needs: { subtotal: true },       compute: (r) => r.subtotal.toNumber() },
        discountAmount: { needs: { discountAmount: true }, compute: (r) => r.discountAmount.toNumber() },
        taxableAmount:  { needs: { taxableAmount: true },  compute: (r) => r.taxableAmount.toNumber() },
        cgst:           { needs: { cgst: true },           compute: (r) => r.cgst.toNumber() },
        sgst:           { needs: { sgst: true },           compute: (r) => r.sgst.toNumber() },
        igst:           { needs: { igst: true },           compute: (r) => r.igst.toNumber() },
        totalGst:       { needs: { totalGst: true },       compute: (r) => r.totalGst.toNumber() },
        totalAmount:    { needs: { totalAmount: true },    compute: (r) => r.totalAmount.toNumber() },
      },
      salesReturnItem: {
        mrp:           { needs: { mrp: true },           compute: (i) => i.mrp.toNumber() },
        rate:          { needs: { rate: true },          compute: (i) => i.rate.toNumber() },
        discount:      { needs: { discount: true },      compute: (i) => i.discount.toNumber() },
        gstRate:       { needs: { gstRate: true },       compute: (i) => i.gstRate.toNumber() },
        cgst:          { needs: { cgst: true },          compute: (i) => i.cgst.toNumber() },
        sgst:          { needs: { sgst: true },          compute: (i) => i.sgst.toNumber() },
        igst:          { needs: { igst: true },          compute: (i) => i.igst.toNumber() },
        taxableAmount: { needs: { taxableAmount: true }, compute: (i) => i.taxableAmount.toNumber() },
        amount:        { needs: { amount: true },        compute: (i) => i.amount.toNumber() },
      },
      goodsReceiptNote: {
        subtotal:    { needs: { subtotal: true },    compute: (g) => g.subtotal.toNumber() },
        totalGst:    { needs: { totalGst: true },    compute: (g) => g.totalGst.toNumber() },
        totalAmount: { needs: { totalAmount: true }, compute: (g) => g.totalAmount.toNumber() },
      },
      gRNItem: {
        purchaseRate: { needs: { purchaseRate: true }, compute: (g) => g.purchaseRate.toNumber() },
        mrp:          { needs: { mrp: true },          compute: (g) => g.mrp.toNumber() },
        discount:     { needs: { discount: true },     compute: (g) => g.discount.toNumber() },
        gstRate:      { needs: { gstRate: true },      compute: (g) => g.gstRate.toNumber() },
        cgst:         { needs: { cgst: true },         compute: (g) => g.cgst.toNumber() },
        sgst:         { needs: { sgst: true },         compute: (g) => g.sgst.toNumber() },
        amount:       { needs: { amount: true },       compute: (g) => g.amount.toNumber() },
      },
      supplierReturn: {
        subtotal:      { needs: { subtotal: true },      compute: (r) => r.subtotal.toNumber() },
        taxableAmount: { needs: { taxableAmount: true }, compute: (r) => r.taxableAmount.toNumber() },
        cgst:          { needs: { cgst: true },          compute: (r) => r.cgst.toNumber() },
        sgst:          { needs: { sgst: true },          compute: (r) => r.sgst.toNumber() },
        igst:          { needs: { igst: true },          compute: (r) => r.igst.toNumber() },
        totalGst:      { needs: { totalGst: true },      compute: (r) => r.totalGst.toNumber() },
        totalAmount:   { needs: { totalAmount: true },   compute: (r) => r.totalAmount.toNumber() },
      },
      supplierLedgerEntry: {
        amount: { needs: { amount: true }, compute: (e) => e.amount.toNumber() },
      },
      quotationItem: {
        quotedRate: { needs: { quotedRate: true }, compute: (q) => q.quotedRate === null ? null : q.quotedRate.toNumber() },
        mrp:        { needs: { mrp: true },        compute: (q) => q.mrp === null ? null : q.mrp.toNumber() },
        gstRate:    { needs: { gstRate: true },    compute: (q) => q.gstRate.toNumber() },
        discount:   { needs: { discount: true },   compute: (q) => q.discount.toNumber() },
      },
      pharmacyMedicineOverride: {
        gstRate:            { needs: { gstRate: true },            compute: (o) => o.gstRate === null ? null : o.gstRate.toNumber() },
        defaultDiscountPct: { needs: { defaultDiscountPct: true }, compute: (o) => o.defaultDiscountPct === null ? null : o.defaultDiscountPct.toNumber() },
      },
    },
  });
};

/**
 * The application database client type. Repos and services accept this (not
 * the bare PrismaClient) so money fields type as `number` end to end.
 */
export type Db = ReturnType<typeof createClient>;

/** Transaction client passed to `db.$transaction(async (tx) => ...)` callbacks. */
export type DbTransactionClient = Omit<
  Db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Run `callback` inside a Prisma interactive transaction where the PostgreSQL
 * session variable `app.current_pharmacy_id` is set for the duration.
 *
 * RLS policies on every pharmacy-scoped table use this variable as a second
 * line of defense: a bug that forgets a WHERE pharmacyId = ? clause will be
 * caught at the database level when the variable is set.
 *
 * Usage:
 *   const invoice = await withTenant(db, req.pharmacyId, (tx) =>
 *     tx.invoice.findFirstOrThrow({ where: { id, pharmacyId: req.pharmacyId } })
 *   );
 */
export async function withTenant<T>(
  db:         Db,
  pharmacyId: string,
  callback:   (tx: DbTransactionClient) => Promise<T>,
  options?:   { isolationLevel?: "ReadUncommitted" | "ReadCommitted" | "RepeatableRead" | "Serializable"; timeout?: number; maxWait?: number },
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_pharmacy_id', ${pharmacyId}, true)`;
    return callback(tx as unknown as DbTransactionClient);
  }, options);
}

const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const prisma: Db = globalForPrisma.prisma ?? createClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export * from "./migration-inventory.js";
export * from "./migration-entities.js";
