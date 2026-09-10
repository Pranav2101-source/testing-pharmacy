import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StockActionPanel, { pieceNoun, type StockInfo } from "./StockActionPanel";
import { ToastProvider } from "@/hooks/useToast";

/**
 * The triage screen's stock line must NAME its number.
 *
 * `availableQty` is a piece count — tablets, capsules, mL — but it was rendered bare
 * ("In stock · 1050"), which told a pharmacist nothing about whether they were reading
 * strips or tablets. The two differ by the pack multiple, so the ambiguity was the whole
 * bug: the same shelf read 1050 here and 10500 in the billing cart, and nothing on either
 * screen said which unit either number was in.
 *
 * The noun comes from the same `saleUnitModel` the billing cart uses, fed by the base
 * unit + packaging word the stock endpoint now returns — so neither screen infers its own.
 */

const noop = () => {};

function renderPanel(stock: StockInfo) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <StockActionPanel
          medicineId="med-1" medicineName="X" schedule={null} remaining={10}
          prescriptionItemId="item-1" stock={stock} stockCheckFailed={false}
          resolution={undefined} onResolve={vi.fn()} onClear={noop}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("pieceNoun", () => {
  it("names a countable medicine's pieces", () => {
    expect(pieceNoun({ baseUnit: "TABLET" }, 1050)).toBe("tablets");
    expect(pieceNoun({ baseUnit: "CAPSULE" }, 1455)).toBe("capsules");
    expect(pieceNoun({ baseUnit: "TABLET" }, 1)).toBe("tablet");
  });

  it("does not pluralise a measured unit", () => {
    expect(pieceNoun({ baseUnit: "ML" }, 500)).toBe("mL");
    expect(pieceNoun({ baseUnit: "GM" }, 30)).toBe("g");
  });

  it("falls back to 'units' when nothing classifies the medicine — never 'strips'", () => {
    expect(pieceNoun({ baseUnit: null, unit: null }, 44)).toBe("units");
    expect(pieceNoun({}, 44)).toBe("units");
  });

  it("a packaging word alone does not turn a piece count into a pack count", () => {
    // "Bottle" describes the SEALED unit; availableQty is pieces inside it. Naming these
    // "bottles" would overstate the shelf by the pack multiple.
    expect(pieceNoun({ baseUnit: null, unit: "Bottle" }, 400)).toBe("units");
  });
});

describe("StockActionPanel — stock line", () => {
  it("names the pieces for an in-stock countable line", () => {
    renderPanel({ availableQty: 1050, stockStatus: "in_stock", baseUnit: "TABLET", unit: "Strip" });
    expect(screen.getByText("In stock · 1050 tablets")).toBeInTheDocument();
  });

  it("names the pieces on a low-stock line too", () => {
    renderPanel({ availableQty: 8, stockStatus: "low_stock", baseUnit: "CAPSULE", unit: "Strip" });
    expect(screen.getByText("Low stock · 8 capsules left")).toBeInTheDocument();
  });

  it("still renders a number when the endpoint sends no units", () => {
    // An older server, or a line whose catalogue medicine has since vanished: the number
    // is still worth showing, and "units" is the honest noun for it.
    renderPanel({ availableQty: 44, stockStatus: "in_stock" });
    expect(screen.getByText("In stock · 44 units")).toBeInTheDocument();
  });

  it("says nothing about quantity when the line is out of stock", () => {
    renderPanel({ availableQty: 0, stockStatus: "out_of_stock", baseUnit: "TABLET" });
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
  });
});
