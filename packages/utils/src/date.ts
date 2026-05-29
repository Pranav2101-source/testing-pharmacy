export function formatDate(date: Date | string, format = "DD/MM/YYYY"): string {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return format
    .replace("DD", day)
    .replace("MM", month)
    .replace("YYYY", String(year));
}

export function isExpired(expiryDate: Date | string): boolean {
  return new Date(expiryDate) < new Date();
}

export function isNearExpiry(
  expiryDate: Date | string,
  daysThreshold = 90
): boolean {
  const expiry = new Date(expiryDate);
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + daysThreshold);
  return expiry <= threshold && expiry >= new Date();
}
