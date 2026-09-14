import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdvanceModal } from "./AdvanceModal";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";
import { invalidateInvoicePrintConfigCache } from "@/lib/useInvoicePrintConfig";
import { openVoucherPrintWindow } from "@/lib/advanceVoucherPrint";

/**
 * Taking and refunding a deposit — the one dialog in the app that moves money
 * against no bill at all. Two things matter most here: a refund can never exceed
 * what is actually held (the till-side guard ahead of the server's own), and the
 * quick-amount chips exist so the common case needs no typing at all.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});
vi.mock("@/lib/advanceVoucherPrint", () => ({ openVoucherPrintWindow: vi.fn() }));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const mockPrint = openVoucherPrintWindow as ReturnType<typeof vi.fn>;

function respondToPrintConfigFetch() {
  mockApi.get.mockImplementation((url: string) =>
    Promise.resolve({
      data: { data: url.includes("/pharmacy") ? { name: "Test Pharmacy", state: "Karnataka" } : {} },
    }),
  );
}

function renderModal(mode: "take" | "refund", advanceBalance = 1000) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AdvanceModal
          target={{ id: "cust_1", name: "Ramesh Iyer", phone: "9800000000", advanceBalance }}
          mode={mode}
          onClose={onClose}
          onSaved={onSaved}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateInvoicePrintConfigCache();
  respondToPrintConfigFetch();
});

describe("AdvanceModal — take a deposit", () => {
  it("a quick-amount chip fills the field with no typing", async () => {
    renderModal("take");

    await userEvent.click(screen.getByRole("button", { name: "₹2,000" }));

    expect(screen.getByPlaceholderText("0.00")).toHaveValue("2000");
    expect(screen.getByRole("button", { name: "Take & print" })).toBeEnabled();
  });

  it("save is disabled until a positive amount is entered", () => {
    renderModal("take");

    expect(screen.getByRole("button", { name: "Take & print" })).toBeDisabled();
  });

  it("posts to /advances with the amount and mode, prints the voucher, and reports the new balance", async () => {
    mockApi.post.mockResolvedValue({
      data: {
        data: {
          entry: { entryNumber: "ADV-2026-00007", amount: 2000, paymentMode: "CASH", reference: null,
                    notes: null, entryAt: "2026-09-14T10:00:00Z", advanceBalanceAfter: 3000, duesBalanceAfter: 0 },
          balances: { advance: 3000 },
        },
      },
    });
    const { onClose, onSaved } = renderModal("take");

    await userEvent.click(screen.getByRole("button", { name: "₹2,000" }));
    await userEvent.click(screen.getByRole("button", { name: "Take & print" }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
      "/customers/cust_1/advances",
      expect.objectContaining({ amount: 2000, paymentMode: "CASH" }),
    ));
    await waitFor(() => expect(mockPrint).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(3000);
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText(/Took ₹2000\.00 from Ramesh Iyer/)).toBeInTheDocument();
  });

  it("still records the deposit when the voucher cannot print, and says so", async () => {
    // Pharmacy profile never resolves (still loading) — the money must not wait on it.
    mockApi.get.mockImplementation((url: string) =>
      url.includes("/pharmacy") ? new Promise(() => {}) : Promise.resolve({ data: { data: {} } }),
    );
    mockApi.post.mockResolvedValue({
      data: {
        data: {
          entry: { entryNumber: "ADV-2026-00008", amount: 500, paymentMode: "CASH", reference: null,
                    notes: null, entryAt: "2026-09-14T10:00:00Z", advanceBalanceAfter: 500, duesBalanceAfter: 0 },
          balances: { advance: 500 },
        },
      },
    });
    renderModal("take");

    await userEvent.click(screen.getByRole("button", { name: "₹500" }));
    await userEvent.click(screen.getByRole("button", { name: "Take & print" }));

    expect(await screen.findByText(/Couldn't print the voucher/)).toBeInTheDocument();
    expect(mockPrint).not.toHaveBeenCalled();
  });

  it("a server error is surfaced, not swallowed", async () => {
    mockApi.post.mockRejectedValue({ isAxiosError: true, response: { data: { error: "Customer not found" } } });
    renderModal("take");

    await userEvent.click(screen.getByRole("button", { name: "₹500" }));
    await userEvent.click(screen.getByRole("button", { name: "Take & print" }));

    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
  });
});

describe("AdvanceModal — refund a deposit", () => {
  it("the \"All\" chip fills exactly what is held", async () => {
    renderModal("refund", 1250);

    await userEvent.click(screen.getByRole("button", { name: /All · ₹1250\.00/ }));

    expect(screen.getByPlaceholderText("0.00")).toHaveValue("1250");
  });

  it("cannot be pushed past what is held — the button disables and says why", async () => {
    renderModal("refund", 300);

    await userEvent.type(screen.getByPlaceholderText("0.00"), "500");

    expect(screen.getByText(/Only ₹300\.00 is held for Ramesh Iyer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refund & print" })).toBeDisabled();
  });

  it("posts to /refunds, not /advances", async () => {
    mockApi.post.mockResolvedValue({
      data: {
        data: {
          entry: { entryNumber: "REF-2026-00001", amount: 300, paymentMode: "CASH", reference: null,
                    notes: null, entryAt: "2026-09-14T10:00:00Z", advanceBalanceAfter: 0, duesBalanceAfter: 0 },
          balances: { advance: 0 },
        },
      },
    });
    renderModal("refund", 300);

    await userEvent.click(screen.getByRole("button", { name: /All/ }));
    await userEvent.click(screen.getByRole("button", { name: "Refund & print" }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
      "/customers/cust_1/refunds",
      expect.objectContaining({ amount: 300, paymentMode: "CASH" }),
    ));
  });
});
