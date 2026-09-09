import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { InvoiceSettingsConfig } from "@pharmacy/types";
import { ThermalReceiptView } from "./ThermalReceiptView";
import type { PrintInvoiceData, PharmacyProfile } from "./InvoicePrintView";

/**
 * The thermal receipt must honour the SAME settings as the A4/A5 invoice wherever
 * the paper allows it. A toggle that silently means different things on different
 * print formats is worse than one that does nothing, because the pharmacy only
 * finds out at the counter with a customer waiting.
 *
 * Settings that describe a page this paper does not have — watermark, logo
 * placement, header alignment, colours — are deliberately excluded, and there are
 * tests below pinning that too so nobody "fixes" it later.
 */

const PHARMACY: PharmacyProfile = {
  name:        "Gita Medical Hall",
  address:     "12 MG Road, Pune 411005",
  phone:       "+91 98765 43210",
  email:       "shop@gita.test",
  website:     "gita.test",
  gstin:       "27ABCDE1234F1Z5",
  drugLicense: "MH-PUN-1234",
  fssai:       "11224567890123",
};

const INVOICE: PrintInvoiceData = {
  invoiceNumber: "BILL-26-27-0001",
  createdAt:     "2026-08-02T10:00:00Z",
  customerName:  "Raju Sharma",
  customerPhone: "9988776655",
  paymentMode:   "CASH",
  paymentStatus: "PAID",
  isInterstate:  false,
  items: [
    {
      medicineName: "Paracetamol 500mg", hsnCode: "30049099", batchNumber: "PCM-1",
      expiryDate: "2027-09-30", mrp: 20, quantity: 2, discount: 25,
      gstRate: 12, rate: 15, taxableAmount: 26.79, cgst: 1.61, sgst: 1.61, igst: 0, amount: 30,
    },
    {
      medicineName: "Vitamin D3", hsnCode: "30049099", batchNumber: "VTD-1",
      expiryDate: "2027-03-31", mrp: 75, quantity: 1, discount: 0,
      gstRate: 5, rate: 75, taxableAmount: 71.43, cgst: 1.79, sgst: 1.79, igst: 0, amount: 75,
    },
  ],
  subtotal: 115, discountAmount: 10,
  taxableAmount: 98.22, cgst: 3.4, sgst: 3.4, igst: 0,
  // taxable + tax = 105.02; roundOff brings it to a whole-rupee 105.00 payable.
  totalGst: 6.8, totalAmount: 105, roundOff: -0.02,
};

/** Renders with a partial config; everything unset falls back to defaults. */
function renderReceipt(config?: Partial<InvoiceSettingsConfig>) {
  const { container } = render(
    <ThermalReceiptView
      invoice={INVOICE}
      pharmacy={PHARMACY}
      config={{ paper: { size: "thermal80" }, ...config }}
    />,
  );
  return container.textContent ?? "";
}

