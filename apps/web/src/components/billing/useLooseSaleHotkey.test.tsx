import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useLooseSaleHotkey } from "./useLooseSaleHotkey";
import { useBillingStore, type CartItem } from "./useBillingStore";

/**
 * "L" flips Strip ⇄ loose for the active cart line from ANYWHERE on the billing
 * screen. Inside a cart row {@link CartRow} owns the key (see LooseRowShortcut.test);
 * this hook covers the search box, the payment buttons and a bare page, and picks
 * the line the cashier last touched.
 *
 * The hook reads `document.activeElement` on every keystroke, so these tests set
 * focus explicitly and dispatch the keydown on `document` (where the listener sits)
 * rather than leaning on a testing-library focus model.
 */

const item = (over: Partial<CartItem>): CartItem => ({
  inventoryId: "inv-1", medicineName: "Telma 40", hsnCode: "3004", schedule: null,
  batchNumber: "B1", expiryDate: "2035-06-01T00:00:00Z",
  mrp: 137, quantity: 2, freeQty: 0, discount: 0, gstRate: 12,
  availableStock: 500, saleUnit: "PACK", unitsPerPack: 15, baseUnit: "TABLET",
  allowLooseSale: true, looseUnits: 0,
  rate: 137, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, amount: 0,
  ...over,
});

function Harness() {
  useLooseSaleHotkey();
  const items = useBillingStore((s) => s.items);
  return (
    <div>
      <input data-billing-search aria-label="search" />
      <button type="button">Cash</button>
      <div className="fixed">
        <button type="button">inside a modal</button>
      </div>
      {items.map((i, idx) => (
        <div key={i.inventoryId} data-inventory-id={i.inventoryId}>
          <span data-testid={`unit-${i.inventoryId}`}>{i.saleUnit}</span>
          <input data-row={idx} data-col="qty" aria-label={`qty ${i.inventoryId}`} />
          <input data-row={idx} data-col="dis" aria-label={`dis ${i.inventoryId}`} />
        </div>
      ))}
    </div>
  );
}

const unit = (id: string) => screen.getByTestId(`unit-${id}`).textContent;
const seed = (...items: CartItem[]) => items.forEach((i) => useBillingStore.getState().addItem(i));
const pressL = (opts: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document, { key: "l", ...opts });

beforeEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  useBillingStore.getState().clear();
});

describe("useLooseSaleHotkey — L from anywhere on the billing screen", () => {
  it("flips the line from a bare page (nothing focused) and focuses its Qty", async () => {
    seed(item({ inventoryId: "a" }));
    render(<Harness />);

    pressL();

    expect(unit("a")).toBe("LOOSE");
    await new Promise((r) => requestAnimationFrame(r)); // rAF focus hand-off
    expect(document.activeElement).toBe(screen.getByLabelText("qty a"));
  });

  it("flips the line while focus is on a payment button", () => {
    seed(item({ inventoryId: "a" }));
    render(<Harness />);

    screen.getByRole("button", { name: "Cash" }).focus();
    pressL({ key: "L" });

    expect(unit("a")).toBe("LOOSE");
  });

  it("flips back to Strip when the line is already loose", () => {
    seed(item({ inventoryId: "a", saleUnit: "LOOSE", quantity: 30 }));
    render(<Harness />);

    pressL();

    expect(unit("a")).toBe("PACK");
  });

  it("does NOT fire while typing in the medicine search box (a name may start with L)", () => {
    seed(item({ inventoryId: "a" }));
    render(<Harness />);

    screen.getByLabelText("search").focus();
    pressL();

    expect(unit("a")).toBe("PACK");
  });

  it("does NOT fire while a modal (position: fixed) owns the screen", () => {
    seed(item({ inventoryId: "a" }));
    render(<Harness />);

    screen.getByRole("button", { name: "inside a modal" }).focus();
    pressL();

    expect(unit("a")).toBe("PACK");
  });

  it("leaves the in-row case to CartRow (does nothing when focus is inside a row)", () => {
    seed(item({ inventoryId: "a" }));
    render(<Harness />);

    screen.getByLabelText("qty a").focus();
    pressL();

    // The harness has no CartRow handler, so the unit is unchanged — proving the
    // hook itself deliberately stayed out of the way.
    expect(unit("a")).toBe("PACK");
  });

  it("targets the line the cashier last worked in, not just the last in the cart", () => {
    seed(item({ inventoryId: "a" }), item({ inventoryId: "b" }));
    render(<Harness />);

    // Work in row A (focusin tracks it), then move focus away to a button.
    fireEvent.focusIn(screen.getByLabelText("qty a"));
    screen.getByRole("button", { name: "Cash" }).focus();
    pressL();

    expect(unit("a")).toBe("LOOSE");
    expect(unit("b")).toBe("PACK");
  });

  it("falls back to the last loose-capable line when nothing was focused yet", () => {
    seed(
      item({ inventoryId: "a" }),
      item({ inventoryId: "b", allowLooseSale: false }),
      item({ inventoryId: "c" }),
    );
    render(<Harness />);

    pressL();

    expect(unit("c")).toBe("LOOSE");
    expect(unit("a")).toBe("PACK");
  });

  it("does nothing when no line can be sold loose", () => {
    seed(item({ inventoryId: "a", allowLooseSale: false }));
    render(<Harness />);

    pressL();

    expect(unit("a")).toBe("PACK");
  });

  it("ignores Ctrl/Cmd+L and auto-repeat", () => {
    seed(item({ inventoryId: "a" }));
    render(<Harness />);

    pressL({ ctrlKey: true });
    pressL({ repeat: true });

    expect(unit("a")).toBe("PACK");
  });
});
