import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useBillingKeyboardShortcuts } from "./useBillingKeyboardShortcuts";

type Handlers = Parameters<typeof useBillingKeyboardShortcuts>[0];

function Harness(props: Partial<Handlers>) {
  const handlers: Handlers = {
    onSave: vi.fn(),
    onClosePrint: vi.fn(),
    onFocusSearch: vi.fn(),
    onSetPaymentMode: vi.fn(),
    isPrintOpen: false,
    onClearBill: vi.fn(),
    ...props,
  };
  useBillingKeyboardShortcuts(handlers);
  return (
    <div>
      <input data-testid="qty" defaultValue="2" />
      <input data-testid="search" data-billing-search defaultValue="" />
      <textarea data-testid="notes" />
      <button data-testid="btn">A button</button>
    </div>
  );
}

beforeEach(cleanup);

describe("useBillingKeyboardShortcuts", () => {
  it("F9 fires Save & Print, even with focus inside a cart input", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const qty = screen.getByTestId("qty");
    qty.focus();
    fireEvent.keyDown(qty, { key: "F9" });
    expect(onSave).toHaveBeenCalledWith("save_print");
  });

  it("F8 fires Save & New from anywhere", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.keyDown(document.body, { key: "F8" });
    expect(onSave).toHaveBeenCalledWith("save_new");
  });

  it("does not fire F9 when a modifier is held (Ctrl+F9 etc.)", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.keyDown(document.body, { key: "F9", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "F9", altKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Ctrl/⌘+S saves a draft only when not typing in a field", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith("save_draft");

    onSave.mockClear();
    const notes = screen.getByTestId("notes");
    notes.focus();
    fireEvent.keyDown(notes, { key: "s", ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Escape closes the receipt overlay while it is open (and does not also clear the bill)", () => {
    const onClosePrint = vi.fn();
    const onClearBill = vi.fn();
    render(<Harness onClosePrint={onClosePrint} onClearBill={onClearBill} isPrintOpen />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClosePrint).toHaveBeenCalledTimes(1);
    expect(onClearBill).not.toHaveBeenCalled();
  });

  it("Escape clears the in-progress bill when the receipt is not up and the keyboard is free", () => {
    const onClearBill = vi.fn();
    render(<Harness onClearBill={onClearBill} isPrintOpen={false} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClearBill).toHaveBeenCalledTimes(1);
  });

  it("Escape does NOT clear the bill from inside an editable field", () => {
    const onClearBill = vi.fn();
    render(<Harness onClearBill={onClearBill} />);
    const notes = screen.getByTestId("notes");
    notes.focus();
    fireEvent.keyDown(notes, { key: "Escape" });
    expect(onClearBill).not.toHaveBeenCalled();
  });

  it("Alt+1..4 sets the payment mode", () => {
    const onSetPaymentMode = vi.fn();
    render(<Harness onSetPaymentMode={onSetPaymentMode} />);
    fireEvent.keyDown(document.body, { key: "2", altKey: true });
    expect(onSetPaymentMode).toHaveBeenCalledWith("UPI");
  });

  describe("Enter — Save & Print when the keyboard is free", () => {
    it("fires Save & Print from the empty medicine-search box", () => {
      const onSave = vi.fn();
      render(<Harness onSave={onSave} />);
      const search = screen.getByTestId("search");
      search.focus();
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onSave).toHaveBeenCalledWith("save_print");
    });

    it("fires from nothing focused (page body)", () => {
      const onSave = vi.fn();
      render(<Harness onSave={onSave} />);
      fireEvent.keyDown(document.body, { key: "Enter" });
      expect(onSave).toHaveBeenCalledWith("save_print");
    });

    it("does NOT fire from inside an editable table input (Qty / Disc / Remarks)", () => {
      const onSave = vi.fn();
      render(<Harness onSave={onSave} />);
      const qty = screen.getByTestId("qty");
      qty.focus();
      fireEvent.keyDown(qty, { key: "Enter" });
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does NOT fire when the search box has a query typed in it", () => {
      const onSave = vi.fn();
      render(<Harness onSave={onSave} />);
      const search = screen.getByTestId("search") as HTMLInputElement;
      search.value = "para";
      search.focus();
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does NOT fire from a focused button (let its native click run)", () => {
      const onSave = vi.fn();
      render(<Harness onSave={onSave} />);
      const btn = screen.getByTestId("btn");
      btn.focus();
      fireEvent.keyDown(btn, { key: "Enter" });
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does NOT fire while a full-screen overlay is open", () => {
      const onSave = vi.fn();
      const overlay = document.createElement("div");
      overlay.className = "fixed inset-0";
      document.body.appendChild(overlay);
      try {
        render(<Harness onSave={onSave} />);
        fireEvent.keyDown(document.body, { key: "Enter" });
        expect(onSave).not.toHaveBeenCalled();
      } finally {
        overlay.remove();
      }
    });

    it("ignores Enter with a modifier held", () => {
      const onSave = vi.fn();
      render(<Harness onSave={onSave} />);
      fireEvent.keyDown(document.body, { key: "Enter", shiftKey: true });
      fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  it("'/' focuses medicine search, but not when a '/' is being typed into a field", () => {
    const onFocusSearch = vi.fn();
    render(<Harness onFocusSearch={onFocusSearch} />);

    fireEvent.keyDown(document.body, { key: "/" });
    expect(onFocusSearch).toHaveBeenCalledTimes(1);

    onFocusSearch.mockClear();
    const qty = screen.getByTestId("qty");
    qty.focus();
    fireEvent.keyDown(qty, { key: "/" });
    expect(onFocusSearch).not.toHaveBeenCalled();
  });
});