describe("columns follow the same toggles as A4/A5", () => {
  it("shows MRP when enabled and the item is discounted", () => {
    expect(renderReceipt({ columns: { showMrp: true } as never })).toContain("MRP:20.00");
  });

  it("hides MRP when disabled", () => {
    expect(renderReceipt({ columns: { showMrp: false } as never })).not.toContain("MRP:20.00");
  });

  it("omits MRP on an undiscounted line, where it would just repeat the rate", () => {
    // Vitamin D3 has mrp === rate === 75; printing both is noise on a 58mm roll.
    const text = renderReceipt({ columns: { showMrp: true } as never });
    expect(text).not.toContain("MRP:75.00");
  });

  it("shows the unit rate when enabled", () => {
    expect(renderReceipt({ columns: { showRate: true } as never })).toContain("2 x 15.00");
  });

  it("drops the rate but keeps quantity and line amount when disabled", () => {
    // A receipt with no quantity or no amount is not a receipt, so those stay.
    const text = renderReceipt({ columns: { showRate: false } as never });
    expect(text).not.toContain("x 15.00");
    expect(text).toContain("30.00");
  });

  it("shows the per-line discount badge when enabled", () => {
    expect(renderReceipt({ columns: { showDiscount: true } as never })).toContain("(-25%)");
  });

  it("hides the per-line discount badge when disabled", () => {
    expect(renderReceipt({ columns: { showDiscount: false } as never })).not.toContain("(-25%)");
  });

  it("prints the scheme quantity when the line has one", () => {
    const { container } = render(
      <ThermalReceiptView
        invoice={{ ...INVOICE, items: [{ ...INVOICE.items[0]!, freeQty: 2 }, INVOICE.items[1]!] }}
        pharmacy={PHARMACY}
        config={{ paper: { size: "thermal80" }, columns: { showFreeQty: true } as never }}
      />,
    );
    expect(container.textContent).toContain("+ 2 FREE");
  });

  it("prints nothing for a line with no scheme, even with the column on", () => {
    // Every ordinary row gaining a "Free: 0" line would waste paper on a roll.
    const text = renderReceipt({ columns: { showFreeQty: true } as never });
    expect(text).not.toContain("FREE");
  });

  it("hides the scheme quantity when the column is disabled", () => {
    const { container } = render(
      <ThermalReceiptView
        invoice={{ ...INVOICE, items: [{ ...INVOICE.items[0]!, freeQty: 2 }, INVOICE.items[1]!] }}
        pharmacy={PHARMACY}
        config={{ paper: { size: "thermal80" }, columns: { showFreeQty: false } as never }}
      />,
    );
    expect(container.textContent).not.toContain("FREE");
  });

  it("hides batch and expiry when disabled", () => {
    const text = renderReceipt({ columns: { showBatch: false, showExpiry: false } as never });
    expect(text).not.toContain("PCM-1");
    expect(text).not.toContain("Exp:");
  });
});

describe("totals follow the same toggles as A4/A5", () => {
  it("shows You Save when enabled and a discount exists", () => {
    expect(renderReceipt({ totals: { showSavings: true } as never })).toContain("You Save:");
  });

  it("hides You Save when disabled", () => {
    expect(renderReceipt({ totals: { showSavings: false } as never })).not.toContain("You Save:");
  });

  it("shows the amount in words when enabled", () => {
    const text = renderReceipt({ totals: { showAmountWords: true } as never });
    expect(text).toContain("In Words:");
    expect(text.toLowerCase()).toContain("rupees");
  });

  it("hides the amount in words when disabled", () => {
    expect(renderReceipt({ totals: { showAmountWords: false } as never })).not.toContain("In Words:");
  });

  it("hides the subtotal when disabled", () => {
    expect(renderReceipt({ totals: { showSubtotal: false } as never })).not.toContain("Subtotal:");
  });

  it("always prints the net payable regardless of other toggles", () => {
    const text = renderReceipt({
      totals: { showSubtotal: false, showDiscount: false, showSavings: false, showRoundOff: false } as never,
    });
    expect(text).toContain("NET PAYABLE:");
    expect(text).toContain("105");
  });

  it("the totals block foots: taxable + tax + round-off == net payable", () => {
    const text = renderReceipt();
    // Round Off shows the stored footing delta, and the block adds up to a whole rupee.
    expect(text).toContain("Round Off:");
    expect(text).toContain("-0.02");
    // 98.22 + 6.80 + (-0.02) = 105.00
    expect(text).toContain("NET PAYABLE:");
    expect(text).toMatch(/NET PAYABLE:\s*105\.00/);
  });
});

describe("footer follows the same toggles as A4/A5", () => {
  it("prints a signature block when enabled, using the configured label", () => {
    const text = renderReceipt({
      footer: { showSignature: true, signatureLabel: "Authorized Pharmacist" } as never,
    });
    expect(text).toContain("Authorized Pharmacist");
  });

  it("omits the signature block when disabled", () => {
    const text = renderReceipt({
      footer: { showSignature: false, signatureLabel: "Authorized Pharmacist" } as never,
    });
    expect(text).not.toContain("Authorized Pharmacist");
  });

  it("prints contact info when set", () => {
    expect(renderReceipt({ footer: { contactInfo: "Care: 1800-000-000" } as never }))
      .toContain("Care: 1800-000-000");
  });

  it("prints the thank-you text and terms", () => {
    const text = renderReceipt({
      footer: { thankYouText: "Get well soon", terms: "No returns" } as never,
    });
    expect(text).toContain("Get well soon");
    expect(text).toContain("No returns");
  });
});

