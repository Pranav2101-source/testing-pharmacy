import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import { TaxWholesaleInvoiceView } from "./TaxWholesaleInvoiceView";
import type { PrintInvoiceData, PharmacyProfile } from "./InvoicePrintView";

/**
 * The tax-wholesale layout is a THIRD render of the same invoice config. It must
 * honour the same content toggles as the A4 view, always print the GST-mandatory
 * columns, keep a constant grid height, and foot its own totals block.
 */

const PHARMACY: PharmacyProfile = {
  name: "HealthPlus Pharmacy",
  address: "12 Main Road, City - 110001",
  phone: "+91 90000 00000",
  email: "care@healthplus.in",
  gstin: "07AAAAA0000A1Z5",
  drugLicense: "20B/21B/2026",
  state: "Delhi",
};

const INVOICE: PrintInvoiceData = {
  invoiceNumber: "PH-2026-102",
  createdAt: "2026-02-06T09:00:00Z",
  customerName: "Rohit Sharma",
  customerPhone: "+91 90000 12345",
  paymentMode: "CASH",
  paymentStatus: "PAID",
  isInterstate: false,
  items: [
    {
      medicineName: "Paracetamol 500mg", hsnCode: "3004", batchNumber: "B12",
      expiryDate: "2028-06-30", mrp: 130, quantity: 2, freeQty: 5, discount: 0,
      gstRate: 12, rate: 120, taxableAmount: 235, cgst: 5.88, sgst: 5.88, igst: 0, amount: 246.75,
    },
    {
      medicineName: "Vitamin C Tablets", hsnCode: "3004", batchNumber: "C45",
      expiryDate: "2028-06-30", mrp: 220, quantity: 1, discount: 0,
      gstRate: 12, rate: 220, taxableAmount: 220, cgst: 13.2, sgst: 13.2, igst: 0, amount: 246.4,
    },
  ],
  subtotal: 480, discountAmount: 5,
  taxableAmount: 695, cgst: 25.07, sgst: 25.07, igst: 0,
  totalGst: 50.15, totalAmount: 745,
  roundOff: -0.15,
};

function renderView(config: Partial<InvoiceSettingsConfig> = {}) {
  return render(<TaxWholesaleInvoiceView invoice={INVOICE} config={config} pharmacy={PHARMACY} />);
}

