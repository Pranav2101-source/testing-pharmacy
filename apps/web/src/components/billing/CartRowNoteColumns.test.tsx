import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CartRow } from "./CartTable";
import type { CartItem } from "./useBillingStore";

/**
 * The cart's trailing columns:
 *  - "Internal Note": pharmacy-only, muted, read-only — the amber ROUNDED UP chip, the
 *    "{prescribed} ml Rx · {excess} ml excess" microtext, AND the on-hand stock
 *    ("In stock: 5 bottles (500 ml)" / "In stock: 120 tabs"), tone-coded. Never printed.
 *  - "Patient Remarks": editable, seeded from the clinic's dosing directions.
 * The BATCH / LOC cell now carries batch + shelf location only — no stock line.
 */

const noop = () => {};

const base: CartItem = {
  inventoryId: "inv-1", medicineName: "Benadryl Cough Syrup 100ml", hsnCode: "3004", schedule: null,
  batchNumber: "B1", expiryDate: "2035-06-01T00:00:00Z",
  mrp: 120, quantity: 2, freeQty: 0, discount: 0, gstRate: 12,
  availableStock: 5, saleUnit: "PACK", allowLooseSale: false, looseUnits: 0,
  unitsPerPack: 100, baseUnit: "ML", packSize: "100ml",
  dosageInstructions: "5 ml three times a day for 7 days",
  clinicalNote: "105 ml prescribed · billing 2 bottles",
  prescribedVolumeClinical: 105, clinicalUom: "ML", roundedPackCount: 2,
  rate: 120, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, amount: 0,
};

function renderRow(item: CartItem, onPatientRemarksChange = vi.fn()) {
  render(
    <CartRow
      item={item} idx={0} hasConflict={false}
      onKeyNav={noop} onRemove={noop} onQtyChange={noop} onFreeQtyChange={noop}
      onDiscountChange={noop} onSwapBatch={noop} onQtySettled={noop} onFreeSettled={noop}
      onSaleUnitChange={vi.fn()} onFixIssue={noop} onPatientRemarksChange={onPatientRemarksChange}
    />,
  );
  return { onPatientRemarksChange };
}

const internalNote = () => document.querySelector("[data-internal-note]");
const stockSpan = () => document.querySelector("[data-internal-note] span");
const batchCell = () => document.querySelector('button[title="Change batch"]')?.closest("div");

describe("CartRow — Internal Note column", () => {
  it("shows the ROUNDED UP chip, the prescribed-vs-excess microtext, and the stock", () => {
    renderRow(base);
    expect(screen.getByText("Rounded up")).toBeInTheDocument();
    const note = internalNote();
    expect(note).toHaveTextContent("105 ml Rx · 95 ml excess");
    expect(note).toHaveTextContent("In stock: 5 bottles (500 ml)");
  });

  it("the internal note is not rendered inside the patient remarks input", () => {
    renderRow(base);
    const remarks = screen.getByLabelText(/patient remarks/i) as HTMLInputElement;
    expect(remarks.value).not.toContain("excess");
    expect(remarks.value).not.toContain("In stock");
  });

  it("an ordinary tablet line shows just the stock (no chip, no excess)", () => {
    renderRow({
      ...base, medicineName: "Paracetamol 650", baseUnit: "TABLET", unitsPerPack: 15,
      availableStock: 8, packSize: undefined, clinicalNote: undefined,
      prescribedVolumeClinical: undefined, clinicalUom: undefined, roundedPackCount: undefined,
    });
    expect(screen.queryByText("Rounded up")).not.toBeInTheDocument();
    expect(screen.queryByText(/excess/)).not.toBeInTheDocument();
    expect(internalNote()).toHaveTextContent("In stock: 120 tabs");
  });

  it("tones the stock emerald when it is healthy", () => {
    renderRow({ ...base, availableStock: 5 });               // 5 bottles
    expect(stockSpan()?.className).toMatch(/text-emerald-600/);
  });

  it("tones the stock amber when it is low", () => {
    renderRow({ ...base, availableStock: 2 });               // 2 bottles
    expect(stockSpan()?.className).toMatch(/text-amber-600/);
  });

  it("tones the stock red when it is zero", () => {
    renderRow({ ...base, availableStock: 0 });               // out of stock
    expect(stockSpan()?.className).toMatch(/text-red-600/);
  });
});

describe("CartRow — BATCH / LOC column", () => {
  it("carries batch + location only — no stock line", () => {
    renderRow({ ...base, location: "Rack A3" });
    const cell = batchCell();
    expect(cell).toHaveTextContent("B1");
    expect(cell).toHaveTextContent("Rack A3");
    expect(cell?.textContent ?? "").not.toMatch(/in stock/i);
    expect(cell?.textContent ?? "").not.toMatch(/bottles/i);
  });

  it("shows 'No location' when the batch has no shelf location", () => {
    renderRow(base);
    expect(batchCell()).toHaveTextContent("No location");
  });
});

describe("CartRow — Patient Remarks column", () => {
  it("is pre-filled with the clinic's dosing directions", () => {
    renderRow(base);
    const remarks = screen.getByLabelText(/patient remarks/i) as HTMLInputElement;
    expect(remarks.value).toBe("5 ml three times a day for 7 days");
    expect(remarks.readOnly).toBe(false);
  });

  it("edits are reported to the store", () => {
    const { onPatientRemarksChange } = renderRow(base);
    const remarks = screen.getByLabelText(/patient remarks/i);
    fireEvent.change(remarks, { target: { value: "5 ml TDS · after food" } });
    expect(onPatientRemarksChange).toHaveBeenCalledWith("inv-1", "5 ml TDS · after food");
  });

  it("typing 'l' in remarks does not trigger the row's Strip/Loose shortcut", () => {
    const onSaleUnitChange = vi.fn();
    render(
      <CartRow
        item={{ ...base, medicineName: "Paracetamol 650", baseUnit: "TABLET", unitsPerPack: 15, allowLooseSale: true, packSize: undefined }}
        idx={0} hasConflict={false}
        onKeyNav={noop} onRemove={noop} onQtyChange={noop} onFreeQtyChange={noop}
        onDiscountChange={noop} onSwapBatch={noop} onQtySettled={noop} onFreeSettled={noop}
        onSaleUnitChange={onSaleUnitChange} onFixIssue={noop} onPatientRemarksChange={vi.fn()}
      />,
    );
    const remarks = screen.getByLabelText(/patient remarks/i);
    remarks.focus();
    fireEvent.keyDown(remarks, { key: "l" });
    expect(onSaleUnitChange).not.toHaveBeenCalled();
  });
});
