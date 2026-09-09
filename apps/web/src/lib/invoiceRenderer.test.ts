import { describe, expect, it } from "vitest";
import { normalizeInvoiceSettings } from "@pharmacy/types";
import { invoiceRendererFor } from "./invoiceRenderer";

const cfg = (over: Parameters<typeof normalizeInvoiceSettings>[0]) => normalizeInvoiceSettings(over);

describe("invoiceRendererFor", () => {
  it("defaults to the classic A4 portrait renderer", () => {
    expect(invoiceRendererFor(cfg({}))).toBe("classic");
  });

  it("routes thermal paper to the thermal renderer, whatever the theme", () => {
    expect(invoiceRendererFor(cfg({ paper: { size: "thermal80" } as never }))).toBe("thermal");
    expect(invoiceRendererFor(cfg({ paper: { size: "thermal58" } as never, theme: "tax-wholesale" }))).toBe("thermal");
  });

  it("routes A5 to the half-sheet landscape renderer (replacing A5 portrait)", () => {
    expect(invoiceRendererFor(cfg({ paper: { size: "A5" } as never }))).toBe("a5landscape");
  });

  it("A5 wins over the tax-wholesale theme — a page choice beats a layout theme", () => {
    expect(invoiceRendererFor(cfg({ paper: { size: "A5" } as never, theme: "tax-wholesale" }))).toBe("a5landscape");
  });

  it("routes the tax-wholesale theme (on A4) to the wholesale renderer", () => {
    expect(invoiceRendererFor(cfg({ theme: "tax-wholesale" }))).toBe("wholesale");
  });
});
