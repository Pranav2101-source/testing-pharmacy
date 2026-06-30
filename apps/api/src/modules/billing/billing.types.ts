// ─── Line item computed during invoice creation ───────────────────────────────

export type InvoiceLineItem = {
  inventoryId:   string;
  medicineName:  string;
  hsnCode:       string | null;
  batchNumber:   string;
  expiryDate:    Date;
  mrp:           number;
  purchaseRate:  number;
  quantity:      number;
  discount:      number;
  gstRate:       number;
  rate:          number;
  taxableAmount: number;
  cgst:          number;
  sgst:          number;
  igst:          number;
  amount:        number;
  location:      string | null;
};

// ─── Invoice totals summary ───────────────────────────────────────────────────

export type InvoiceSummary = {
  subtotal:       number;
  discountAmount: number;
  taxableAmount:  number;
  cgst:           number;
  sgst:           number;
  totalGst:       number;
  totalAmount:    number;
};

// ─── Inventory movement record collected inside a transaction ─────────────────

export type PendingMovement = {
  inventoryId:    string;
  quantity:       number;
  quantityBefore: number;
  quantityAfter:  number;
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export type DashboardStats = {
  todaySales:       number;
  todayCount:       number;
  todayCancelled:   number;
  todayReturns:     number;
  // Rolling 7-day window ending now — NOT the current Mon–Sun calendar week.
  last7DaysSales:   number;
  last7DaysCount:   number;
  monthSales:       number;
  monthCount:       number;
  paymentBreakdown: { mode: string; total: number; count: number }[];
  pendingCredit:    number; // total unpaid credit invoices
  lowStockCount:    number;
  nearExpiryCount:  number;
};
