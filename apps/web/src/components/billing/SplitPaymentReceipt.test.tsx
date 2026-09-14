import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InvoicePrintView, formatPaymentLine, type PrintInvoiceData, type PharmacyProfile } from "./InvoicePrintView";
import { ThermalReceiptView } from "./ThermalReceiptView";
import { A5LandscapeInvoiceView } from "./A5LandscapeInvoiceView";
import { TaxWholesaleInvoiceView } from "./TaxWholesaleInvoiceView";

/**
 * What a receipt says about how the bill was paid.
 *
 * <p>A bill settled two ways has no single payment mode, and the stored one is merely
 * its largest leg. Printing that alone hands someone who paid Rs.400 in cash and Rs.600
 * by UPI a receipt claiming the whole Rs.1000 went on UPI — a document they may later
 * rely on. Every layout has to agree, because which one prints is a pharmacy setting.
 */

const PHARMACY: PharmacyProfile = {
  name: "Gita Medical Hall", address: "12 MG Road, Pune", phone: "+91 98765 43210",
  email: "s@g.test", gstin: "27ABCDE1234F1Z5", drugLicense: "MH-1234", state: "Maharashtra",
};

const BASE: PrintInvoiceData = {
  invoiceNumber: "INV/26-27/000042",
  createdAt: "2026-09-13T10:00:00Z",
  customerName: "Asha Verma",
  paymentMode: "UPI", paymentStatus: "PAID", isInterstate: false,
  items: [{
    medicineName: "Paracetamol 650", hsnCode: "3004",
    batchNumber: "B-1", expiryDate: "2027-12-31", mrp: 500, quantity: 2,
    discount: 0, gstRate: 12, rate: 500, taxableAmount: 892.86, cgst: 53.57, sgst: 53.57, igst: 0, amount: 1000,
  }],
  subtotal: 1000, discountAmount: 0, taxableAmount: 892.86,
  cgst: 53.57, sgst: 53.57, igst: 0, totalGst: 107.14, totalAmount: 1000, roundOff: 0,
};

const SPLIT: PrintInvoiceData = {
  ...BASE,
  tenders: [{ mode: "CASH", amount: 400 }, { mode: "UPI", amount: 600 }],
};

describe("formatPaymentLine", () => {
  it("names every leg of a split bill", () => {
    expect(formatPaymentLine(SPLIT)).toContain("Cash");
    expect(formatPaymentLine(SPLIT)).toContain("UPI");
    expect(formatPaymentLine(SPLIT)).toContain("PAID");
  });

  it("leaves an ordinary bill reading exactly as before", () => {
    // One leg is not a split. Listing it would turn every receipt's "Cash" into
    // "Cash ₹1,000.00", which is noise on the overwhelming majority of bills.
    expect(formatPaymentLine(BASE)).toBe("UPI — PAID");
    expect(formatPaymentLine({ ...BASE, tenders: [{ mode: "UPI", amount: 1000 }] })).toBe("UPI — PAID");
  });

  it("keeps an unpaid remainder visible in the status", () => {
    const partial = { ...SPLIT, paymentStatus: "PARTIAL", tenders: [{ mode: "CASH", amount: 600 }] };
    expect(formatPaymentLine(partial)).toContain("PARTIAL");
  });

  it("names an Advance leg like any other — a bill settled from a deposit is still PAID", () => {
    // A single leg is printed from paymentMode, not the tenders array (see "leaves an
    // ordinary bill reading exactly as before" above) — BillingService sets
    // paymentMode to the dominant (here, only) leg, so the fixture mirrors that.
    const fromAdvance = { ...BASE, paymentMode: "ADVANCE", tenders: [{ mode: "ADVANCE", amount: 1000 }] };
    expect(formatPaymentLine(fromAdvance)).toBe("ADVANCE — PAID");
  });

  it("a bill split Cash + Advance lists both, since neither alone is the whole story", () => {
    const mixed = { ...BASE, tenders: [{ mode: "CASH", amount: 300 }, { mode: "ADVANCE", amount: 700 }] };
    expect(formatPaymentLine(mixed)).toContain("Advance");
    expect(formatPaymentLine(mixed)).toContain("Cash");
  });
});

describe("every printed layout reports the same split", () => {
  const layouts: [string, (invoice: PrintInvoiceData) => React.ReactElement][] = [
    ["A4", (invoice) => <InvoicePrintView invoice={invoice} config={{}} pharmacy={PHARMACY} />],
    ["thermal", (invoice) => <ThermalReceiptView invoice={invoice} config={{}} pharmacy={PHARMACY} />],
    ["A5 landscape", (invoice) => <A5LandscapeInvoiceView invoice={invoice} config={{}} pharmacy={PHARMACY} preview />],
    ["tax/wholesale", (invoice) => <TaxWholesaleInvoiceView invoice={invoice} config={{}} pharmacy={PHARMACY} />],
  ];

  for (const [name, renderLayout] of layouts) {
    it(`${name} shows both legs, not just the larger one`, () => {
      const { container } = render(renderLayout(SPLIT));
      const text = (container.textContent ?? "").replace(/\s+/g, " ");

      expect(text).toMatch(/CASH|Cash/);
      expect(text).toContain("400");
      expect(text).toContain("600");
    });
  }
});
