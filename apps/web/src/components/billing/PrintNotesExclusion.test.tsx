import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InvoicePrintView, type PrintInvoiceData, type PharmacyProfile } from "./InvoicePrintView";
import { ThermalReceiptView } from "./ThermalReceiptView";

/**
 * The printed receipt is for the patient. It must carry the PATIENT REMARKS
 * (dosing directions, "after food") and must NOT carry the pharmacy-only INTERNAL
 * NOTE (the "105 ml prescribed · billing 2 bottles" round-up note / stock).
 */

const PHARMACY: PharmacyProfile = {
  name: "Gita Medical Hall", address: "12 MG Road, Pune", phone: "+91 98765 43210",
  email: "s@g.test", website: "g.test", gstin: "27ABCDE1234F1Z5",
  drugLicense: "MH-1234", fssai: "11224567890123",
};

const INVOICE: PrintInvoiceData = {
  invoiceNumber: "INV/26-27/000001",
  createdAt: "2026-09-09T10:00:00Z",
  customerName: "Asha Verma",
  paymentMode: "CASH", paymentStatus: "PAID", isInterstate: false,
  items: [{
    medicineName: "Benadryl Cough Syrup 100ml", hsnCode: "3004",
    batchNumber: "LT-1", expiryDate: "2027-12-31", mrp: 90, quantity: 2,
    discount: 0, gstRate: 12, rate: 90, taxableAmount: 160.71, cgst: 9.64, sgst: 9.64, igst: 0, amount: 180,
    dosageInstructions: "5 ml three times a day for 7 days",
    patientRemarks: "5 ml thrice daily · after food",
    clinicalNote: "105 ml prescribed · billing 2 bottles",
  }],
  subtotal: 180, discountAmount: 0, taxableAmount: 160.71,
  cgst: 9.64, sgst: 9.64, igst: 0, totalGst: 19.28, totalAmount: 180, roundOff: 0,
};

describe("print views — INTERNAL NOTE excluded, PATIENT REMARKS included", () => {
  it("InvoicePrintView prints the patient remarks and not the internal note", () => {
    const { container } = render(
      <InvoicePrintView invoice={INVOICE} config={{}} pharmacy={PHARMACY} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("5 ml thrice daily · after food");
    expect(text).not.toContain("105 ml prescribed");
    expect(text).not.toContain("billing 2 bottles");
  });

  it("ThermalReceiptView prints the patient remarks and not the internal note", () => {
    const { container } = render(
      <ThermalReceiptView invoice={INVOICE} config={{ paper: { size: "thermal80" } } as never} pharmacy={PHARMACY} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("5 ml thrice daily · after food");
    expect(text).not.toContain("105 ml prescribed");
    expect(text).not.toContain("billing 2 bottles");
  });

  it("falls back to dosageInstructions when the cashier left patient remarks untouched", () => {
    const noRemarks: PrintInvoiceData = {
      ...INVOICE,
      items: [{ ...INVOICE.items[0]!, patientRemarks: undefined }],
    };
    const { container } = render(
      <InvoicePrintView invoice={noRemarks} config={{}} pharmacy={PHARMACY} />,
    );
    expect(container.textContent ?? "").toContain("5 ml three times a day for 7 days");
  });
});
