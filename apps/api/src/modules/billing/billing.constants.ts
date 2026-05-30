export const GST_RATES = [0, 5, 12] as const;
export type GstRate = (typeof GST_RATES)[number];

export const PAYMENT_MODES    = ["CASH", "UPI", "CARD", "CREDIT", "WALLET"] as const;
export const PAYMENT_STATUSES = ["PAID", "PENDING", "PARTIAL"] as const;
export const INVOICE_STATUSES = ["DRAFT", "COMPLETED", "CANCELLED", "RETURNED", "PARTIALLY_RETURNED"] as const;

export const INVOICE_SEQUENCE_KEY = (tenantId: string) => `invoice:seq:${tenantId}`;
export const RETURN_SEQUENCE_KEY  = (tenantId: string) => `return:seq:${tenantId}`;
