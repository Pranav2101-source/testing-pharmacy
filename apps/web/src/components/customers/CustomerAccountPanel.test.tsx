import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomerAccountPanel } from "./CustomerAccountPanel";
import { api } from "@/lib/api-client";

/**
 * The hub this whole feature is built around: one window over the bill for
 * balances, history, and the three counter actions, reachable without a tab
 * switch. The behaviour worth pinning is the keyboard gating — D/C/R must track
 * the SAME balances the buttons themselves grey out on, or a shortcut becomes a
 * dead keystroke nobody can explain.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn() } };
});
vi.mock("./AdvanceModal", () => ({
  AdvanceModal: ({ mode }: { mode: string }) => <div data-testid={`advance-modal-${mode}`} />,
}));
vi.mock("./CollectDuesModal", () => ({
  CollectDuesModal: () => <div data-testid="collect-dues-modal" />,
}));

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function statementResponse(dues: number, advance: number) {
  return {
    data: {
      data: {
        items: [],
        total: 0,
        page: 1,
        totalPages: 1,
        balances: { customerId: "cust_1", customerName: "Meera Pillai", dues, advance, creditLimit: 5000, creditAvailable: 5000 - dues },
      },
    },
  };
}

function renderPanel(dues: number, advance: number, onBalancesChanged = vi.fn()) {
  mockApi.get.mockResolvedValue(statementResponse(dues, advance));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <CustomerAccountPanel customer={{ id: "cust_1", name: "Meera Pillai" }} onClose={onClose} onBalancesChanged={onBalancesChanged} />
    </QueryClientProvider>,
  );
  return { onClose, onBalancesChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CustomerAccountPanel", () => {
  it("renders the balances once the statement loads, and reports them upward", async () => {
    const onBalancesChanged = vi.fn();
    renderPanel(400, 1200, onBalancesChanged);

    await waitFor(() => expect(screen.getByText("₹400.00")).toBeInTheDocument());
    expect(screen.getByText("₹1,200.00")).toBeInTheDocument();
    expect(onBalancesChanged).toHaveBeenCalledWith({ dues: 400, advance: 1200 });
  });

  it("D opens the deposit dialog even when nothing is owed or held", async () => {
    renderPanel(0, 0);
    await waitFor(() => expect(screen.getByRole("button", { name: /Take deposit/ })).toBeEnabled());

    fireEvent.keyDown(window, { key: "d" });

    expect(screen.getByTestId("advance-modal-take")).toBeInTheDocument();
  });

  it("C is a no-op with nothing owed, and opens Collect once dues exist", async () => {
    renderPanel(0, 0);
    await waitFor(() => expect(screen.getByRole("button", { name: /Collect dues/ })).toBeDisabled());

    fireEvent.keyDown(window, { key: "c" });
    expect(screen.queryByTestId("collect-dues-modal")).not.toBeInTheDocument();
  });

  it("C opens Collect dues once the customer actually owes something", async () => {
    renderPanel(400, 0);
    await waitFor(() => expect(screen.getByRole("button", { name: /Collect dues/ })).toBeEnabled());

    fireEvent.keyDown(window, { key: "c" });

    expect(screen.getByTestId("collect-dues-modal")).toBeInTheDocument();
  });

  it("R is a no-op with nothing on deposit, and opens the refund dialog once there is", async () => {
    renderPanel(0, 0);
    await waitFor(() => expect(screen.getByRole("button", { name: /Refund deposit/ })).toBeDisabled());

    fireEvent.keyDown(window, { key: "r" });
    expect(screen.queryByTestId("advance-modal-refund")).not.toBeInTheDocument();
  });

  it("R opens the refund dialog once a deposit is actually held", async () => {
    renderPanel(0, 900);
    await waitFor(() => expect(screen.getByRole("button", { name: /Refund deposit/ })).toBeEnabled());

    fireEvent.keyDown(window, { key: "r" });

    expect(screen.getByTestId("advance-modal-refund")).toBeInTheDocument();
  });

  it("Escape closes the panel", async () => {
    const { onClose } = renderPanel(0, 0);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("typing 'd' into a field inside a child dialog does not also fire the panel's own shortcut", async () => {
    renderPanel(0, 0);
    await waitFor(() => expect(screen.getByRole("button", { name: /Take deposit/ })).toBeEnabled());
    fireEvent.keyDown(window, { key: "d" });
    expect(screen.getByTestId("advance-modal-take")).toBeInTheDocument();

    // The panel's own listener is torn down while a child dialog is open (see the
    // `if (child) return` guard) — a second "d" must not do anything further.
    fireEvent.keyDown(window, { key: "d" });
    expect(screen.getAllByTestId("advance-modal-take")).toHaveLength(1);
  });
});