describe("TaxWholesaleInvoiceView", () => {
  it("renders an A4-landscape page", () => {
    const { container } = renderView();
    const page = container.firstElementChild as HTMLElement;
    expect(page.style.width).toBe("297mm");
  });

  it("always prints the GST-mandatory columns", () => {
    // showGstRate / showHsn are locked on by normalizeInvoiceSettings even if a
    // stored blob turns them off.
    renderView({ columns: { showHsn: false, showGstRate: false } as never });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("HSN");
    expect(headers).toContain("CGST");
    expect(headers).toContain("SGST");
    expect(headers).toContain("Total");
  });

  it("pads the grid to a constant row count", () => {
    renderView();
    // 1 header row + 2 item rows + 6 blank rows + 1 column-totals row
    expect(screen.getAllByRole("row")).toHaveLength(10);
  });

  it("sums the money columns in the Column Totals row", () => {
    renderView({ columns: { showFreeQty: true } as never });
    const totalsRow = screen.getByText("Column Totals").closest("tr")!;
    const cells = within(totalsRow).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("5.00");     // free qty: 5 + 0
    expect(cells).toContain("19.08");    // per-line CGST column: 5.88 + 13.20
    expect(cells).toContain("493.15");   // line amount total: 246.75 + 246.40
  });

  it("shows the Wholesale Details block only when a buyer GSTIN is present", () => {
    const { rerender } = renderView({ patient: { showBuyerGstin: true } as never });
    expect(screen.queryByText("Wholesale Details")).not.toBeInTheDocument();

    rerender(
      <TaxWholesaleInvoiceView
        invoice={{ ...INVOICE, buyerGstin: "07BBBBB1111B1Z1" }}
        config={{ patient: { showBuyerGstin: true } as never }}
        pharmacy={PHARMACY}
      />,
    );
    expect(screen.getByText("Wholesale Details")).toBeInTheDocument();
    expect(screen.getByText(/Buyer GSTIN: 07BBBBB1111B1Z1/)).toBeInTheDocument();
  });

  it("draws the Bank Details box only when enabled", () => {
    renderView();
    expect(screen.queryByText("Bank Details")).not.toBeInTheDocument();

    renderView({ bank: { show: true, bankName: "State Bank of India", ifsc: "SBIN0000123" } as never });
    expect(screen.getByText("Bank Details")).toBeInTheDocument();
    expect(screen.getByText("Bank: State Bank of India")).toBeInTheDocument();
    expect(screen.getByText("IFSC: SBIN0000123")).toBeInTheDocument();
  });

  it("foots the totals block: Grand Total + Round Off = Rounded Total", () => {
    renderView();
    expect(screen.getByText("Grand Total").parentElement).toHaveTextContent("745.15");
    expect(screen.getByText("Round Off").parentElement).toHaveTextContent("0.15");
    expect(screen.getByText("Rounded Total").parentElement).toHaveTextContent("745");
  });

  it("honours the toggleable Financial Summary rows", () => {
    // The GST-locked rows (Taxable/CGST/SGST/GST breakdown) always show; these are
    // the ones a pharmacy can actually turn off.
    renderView({ totals: {
      showSubtotal: false, showSavings: false, showAmountWords: false, showRoundOff: false,
    } as never });
    expect(screen.queryByText("Subtotal (MRP)")).not.toBeInTheDocument();
    expect(screen.queryByText("You Save")).not.toBeInTheDocument();
    expect(screen.queryByText(/Amount in Words/)).not.toBeInTheDocument();
    expect(screen.queryByText("Round Off")).not.toBeInTheDocument();
    expect(screen.getByText("Grand Total")).toBeInTheDocument();  // always on
    expect(screen.getByText("Taxable")).toBeInTheDocument();      // GST-locked, always on

    renderView({ totals: { showSubtotal: true, showSavings: true } as never });
    expect(screen.getByText("Subtotal (MRP)")).toBeInTheDocument();
    expect(screen.getByText("You Save")).toBeInTheDocument();
  });

  it("honours the Patient Info toggles", () => {
    const { rerender } = renderView({ patient: { showName: false } as never });
    expect(screen.queryByText("Rohit Sharma")).not.toBeInTheDocument();

    rerender(
      <TaxWholesaleInvoiceView
        invoice={{ ...INVOICE, uhid: "UHID-42", abha: "91-0000-0000-0000" }}
        config={{ patient: { showName: true, showUhid: true, showAbha: true } as never }}
        pharmacy={PHARMACY}
      />,
    );
    expect(screen.getByText("Rohit Sharma")).toBeInTheDocument();
    expect(screen.getByText("UHID: UHID-42")).toBeInTheDocument();
    expect(screen.getByText("ABHA: 91-0000-0000-0000")).toBeInTheDocument();
  });

  it("honours the header alignment setting", () => {
    const { container } = renderView({ header: { align: "right" } as never });
    // the pharmacy-name element sits in a block that carries the alignment
    const name = screen.getByText("HealthPlus Pharmacy");
    expect((name.parentElement as HTMLElement).style.textAlign).toBe("right");
    expect(container).toBeTruthy();
  });

  it("applies paper.marginMm and paper.contentScale", () => {
    const { container } = render(
      <TaxWholesaleInvoiceView
        invoice={INVOICE}
        config={{ paper: { size: "A4", marginMm: 20, contentScale: 1.2 } as never }}
        pharmacy={PHARMACY}
      />,
    );
    const page = container.firstElementChild as HTMLElement;
    expect(page.style.padding).toBe("20mm");
    expect(page.style.fontSize).toBe("12px"); // 10 * 1.2
  });

  it("pads the grid to paper.minRows", () => {
    render(
      <TaxWholesaleInvoiceView invoice={INVOICE} config={{ paper: { size: "A4", minRows: 4 } as never }} pharmacy={PHARMACY} />,
    );
    // 1 header + 2 items + 2 blank (to reach 4) + 1 column-totals
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });

  it("switches to an IGST column for an interstate bill", () => {
    const interstate: PrintInvoiceData = {
      ...INVOICE, isInterstate: true, cgst: 0, sgst: 0, igst: 50.15,
      items: INVOICE.items.map((i) => ({ ...i, cgst: 0, sgst: 0, igst: i.cgst + i.sgst })),
    };
    render(<TaxWholesaleInvoiceView invoice={interstate} config={{}} pharmacy={PHARMACY} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("IGST");
    expect(headers).not.toContain("CGST");
  });
});
