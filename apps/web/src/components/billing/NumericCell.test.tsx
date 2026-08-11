import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumericCell } from "./CartTable";

/**
 * The quantity cell on the bill screen.
 *
 * QA reported it as "selecting the quantity of medicine via keyboard not getting
 * populated properly in the UI, hence calculating final price is reflected
 * incorrect". The cause was a cell bound straight to the clamped store value:
 * emptying it produced Number("") === 0, the store's floor of 1 turned that into 1,
 * and React repainted the digit the cashier had just deleted — so replacing "1" with
 * "25" left "125" in the box and a bill 5x too large.
 *
 * These drive the real component through a real keyboard.
 */

/** A host that clamps the way the billing store does, so the cell faces real pushback. */
function Host({ initial = 1, max, onChange }: { initial?: number; max?: number; onChange?: (n: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <NumericCell
      value={value}
      onCommit={(n) => {
        const clamped = Math.min(Math.max(1, Math.floor(n)), max ?? Number.MAX_SAFE_INTEGER);
        setValue(clamped);
        onChange?.(clamped);
      }}
      dataRow={0}
      dataCol="qty"
    />
  );
}

describe("NumericCell", () => {
  it("can be emptied, and does not repaint the deleted digit", async () => {
    const user = userEvent.setup();
    render(<Host initial={1} />);
    const cell = screen.getByRole("textbox");

    await user.click(cell);
    await user.keyboard("{Backspace}");

    // The original defect in one assertion: this used to read "1" again.
    expect(cell).toHaveValue("");
  });

  it("types 25 as 25, not 125", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={1} onChange={onChange} />);
    const cell = screen.getByRole("textbox");

    await user.click(cell);
    await user.keyboard("{Backspace}25");

    expect(cell).toHaveValue("25");
    expect(onChange).toHaveBeenLastCalledWith(25);
  });

  it("keeps the last good value when the field is left empty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={7} onChange={onChange} />);
    const cell = screen.getByRole("textbox");

    await user.click(cell);
    await user.keyboard("{Backspace}");
    await user.tab();

    // Nothing is committed for an empty cell — committing 0 is what caused the
    // snap-back — and on blur it falls back to the value that still stands.
    expect(onChange).not.toHaveBeenCalled();
    expect(cell).toHaveValue("7");
  });

  it("refuses letters outright", async () => {
    const user = userEvent.setup();
    render(<Host initial={1} />);
    const cell = screen.getByRole("textbox");

    await user.click(cell);
    await user.keyboard("{Backspace}12abc3");

    expect(cell).toHaveValue("123");
  });

  it("shows what was typed while typing, then the clamped truth on blur", async () => {
    const user = userEvent.setup();
    render(<Host initial={1} max={3} />);
    const cell = screen.getByRole("textbox");

    await user.click(cell);
    await user.keyboard("{Backspace}25");
    // Mid-edit the cashier sees their own keystrokes rather than a number fighting
    // back at them — the snap-back is what made the old cell unusable.
    expect(cell).toHaveValue("25");

    await user.tab();
    expect(cell).toHaveValue("3");
  });

  it("commits every keystroke so the running total is never stale", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={1} onChange={onChange} />);

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Backspace}25");

    expect(onChange.mock.calls.map(([n]) => n)).toEqual([2, 25]);
  });

  it("reports the number that was typed, not the one that was kept", async () => {
    const user = userEvent.setup();
    const onSettle = vi.fn();
    render(
      <NumericCell value={3} onCommit={() => {}} onSettle={onSettle} dataRow={0} dataCol="qty" />,
    );

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Backspace}25");
    await user.tab();

    // This is what lets the row say "only 3 in stock" instead of clamping in silence.
    expect(onSettle).toHaveBeenCalledWith(25);
  });

  it("renders blank rather than 0 when asked, for the scheme-quantity column", async () => {
    render(<NumericCell value={0} onCommit={() => {}} blankWhenZero dataRow={0} dataCol="free" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  describe("decimal mode, for the discount column", () => {
    it("accepts one decimal point and drops the rest", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <NumericCell value={0} onCommit={onChange} decimals dataRow={0} dataCol="dis" />,
      );
      const cell = screen.getByRole("textbox");

      await user.click(cell);
      await user.keyboard("{Backspace}2.5.7");

      expect(cell).toHaveValue("2.57");
      expect(onChange).toHaveBeenLastCalledWith(2.57);
    });

    it("does not commit a bare decimal point mid-typing", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <NumericCell value={0} onCommit={onChange} decimals dataRow={0} dataCol="dis" />,
      );

      await user.click(screen.getByRole("textbox"));
      await user.keyboard("{Backspace}.");

      // Number(".") is NaN; committing it would poison every total on the bill.
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
