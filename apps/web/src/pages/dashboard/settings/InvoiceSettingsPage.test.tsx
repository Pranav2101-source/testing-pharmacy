import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api-client";
import { CURRENT_SCHEMA_VERSION, GST_LOCKED_FIELDS } from "@pharmacy/types";
import InvoiceSettingsPage from "./InvoiceSettingsPage";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn(), put: vi.fn() } };
});
const invalidateSpy = vi.fn();
vi.mock("@/lib/useInvoicePrintConfig", () => ({
  invalidateInvoicePrintConfigCache: () => invalidateSpy(),
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.get.mockResolvedValue({ data: { data: null } }); // pharmacy never configured → defaults
  mockApi.put.mockResolvedValue({ data: { data: {} } });
});

async function open() {
  const user = userEvent.setup();
  render(<InvoiceSettingsPage />);
  await waitFor(() => expect(screen.getByText("Save Changes")).toBeEnabled());
  return user;
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Save Changes"));
  await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith("/billing/settings", expect.any(Object)));
  return mockApi.put.mock.calls.at(-1)![1] as Record<string, Record<string, unknown>>;
}

describe("InvoiceSettingsPage — save reliability", () => {
  it("a toggle flips only its own key; siblings in the section are untouched", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Financial Summary" }));

    // "You Saved" is a non-locked toggle. Its switch is the label wrapper's sibling.
    const label = await screen.findByText("You Saved");
    const toggle = label.closest("div")!.nextElementSibling as HTMLElement;
    expect(toggle.getAttribute("role")).toBe("switch");
    await user.click(toggle);

    const p = await save(user);
    expect(p.totals!.showSavings).toBe(false);   // the one we changed
    expect(p.totals!.showSubtotal).toBe(true);   // sibling, still default-on
    expect(p.totals!.showRoundOff).toBe(true);   // sibling, still default-on
    expect(p.footer).toBeDefined();              // other sections intact
    expect(p.branding).toBeDefined();
  });

  it("the payload can never carry a GST-locked field as disabled", async () => {
    const p = await save(await open());
    for (const path of Object.keys(GST_LOCKED_FIELDS)) {
      const [sec, field] = path.split(".");
      expect(p[sec!]![field!], `${path} must be true in the payload`).toBe(true);
    }
  });

  it("stamps the schema version and drops the server-managed sequence", async () => {
    const p = await save(await open());
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(p.numbering).not.toHaveProperty("currentSequence");
  });

  it("busts the print-config cache on save so billing applies it immediately", async () => {
    const user = await open();
    await user.click(screen.getByText("Save Changes"));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
  });
});
