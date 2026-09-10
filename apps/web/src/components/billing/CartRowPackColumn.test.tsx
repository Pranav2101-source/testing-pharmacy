import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CartRow } from "./CartTable";
import type { CartItem } from "./useBillingStore";

/**
 * The billing cart's PACK column must read the medicine's real pack size — the
 * catalogue's free-text label first, else a base-unit-aware computed label
 * ("15/strip" for a tablet, "100ml" for a syrup, NEVER "/strip" for a syrup). A
 * "LOOSE OK" flag is only ever a SECONDARY badge next to that label, never a
 * replacement for it. See packDisplayLabel + CartTable's Pack cell.
 */

const noop = () => {};

const base: CartItem = {
  inventoryId: "inv-1", medicineName: "X", hsnCode: "3004", schedule: null,
  batchNumber: "B1", expiryDate: "2035-06-01T00:00:00Z",
  mrp: 137, quantity: 1, freeQty: 0, discount: 0, gstRate: 12,
  availableStock: 10, saleUnit: "PACK", allowLooseSale: false, looseUnits: 0,
  rate: 137, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, amount: 0,
};

function renderRow(item: CartItem) {
  render(
    <CartRow
      item={item} idx={0} hasConflict={false}
      onKeyNav={noop} onRemove={noop} onQtyChange={noop} onFreeQtyChange={noop}
      onDiscountChange={noop} onSwapBatch={noop} onQtySettled={noop} onFreeSettled={noop}
      onSaleUnitChange={vi.fn()} onFixIssue={noop}
    />,
  );
}

describe("CartRow — PACK column", () => {
  it("a classified syrup with a catalogue packSize shows that label, not '/strip'", () => {
    renderRow({ ...base, medicineName: "Cough Syrup 100ml",
      packSize: "100ml", unitsPerPack: 100, baseUnit: "ML" });
    expect(screen.getByText("100ml")).toBeInTheDocument();
    expect(screen.queryByText(/\/strip/i)).not.toBeInTheDocument();
  });

  it("a syrup with NO catalogue packSize still shows a volume label, never '/strip'", () => {
    renderRow({ ...base, medicineName: "Melgain",
      packSize: undefined, unitsPerPack: 60, baseUnit: "ML" });
    expect(screen.getByText("60ml")).toBeInTheDocument();
    expect(screen.queryByText(/\/strip/i)).not.toBeInTheDocument();
  });

  it("a 15-tablet strip shows '15/strip'", () => {
    renderRow({ ...base, medicineName: "Paracetamol 650",
      packSize: undefined, unitsPerPack: 15, baseUnit: "TABLET" });
    expect(screen.getByText("15/strip")).toBeInTheDocument();
  });

  it("a loose-sale medicine keeps its pack label AND shows LOOSE OK as a secondary badge", () => {
    renderRow({ ...base, medicineName: "Paracetamol 650",
      packSize: undefined, unitsPerPack: 15, baseUnit: "TABLET", allowLooseSale: true });
    // The label element and the badge are BOTH present — the badge never replaces the label.
    const label = document.querySelector("[data-pack-label]");
    expect(label).toHaveTextContent("15/strip");
    expect(screen.getByText("LOOSE OK")).toBeInTheDocument();
    // ...and the pack label is never a stray "1" (the truncation-era bug).
    expect(label).not.toHaveTextContent(/^1$/);
  });

  it("a classified syrup with a catalogue packSize AND loose selling shows '100ml' + LOOSE OK", () => {
    renderRow({ ...base, medicineName: "E2E Loose Syrup",
      packSize: "100ml", unitsPerPack: 100, baseUnit: "ML", allowLooseSale: true });
    expect(document.querySelector("[data-pack-label]")).toHaveTextContent("100ml");
    expect(screen.getByText("LOOSE OK")).toBeInTheDocument();
    expect(screen.queryByText(/\/strip/i)).not.toBeInTheDocument();
  });

  // ── The catalogue's own packaging word ────────────────────────────────────────
  // The Melgain regression: an UNCLASSIFIED medicine (no baseUnit) that the catalogue
  // nonetheless records as a bottle. Inventory read `medicine.unit` and said "40 bottles";
  // billing had no such field on the cart line and fell through to "10/strip".

  it("a bottle with no base unit reads '/bottle', not '/strip'", () => {
    renderRow({ ...base, medicineName: "Melgain",
      packSize: undefined, unitsPerPack: 10, baseUnit: undefined, unit: "Bottle" });
    expect(document.querySelector("[data-pack-label]")).toHaveTextContent("10/bottle");
    expect(screen.queryByText(/\/strip/i)).not.toBeInTheDocument();
  });

  it("the catalogue's packaging word wins over anything inferred from the base unit", () => {
    renderRow({ ...base, medicineName: "Lozenges",
      packSize: undefined, unitsPerPack: 20, baseUnit: "TABLET", unit: "Box" });
    expect(document.querySelector("[data-pack-label]")).toHaveTextContent("20/box");
  });

  it("with neither a base unit nor a packaging word, it says 'unit' rather than inventing a strip", () => {
    renderRow({ ...base, medicineName: "Unclassified thing",
      packSize: undefined, unitsPerPack: 10, baseUnit: undefined, unit: undefined });
    expect(document.querySelector("[data-pack-label]")).toHaveTextContent("10/unit");
    expect(screen.queryByText(/\/strip/i)).not.toBeInTheDocument();
  });

  it("a measured medicine keeps its volume label even when the catalogue says 'Bottle'", () => {
    renderRow({ ...base, medicineName: "Cough Syrup",
      packSize: undefined, unitsPerPack: 100, baseUnit: "ML", unit: "Bottle" });
    expect(document.querySelector("[data-pack-label]")).toHaveTextContent("100ml");
  });
});
