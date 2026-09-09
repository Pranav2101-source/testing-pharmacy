import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { api } from "@/lib/api-client";
import { defaultInvoiceSettings } from "@pharmacy/types";
import { useInvoicePrintConfig, invalidateInvoicePrintConfigCache } from "./useInvoicePrintConfig";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

/** Route the two parallel GETs the hook fires. */
function respondWith(settings: unknown, pharmacy: unknown = { name: "Test Pharmacy", state: "Delhi" }) {
  mockApi.get.mockImplementation((url: string) =>
    Promise.resolve({ data: { data: url.includes("/pharmacy") ? pharmacy : settings } }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateInvoicePrintConfigCache();
});

describe("useInvoicePrintConfig", () => {
  it("loads the stored settings and normalises them", async () => {
    respondWith({ theme: "tax-wholesale", footer: { thankYouText: "Visit again" } });
    const { result } = renderHook(() => useInvoicePrintConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config.theme).toBe("tax-wholesale");
    expect(result.current.config.footer.thankYouText).toBe("Visit again");
    expect(result.current.config.columns.showHsn).toBe(true); // GST lock re-asserted
    expect(result.current.pharmacy?.name).toBe("Test Pharmacy");
  });

  it("falls back to defaults when the stored settings are malformed", async () => {
    respondWith("not-an-object");
    const { result } = renderHook(() => useInvoicePrintConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual(defaultInvoiceSettings);
  });

  it("a mounted consumer picks up a settings save without remounting", async () => {
    respondWith({ footer: { thankYouText: "First" } });
    const { result } = renderHook(() => useInvoicePrintConfig());
    await waitFor(() => expect(result.current.config.footer.thankYouText).toBe("First"));

    // Simulate InvoiceSettingsPage.handleSave: new value on the server, then bust.
    respondWith({ footer: { thankYouText: "Second" } });
    act(() => { invalidateInvoicePrintConfigCache(); });

    await waitFor(() => expect(result.current.config.footer.thankYouText).toBe("Second"));
  });

  it("deduplicates the fetch across two consumers on the same page", async () => {
    respondWith({});
    const a = renderHook(() => useInvoicePrintConfig());
    const b = renderHook(() => useInvoicePrintConfig());
    await waitFor(() => {
      expect(a.result.current.loading).toBe(false);
      expect(b.result.current.loading).toBe(false);
    });
    // 2 endpoints, fetched once total (not once per consumer).
    expect(mockApi.get).toHaveBeenCalledTimes(2);
  });
});
