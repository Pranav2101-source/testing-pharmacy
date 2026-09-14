import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectDuesModal } from "./CollectDuesModal";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";

/**
 * Recording a customer paying down their khata. The backend
 * (`POST /billing/{id}/payments`) has been correct and tested for two releases with
 * zero frontend callers — this dialog is the only caller, so its own logic (which
 * bill, how much, is that amount even legal) is what's actually new and needs
 * covering.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const OLD_BILL = {
  id: "inv_old", invoiceNumber: "INV-001", createdAt: "2026-08-01T10:00:00Z",
  totalAmount: 1000, amountPaid: 0, balanceDue: 1000, paymentStatus: "PENDING",
};
const NEW_BILL = {
  id: "inv_new", invoiceNumber: "INV-002", createdAt: "2026-09-01T10:00:00Z",
  totalAmount: 500, amountPaid: 200, balanceDue: 300, paymentStatus: "PARTIAL",
};

function respondWithBills(pending: unknown[], partial: unknown[]) {
  mockApi.get.mockImplementation((url: string) =>
    Promise.resolve({ data: { data: { items: url.includes("PARTIAL") ? partial : pending } } }),
  );
}

function renderModal(outstanding = 1300) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CollectDuesModal customer={{ id: "cust_1", name: "Meera Pillai", outstanding }} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CollectDuesModal", () => {
  it("auto-selects the oldest unpaid bill and pre-fills its full balance", async () => {
    respondWithBills([OLD_BILL], [NEW_BILL]);
    renderModal();

    await waitFor(() => expect(screen.getByText("INV-001")).toBeInTheDocument());
    expect(screen.getByDisplayValue("1000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record payment/ })).toBeEnabled();
  });

  it("an amount over the selected bill's balance is refused before it ever reaches the server", async () => {
    respondWithBills([OLD_BILL], []);
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("1000")).toBeInTheDocument());

    const amountField = screen.getByDisplayValue("1000");
    await userEvent.clear(amountField);
    await userEvent.type(amountField, "5000");

    expect(screen.getByText(/only has ₹1,000\.00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record payment/ })).toBeDisabled();
  });

  it("posts amount, mode and bill id, then closes and reports success", async () => {
    respondWithBills([OLD_BILL], []);
    mockApi.post.mockResolvedValue({ data: { data: {} } });
    const { onClose } = renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("1000")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record payment/ }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
      "/billing/inv_old/payments",
      expect.objectContaining({ amount: 1000, paymentMode: "CASH" }),
    ));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty state and disables Record when there is nothing unpaid", async () => {
    respondWithBills([], []);
    renderModal();

    expect(await screen.findByText(/No unpaid bills/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record payment/ })).toBeDisabled();
  });

  it("a server error is surfaced rather than silently closing the dialog", async () => {
    respondWithBills([OLD_BILL], []);
    mockApi.post.mockRejectedValue({ isAxiosError: true, response: { data: { error: "Payment exceeds outstanding balance" } } });
    const { onClose } = renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("1000")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Record payment/ }));

    expect(await screen.findByText("Payment exceeds outstanding balance")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
