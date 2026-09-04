import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ThermalReceiptView } from "./ThermalReceiptView";
import { InvoicePrintView, type PrintInvoiceData } from "./InvoicePrintView";
import { calcGstFromMrp, perPieceMrp } from "@pharmacy/utils";
import { defaultInvoiceSettings } from "@pharmacy/types";

/**
 * The printed bill for a cut-strip line — the one thing only a render test proves.
 *
 * A loose line stores the printed PACK MRP and a per-piece rate (fix H2); the tax
 * is reverse-calculated from that same 2dp per-piece figure (fix H1) so "qty x rate"
 * on the paper reconciles with the line amount. Batch, expiry, MRP and rate are all
 * FORCED onto a loose line regardless of the pharmacy's column toggles — a customer
 * holding cut tablets that no longer carry the foil needs every one of them.
 */

// Telma 40: strip of 15 at MRP 137.00, 12% GST. 8 tablets sold loose.
const PACK_MRP = 137;
const UPP = 15;
const PIECE_RATE = perPieceMrp(PACK_MRP, UPP); // 9.13, 2dp rounded down
const looseGst = calcGstFromMrp(PIECE_RATE, 8, 0, 12, false);

const invoice: PrintInvoiceData = {
  invoiceNumber: "INV-0001",
  createdAt: "2026-09-02T10:00:00Z",
  paymentMode: "CASH",
  paymentStatus: "PAID",
  cashierName: "Asha",
  items: [
    {
      medicineName: "Dolo 650", hsnCode: "30049099",
      batchNumber: "PKB-1", expiryDate: "2027-03-01T00:00:00Z",
      mrp: 31.5, quantity: 2, discount: 0, gstRate: 12, rate: 31.5,
      taxableAmount: 56.25, cgst: 3.38, sgst: 3.38, igst: 0, amount: 63,
    },
    {
      medicineName: "Telma 40",
      hsnCode: "30049099",
      batchNumber: "TLM-7",
      expiryDate: "2026-12-01T00:00:00Z",
      mrp: PACK_MRP,          // the PRINTED pack MRP, not the per-piece price
      quantity: 8,            // pieces
      saleUnit: "LOOSE",
      baseUnit: "TABLET",
      discount: 0,
      gstRate: 12,
      rate: PIECE_RATE,       // per piece
      taxableAmount: looseGst.taxableAmount,
      cgst: looseGst.cgst,
      sgst: looseGst.sgst,
      igst: 0,
      amount: looseGst.totalAmount,
    },
  ],
  subtotal: 136.04, discountAmount: 0,
  taxableAmount: 56.25 + looseGst.taxableAmount,
  cgst: 3.38 + looseGst.cgst, sgst: 3.38 + looseGst.sgst, igst: 0,
  totalGst: 6.76 + looseGst.cgst + looseGst.sgst,
  totalAmount: 63 + looseGst.totalAmount,
};

/** Columns the pharmacy has switched OFF — the loose line must ignore all of them. */
const columnsAllOff = {
  columns: {
    ...defaultInvoiceSettings.columns,
    showBatch: false, showExpiry: false, showMrp: false, showRate: false,
  },
};

describe("ThermalReceiptView — a cut-strip line", () => {
  it("prices the loose line per piece and marks it loose", () => {
    render(<ThermalReceiptView invoice={invoice} config={columnsAllOff} />);
    // The medicine name carries a "(loose)" marker.
    expect(screen.getByText(/Telma 40/)).toBeInTheDocument();
    expect(screen.getByText(/\(loose\)/)).toBeInTheDocument();
    // Quantity prints with the base unit; the rate is per tablet, not the pack rate.
    const body = document.body.textContent ?? "";
    expect(body).toContain("8 tab x 9.13");
  });

  it("forces batch + expiry onto the line even though both columns are off", () => {
    render(<ThermalReceiptView invoice={invoice} config={columnsAllOff} />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Batch:TLM-7/);
    expect(body).toMatch(/Exp:12\/26/);
  });

  it("shows the real strip MRP labelled as a pack price, not the per-piece figure", () => {
    render(<ThermalReceiptView invoice={invoice} config={columnsAllOff} />);
    const body = document.body.textContent ?? "";
    expect(body).toContain("MRP:137.00/pack");
    expect(body).not.toContain("MRP:9.13");
  });

  it("qty x rate reconciles with the printed line amount to within a paisa", () => {
    render(<ThermalReceiptView invoice={invoice} config={columnsAllOff} />);
    const qtyTimesRate = 8 * PIECE_RATE;                 // 73.04
    expect(Math.abs(qtyTimesRate - invoice.items[1]!.amount)).toBeLessThanOrEqual(0.02);
    expect(document.body.textContent).toContain(invoice.items[1]!.amount.toFixed(2));
  });
});

describe("InvoicePrintView (A4) — a cut-strip line", () => {
  function renderA4() {
    return render(<InvoicePrintView invoice={invoice} config={columnsAllOff} />);
  }

  it("shows the pack MRP with a /pack suffix and the per-piece rate with a /tab suffix", () => {
    renderA4();
    const row = screen.getByText("Telma 40").closest("tr")!;
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent ?? "");
    expect(cells.join(" | ")).toContain("₹137.00/pack");
    expect(cells.join(" | ")).toContain("₹9.13/tab");
    expect(cells.join(" | ")).toContain("8 tab");
  });

  it("forces the batch and expiry columns on for the whole table when a line is loose", () => {
    renderA4();
    // Header cells include Batch and Expiry despite the config turning both off.
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(heads).toEqual(expect.arrayContaining([expect.stringMatching(/Batch/i), expect.stringMatching(/Expiry|Exp/i)]));
    // And the pack line picks up the forced columns too, so the grid stays aligned.
    const packRow = screen.getByText("Dolo 650").closest("tr")!;
    expect(within(packRow).getByText("PKB-1")).toBeInTheDocument();
  });

  it("A4 line amount still reconciles against qty x per-piece rate", () => {
    renderA4();
    const row = screen.getByText("Telma 40").closest("tr")!;
    expect(within(row).getByText(`₹${invoice.items[1]!.amount.toFixed(2)}`)).toBeInTheDocument();
    expect(Math.abs(8 * PIECE_RATE - invoice.items[1]!.amount)).toBeLessThanOrEqual(0.02);
  });

  it("a bill with no loose line is unchanged — hidden columns stay hidden", () => {
    const packOnly: PrintInvoiceData = { ...invoice, items: [invoice.items[0]!] };
    render(<InvoicePrintView invoice={packOnly} config={columnsAllOff} />);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(heads).not.toEqual(expect.arrayContaining([expect.stringMatching(/^Batch$/i)]));
  });
});