describe("header follows the same toggles as A4/A5", () => {
  it("prints email, website and FSSAI when enabled", () => {
    const text = renderReceipt({
      header: { showEmail: true, showWebsite: true, showFssai: true } as never,
    });
    expect(text).toContain("shop@gita.test");
    expect(text).toContain("gita.test");
    expect(text).toContain("FSSAI: 11224567890123");
  });

  it("omits them when disabled", () => {
    const text = renderReceipt({
      header: { showEmail: false, showWebsite: false, showFssai: false } as never,
    });
    expect(text).not.toContain("shop@gita.test");
    expect(text).not.toContain("FSSAI:");
  });

  it("honours the pharmacy name override", () => {
    expect(renderReceipt({ branding: { pharmacyNameOverride: "Gita Medicals" } as never }))
      .toContain("Gita Medicals");
  });
});

describe("GST-mandated content is always present", () => {
  // These toggles are locked on in the schema; normalizeInvoiceSettings re-asserts
  // them on read, so even a stored config with them off must still print.
  const allOff: Partial<InvoiceSettingsConfig> = {
    header:  { showGstin: false } as never,
    columns: { showHsn: false, showGstRate: false, showTaxable: false } as never,
    totals:  { showTaxable: false, showCgst: false, showSgst: false, showGstBreakdown: false } as never,
  };

  it("prints the GSTIN even if the stored config says not to", () => {
    expect(renderReceipt(allOff)).toContain("GSTIN: 27ABCDE1234F1Z5");
  });

  it("prints HSN, per-line taxable and per-line GST", () => {
    const text = renderReceipt(allOff);
    expect(text).toContain("HSN:30049099");
    expect(text).toContain("Taxable:26.79");
    expect(text).toContain("CGST 6%");
  });

  it("prints the slab-wise GST summary", () => {
    const text = renderReceipt(allOff);
    expect(text).toContain("GST Summary");
    // Both slabs present in the bill must appear.
    expect(text).toContain("12% on");
    expect(text).toContain("5% on");
  });

  it("prints IGST instead of CGST/SGST on an interstate bill", () => {
    const { container } = render(
      <ThermalReceiptView
        invoice={{ ...INVOICE, isInterstate: true, igst: 6.8, cgst: 0, sgst: 0 }}
        pharmacy={PHARMACY}
        config={{ paper: { size: "thermal80" } }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("IGST");
    expect(text).not.toContain("CGST:");
  });
});

describe("page-only settings are deliberately ignored", () => {
  // Pinned so a later "consistency" pass does not try to honour these on a
  // monospace character stream that has no place to put them.
  it("does not render a watermark", () => {
    expect(renderReceipt({ branding: { watermarkText: "DUPLICATE" } as never }))
      .not.toContain("DUPLICATE");
  });

  it("does not render a logo", () => {
    const { container } = render(
      <ThermalReceiptView
        invoice={INVOICE}
        pharmacy={PHARMACY}
        config={{
          paper: { size: "thermal80" },
          branding: { showLogo: true, logoUrl: "https://cdn.test/logo.png" } as never,
        }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("paper width", () => {
  it("renders narrower for 58mm than 80mm", () => {
    const { container: wide } = render(
      <ThermalReceiptView invoice={INVOICE} pharmacy={PHARMACY} config={{ paper: { size: "thermal80" } }} />,
    );
    const { container: narrow } = render(
      <ThermalReceiptView invoice={INVOICE} pharmacy={PHARMACY} config={{ paper: { size: "thermal58" } }} />,
    );
    const widthOf = (c: HTMLElement) =>
      parseInt((c.firstElementChild as HTMLElement).style.width, 10);

    expect(widthOf(narrow as HTMLElement)).toBeLessThan(widthOf(wide as HTMLElement));
  });

  it("still prints the essentials at 58mm", () => {
    const text = renderReceipt({ paper: { size: "thermal58" } });
    expect(text).toContain("NET PAYABLE:");
    expect(text).toContain("BILL-26-27-0001");
  });
});
