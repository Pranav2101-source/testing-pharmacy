import { useEffect, useRef } from "react";
import type { ActionId } from "@/lib/billingPreferences";

/**
 * The New Bill screen's global keyboard shortcuts, in one place:
 *
 *   F9        Save & Print   — finalise the bill and print (no preview modal on a
 *                              standard bill; see handleSave)
 *   Enter     Save & Print   — same, when focus is not inside an editable field
 *                              (the medicine-search box while empty counts as "free")
 *   F8        Save & New     — finalise and jump straight to a fresh bill
 *   Ctrl/⌘+S  Save as Draft  — park the bill (ignored while typing in a field)
 *   Esc       dismiss the saved-invoice receipt if it's up, else clear the
 *             in-progress bill (after a confirm — no-op on an empty cart)
 *   /         jump focus back into medicine search
 *   Alt+1..4  payment mode (Cash / UPI / Card / Credit)
 *   F6        the attached customer's account — balances, khata, deposits, collections
 *   F7        split this bill across more than one way of paying
 *
 * Notes:
 *  - **F8 / F9 fire from anywhere**, including with focus inside a cart cell (Qty,
 *    Disc%, Patient Remarks). A function key never types a character, so there is no
 *    "don't fire while typing" exception for it.
 *  - The exception is a dialog that owns the bill's money — the split-payment dialog
 *    and the customer-account panel. While either is open EVERY shortcut here is
 *    suppressed, because both are mid-way through deciding something about how this
 *    bill gets paid: F9 would save a half-entered split, Alt+1..4 would silently
 *    rewrite the payment mode behind the dialog, and F8 would finalise the bill out
 *    from under a deposit being taken. Each dialog binds its own Escape and Enter.
 *  - **Enter and Esc are scoped** to when nothing editable/interactive has focus (or
 *    the search box is empty), and no full-screen overlay is open — so they never
 *    hijack a keystroke a field, menu, or modal is entitled to.
 *  - The listener runs on `window` in the bubble phase — a field that deliberately
 *    `stopPropagation()`s a key (the cancel-reason input swallows its own Escape)
 *    keeps working. No cart cell stops key propagation, so F8 / F9 still reach here.
 *  - `preventDefault()` is called for every handled key.
 *
 * The save handler passed here is the SAME one the Save button dispatches to
 * (`handleSave` in BillingNewPage). Latest callbacks are read through a ref so the
 * listener is registered once for the life of the screen and never goes stale.
 */
export function useBillingKeyboardShortcuts(handlers: {
  /** Same handler the Save button dispatches to. `"save_print"` for F9/Enter, `"save_new"` for F8, `"save_draft"` for Ctrl+S. */
  onSave: (action: ActionId) => void;
  /** Dismiss the saved-invoice receipt overlay (Esc, when it's up). */
  onClosePrint: () => void;
  /** Move focus into the medicine-search box ("/"). */
  onFocusSearch: () => void;
  /** Set the bill's payment mode (Alt+1..4). */
  onSetPaymentMode: (mode: "CASH" | "UPI" | "CARD" | "CREDIT") => void;
  /** True while the saved-invoice print overlay is up — changes what Esc does. */
  isPrintOpen: boolean;
  /** Clear the in-progress bill (Esc, when the receipt is not up). Confirms internally. */
  onClearBill: () => void;
  /** Open the split-payment dialog (F7). */
  onSplitPayment: () => void;
  /** Open the attached customer's account panel (F6). */
  onCustomerAccount: () => void;
  /**
   * True while a dialog that decides this bill's money is open — the split-payment
   * dialog or the customer-account panel. Suppresses every shortcut here.
   */
  isSplitOpen: boolean;
}) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = ref.current;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || !!target?.isContentEditable;

      // The split-payment dialog owns the keyboard while it is open — see the note in
      // this hook's doc comment. Its own keys are bound inside the dialog.
      if (h.isSplitOpen) return;

      // ── F6 — the attached customer's account, over the bill rather than away from it. ──
      if (e.key === "F6" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && !h.isPrintOpen) {
        e.preventDefault();
        h.onCustomerAccount();
        return;
      }

      // ── F7 — split this bill across more than one way of paying. ──
      if (e.key === "F7" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && !h.isPrintOpen) {
        e.preventDefault();
        h.onSplitPayment();
        return;
      }

      // ── F9 / F8 — save. Fire regardless of where focus is (including a cart input). ──
      if (e.key === "F9" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        h.onSave("save_print");
        return;
      }
      if (e.key === "F8" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        h.onSave("save_new");
        return;
      }

      // What "free" means for Enter / Esc: nothing editable or clickable owns the
      // keystroke, and no full-screen overlay is open. The empty medicine-search box
      // still counts as free (Enter there is otherwise a no-op — it is where the
      // cursor sits after the page loads).
      const el = target as HTMLInputElement | null;
      const interactive =
        tag === "BUTTON" || tag === "A" || tag === "SELECT" ||
        target?.getAttribute?.("role") === "button" ||
        target?.getAttribute?.("role") === "menuitem" ||
        target?.getAttribute?.("role") === "option";
      const overlayOpen =
        typeof document !== "undefined" && !!document.querySelector(".fixed.inset-0");
      const inEmptySearch =
        el?.getAttribute?.("data-billing-search") != null && !el.value?.trim();
      const keyboardIsFree = !overlayOpen && (inEmptySearch || (!typing && !interactive));

      // ── Enter — Save & Print, when the keyboard is free. ──
      if (
        e.key === "Enter" &&
        !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
        !h.isPrintOpen
      ) {
        if (keyboardIsFree) {
          e.preventDefault();
          h.onSave("save_print");
        }
        return;
      }

      // ── Ctrl/⌘+S — draft. Not while a field has focus (let the browser keep "save page"). ──
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        if (!typing) {
          e.preventDefault();
          h.onSave("save_draft");
        }
        return;
      }

      // ── Esc — dismiss the receipt if it's up, otherwise clear the in-progress bill. ──
      if (e.key === "Escape") {
        if (h.isPrintOpen) {
          e.preventDefault();
          h.onClosePrint();
        } else if (keyboardIsFree) {
          e.preventDefault();
          h.onClearBill();
        }
        return;
      }

      // ── "/" — back to medicine search, unless a "/" is being typed into a field. ──
      if (e.key === "/" && !h.isPrintOpen && !typing) {
        e.preventDefault();
        h.onFocusSearch();
        return;
      }

      // ── Alt+1..4 — payment mode. ──
      if (e.altKey) {
        const map: Record<string, "CASH" | "UPI" | "CARD" | "CREDIT"> =
          { "1": "CASH", "2": "UPI", "3": "CARD", "4": "CREDIT" };
        const mode = map[e.key];
        if (mode) {
          e.preventDefault();
          h.onSetPaymentMode(mode);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
