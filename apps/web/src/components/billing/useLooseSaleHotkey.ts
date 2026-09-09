import { useEffect, useRef } from "react";
import { useBillingStore, type CartItem } from "./useBillingStore";

const canSellLoose = (i: Pick<CartItem, "allowLooseSale" | "unitsPerPack">) =>
  !!i.allowLooseSale && (i.unitsPerPack ?? 0) > 1;

/**
 * "L" flips Strip ⇄ loose (tab / bottle / tube / …) for a cart line from ANYWHERE on
 * the billing screen — the medicine search box, a payment button, an empty patch of
 * the page — not only from inside a cart row.
 *
 * Inside a row, {@link CartRow}'s own `onKeyDown` already handles it (Qty, Free,
 * Disc%), and this listener bails there so the two never both fire. Everywhere else
 * it flips the line the cashier was last working on — tracked via `focusin` — and
 * falls back to the last loose-capable line in the cart. After the flip it drops
 * focus on that line's Qty cell, so the very next keystroke is the new count.
 *
 * The listener is registered once for the lifetime of the billing page and reads the
 * cart straight off the store (`getState`), so nothing about it re-subscribes or
 * re-runs as the cart changes — the keystroke path stays allocation-free and instant.
 *
 * Ignored while a real word is being typed into a text field (a medicine name that
 * starts with "L", a doctor's name, a discount note) and while any modal, drawer or
 * the print overlay owns the screen.
 */
export function useLooseSaleHotkey() {
  const lastRowRef = useRef<string | null>(null);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const row = (e.target as HTMLElement | null)?.closest?.("[data-inventory-id]");
      if (row) lastRowRef.current = row.getAttribute("data-inventory-id");
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "l" && e.key !== "L") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;

      const el = document.activeElement as HTMLElement | null;

      // A cart row's own handler already toggles L when focus is inside it.
      if (el?.closest?.("[data-inventory-id]")) return;
      // A modal / drawer / print overlay (all `position: fixed`) owns the keyboard.
      if (el?.closest?.(".fixed")) return;
      // A real text field — "Losartan" in search, a doctor's name, a note. The
      // Qty/Free/Disc cells are <input>s too, but focus is never in them here (the
      // row check above caught that), and they never accept letters anyway.
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;

      const { items, setSaleUnit } = useBillingStore.getState();
      const tracked = lastRowRef.current
        ? items.find((i) => i.inventoryId === lastRowRef.current)
        : undefined;
      const looseLines = items.filter(canSellLoose);
      const target = (tracked && canSellLoose(tracked) && tracked) || looseLines[looseLines.length - 1];
      if (!target) return;

      e.preventDefault();
      setSaleUnit(target.inventoryId, target.saleUnit === "LOOSE" ? "PACK" : "LOOSE");
      lastRowRef.current = target.inventoryId;

      requestAnimationFrame(() => {
        const qty = document.querySelector<HTMLInputElement>(
          `[data-inventory-id="${target.inventoryId}"] [data-col="qty"]`,
        );
        qty?.focus();
        qty?.select();
      });
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}
