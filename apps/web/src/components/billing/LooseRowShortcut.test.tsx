import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CartRow } from "./CartTable";
import type { CartItem } from "./useBillingStore";

/**
 * "L" toggles Strip/Loose for a cart line. It used to be wired only to the Qty
 * cell's own onKeyDown, so it silently did nothing from Free or Disc% — a cashier
 * who'd just tabbed off Qty had no way to know the shortcut had stopped working.
 * It's now a single handler on the row itself (see handleRowKeyDown in
 * CartTable.tsx), reached by every cell in the row through normal event bubbling.
 *
 * CartRow takes every dependency as a prop — no store/query/toast context needed —
 * so these render it in isolation and drive it through a real keyboard.
 */

const noop = () => {};

const looseItem: CartItem = {
  inventoryId: "inv-1", medicineName: "Telma 40", hsnCode: "3004", schedule: null,
  batchNumber: "B1", expiryDate: "2027-06-01T00:00:00Z",
  mrp: 137, quantity: 2, freeQty: 0, discount: 0, gstRate: 12,
  availableStock: 10, saleUnit: "PACK", unitsPerPack: 15, baseUnit: "TABLET",
  allowLooseSale: true, looseUnits: 0,
  rate: 137, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, amount: 0,
};

function renderRow(item: CartItem, onSaleUnitChange = vi.fn()) {
  const utils = render(
    <CartRow
      item={item}
      idx={0}
      hasConflict={false}
      onKeyNav={noop}
      onRemove={noop}
      onQtyChange={noop}
      onFreeQtyChange={noop}
      onDiscountChange={noop}
      onSwapBatch={noop}
      onQtySettled={noop}
      onFreeSettled={noop}
      onSaleUnitChange={onSaleUnitChange}
      onFixIssue={noop}
    />,
  );
  return { ...utils, onSaleUnitChange };
}

function cell(container: HTMLElement, col: "qty" | "free" | "dis") {
  return container.querySelector<HTMLInputElement>(`[data-col="${col}"]`)!;
}

describe('cart row "L" shortcut', () => {
  it("toggles Strip/Loose from the Qty cell", async () => {
    const user = userEvent.setup();
    const { container, onSaleUnitChange } = renderRow(looseItem);

    await user.click(cell(container, "qty"));
    await user.keyboard("l");

    expect(onSaleUnitChange).toHaveBeenCalledWith("inv-1", "LOOSE");
  });

  it("toggles Strip/Loose from the Free cell", async () => {
    const user = userEvent.setup();
    const { container, onSaleUnitChange } = renderRow(looseItem);

    await user.click(cell(container, "free"));
    await user.keyboard("L");

    expect(onSaleUnitChange).toHaveBeenCalledWith("inv-1", "LOOSE");
  });

  it("toggles Strip/Loose from the Disc% cell", async () => {
    const user = userEvent.setup();
    const { container, onSaleUnitChange } = renderRow(looseItem);

    await user.click(cell(container, "dis"));
    await user.keyboard("l");

    expect(onSaleUnitChange).toHaveBeenCalledWith("inv-1", "LOOSE");
  });

  it("toggles back to Strip when the line is already loose", async () => {
    const user = userEvent.setup();
    const { container, onSaleUnitChange } = renderRow({ ...looseItem, saleUnit: "LOOSE" });

    await user.click(cell(container, "qty"));
    await user.keyboard("l");

    expect(onSaleUnitChange).toHaveBeenCalledWith("inv-1", "PACK");
  });

  it("does not let the letter reach the focused cell", async () => {
    const user = userEvent.setup();
    const { container } = renderRow(looseItem);
    const free = cell(container, "free");

    await user.click(free);
    await user.keyboard("l");

    // NumericCell already strips non-digits on change, but this pins that "L" is
    // actually intercepted (preventDefault) before that, not just filtered after.
    expect(free).toHaveValue("");
  });

  it("preserves Free's own keyboard behavior — digits still commit normally", async () => {
    const user = userEvent.setup();
    const onFreeQtyChange = vi.fn();
    const { container } = render(
      <CartRow
        item={looseItem} idx={0} hasConflict={false}
        onKeyNav={noop} onRemove={noop} onQtyChange={noop}
        onFreeQtyChange={onFreeQtyChange} onDiscountChange={noop} onSwapBatch={noop}
        onQtySettled={noop} onFreeSettled={noop}
        onSaleUnitChange={vi.fn()} onFixIssue={noop}
      />,
    );
    const free = cell(container, "free");

    await user.click(free);
    await user.keyboard("3");

    expect(free).toHaveValue("3");
    expect(onFreeQtyChange).toHaveBeenCalledWith("inv-1", 3);
  });

  it("does nothing for a medicine that isn't loose-eligible", async () => {
    const user = userEvent.setup();
    const { container, onSaleUnitChange } = renderRow({ ...looseItem, allowLooseSale: false });

    await user.click(cell(container, "qty"));
    await user.keyboard("l");

    expect(onSaleUnitChange).not.toHaveBeenCalled();
  });

  it('does not react to "L" typed into an input outside this row', async () => {
    const user = userEvent.setup();
    const onSaleUnitChange = vi.fn();
    render(
      <div>
        <input aria-label="outside the cart" />
        <CartRow
          item={looseItem} idx={0} hasConflict={false}
          onKeyNav={noop} onRemove={noop} onQtyChange={noop}
          onFreeQtyChange={noop} onDiscountChange={noop} onSwapBatch={noop}
          onQtySettled={noop} onFreeSettled={noop}
          onSaleUnitChange={onSaleUnitChange} onFixIssue={noop}
        />
      </div>,
    );
    const outside = screen.getByLabelText("outside the cart");

    await user.click(outside);
    await user.keyboard("l");

    expect(onSaleUnitChange).not.toHaveBeenCalled();
    expect(outside).toHaveValue("l");
  });
});
