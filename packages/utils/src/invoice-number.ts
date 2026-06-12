/**
 * Generates invoice numbers in format: INV/25-26/000001
 * Financial year in India: April 1 → March 31
 */

export function getFinancialYear(date: Date = new Date()): string {
  const month = date.getMonth() + 1; // 1-indexed
  const year = date.getFullYear();
  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = fyStart + 1;
  return `${String(fyStart).slice(-2)}-${String(fyEnd).slice(-2)}`;
}

export function generateInvoiceNumber(
  prefix: string,
  sequence: number,
  useFinancialYear: boolean,
  date: Date = new Date(),
  separator: string = "/",
  counterLength: number = 6,
): string {
  const paddedSeq = String(sequence).padStart(counterLength, "0");
  if (useFinancialYear) {
    return `${prefix}${separator}${getFinancialYear(date)}${separator}${paddedSeq}`;
  }
  return `${prefix}${separator}${paddedSeq}`;
}
