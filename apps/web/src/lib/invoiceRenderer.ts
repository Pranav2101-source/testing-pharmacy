import type { InvoiceSettingsConfig } from "@pharmacy/types";

export type InvoiceRendererKind = "thermal" | "a5landscape" | "wholesale" | "classic";

/**
 * Which print component renders a bill, from the pharmacy's saved settings.
 *
 * Precedence — a physical page choice wins over the layout theme:
 *  1. `thermal`     — a thermal paper size (ThermalReceiptView).
 *  2. `a5landscape` — `paper.size === "A5"`: the 210×148 mm half-sheet
 *     (A5LandscapeInvoiceView). This replaces the old A5 *portrait* output.
 *  3. `wholesale`   — `theme === "tax-wholesale"`: A4 landscape
 *     (TaxWholesaleInvoiceView).
 *  4. `classic`     — the default A4 portrait invoice (InvoicePrintView).
 *
 * One helper so BillingNewPage, BillingDetailPage and the settings-page preview
 * all agree on which view to show.
 */
export function invoiceRendererFor(
  config: Pick<InvoiceSettingsConfig, "paper" | "theme">,
): InvoiceRendererKind {
  if (config.paper.size === "thermal58" || config.paper.size === "thermal80") return "thermal";
  if (config.paper.size === "A5") return "a5landscape";
  if (config.theme === "tax-wholesale") return "wholesale";
  return "classic";
}
