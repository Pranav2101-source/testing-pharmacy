import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import { A5LandscapeInvoiceView } from "./A5LandscapeInvoiceView";
import type { PrintInvoiceData, PharmacyProfile } from "./InvoicePrintView";

/**
 * The A5 half-sheet (210×148mm landscape) — replaces the old A5 portrait output.
 * Same GST content + toggle behaviour as the other page formats, squeezed to
 * half an A4, with a fixed height and an injected @page rule for the sheet.
 */

const PHARMACY: PharmacyProfile = {
  name: "HealthPlus Pharmacy", address: "12 Main Road, City - 110001",
  phone: "+91 90000 00000", gstin: "07AAAAA0000A1Z5", drugLicense: "20B/21B/2026", state: "Delhi",
};

const INVOICE: PrintInvoiceData = {
  invoiceNumber: "PH-2026-102", createdAt: "2026-02-06T09:00:00Z",
  customerName: "Rohit Sharma", customerPhone: "+91 90000 12345",
  paymentMode: "CASH", paymentStatus: "PAID", isInterstate: false,
  items: [
    { medicineName: "Paracetamol 500mg", hsnCode: "3004", batchNumber: "B12", expiryDate: "2028-06-30",
      mrp: 130, quantity: 2, freeQty: 5, discount: 0, gstRate: 12, rate: 120,
      taxableAmount: 235, cgst: 5.88, sgst: 5.88, igst: 0, amount: 246.75 },
    { medicineName: "Vitamin C Tablets", hsnCode: "3004", batchNumber: "C45", expiryDate: "2028-06-30",
      mrp: 220, quantity: 1, discount: 0, gstRate: 12, rate: 220,
      taxableAmount: 220, cgst: 13.2, sgst: 13.2, igst: 0, amount: 246.4 },
  ],
  subtotal: 480, discountAmount: 5, taxableAmount: 695, cgst: 25.07, sgst: 25.07, igst: 0,
  totalGst: 50.15, totalAmount: 745, roundOff: -0.15,
};

const renderView = (config: Partial<InvoiceSettingsConfig> = {}, preview = false) =>
  render(<A5LandscapeInvoiceView invoice={INVOICE} config={config} pharmacy={PHARMACY} preview={preview} />);

describe("A5LandscapeInvoiceView", () => {
  it("renders a 210×148mm half sheet with a 4mm default margin", () => {
    const { container } = renderView();
    const page = container.firstElementChild as HTMLElement;
    expect(page.style.width).toBe("210mm");
    expect(page.style.height).toBe("148mm");
    expect(page.style.maxHeight).toBe("148mm");
    expect(page.style.padding).toBe("4mm");
    expect(page.style.overflow).toBe("hidden");
  });

  it("injects the @page size rule for print, but not in preview mode", () => {
    const { container: printed } = renderView({});
    expect(printed.querySelector("style")?.textContent).toContain("size: 210mm 148mm");

    const { container: previewed } = renderView({}, true);
    expect(previewed.querySelector("style")).toBeNull();
  });

  it("pads the item grid to 5 rows by default", () => {
    renderView();
    // 1 header + 2 items + 3 blank + 1 column-totals
    expect(screen.getAllByRole("row")).toHaveLength(7);
  });

  it("always prints the GST-mandatory columns and sums them", () => {
    renderView({ columns: { showHsn: false, showGstRate: false } as never });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["HSN", "CGST", "SGST", "Total"]));

    const totalsRow = screen.getByText("Column Totals").closest("tr")!;
    const cells = within(totalsRow).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("493.15"); // line-amount total
  });

  it("honours the toggleable Financial Summary rows", () => {
    renderView({ totals: { showSubtotal: false, showAmountWords: false } as never });
    expect(screen.queryByText("Subtotal (MRP)")).not.toBeInTheDocument();
    expect(screen.queryByText(/In words/)).not.toBeInTheDocument();
    expect(screen.getByText("Grand Total")).toBeInTheDocument();
  });

  it("scales every size with paper.contentScale", () => {
    const { container } = render(
      <A5LandscapeInvoiceView invoice={INVOICE} config={{ paper: { size: "A5", contentScale: 1.1 } as never }} pharmacy={PHARMACY} />,
    );
    expect((container.firstElementChild as HTMLElement).style.fontSize).toBe("8.8px"); // 8 * 1.1
  });

  it("shows the Bank Details box only when configured", () => {
    renderView();
    expect(screen.queryByText("Bank Details")).not.toBeInTheDocument();
    renderView({ bank: { show: true, bankName: "State Bank of India" } as never });
    expect(screen.getByText("Bank Details")).toBeInTheDocument();
  });

  it("renders the UPI QR as a synchronous SVG", () => {
    const { container } = renderView({ footer: { showQrCode: true, upiId: "healthplus@upi" } as never });
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("UPI: healthplus@upi")).toBeInTheDocument();
  });
});
