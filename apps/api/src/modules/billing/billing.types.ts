export type InvoiceLineItem = {
  inventoryId: string;
  medicineName: string;
  hsnCode: string | null;
  batchNumber: string;
  expiryDate: Date;
  mrp: number;
  quantity: number;
  discount: number;
  gstRate: number;
  rate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  amount: number;
};

export type InvoiceSummary = {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  totalGst: number;
  totalAmount: number;
};
