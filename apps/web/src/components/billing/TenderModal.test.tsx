import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenderModal } from "./TenderModal";
import { api } from "@/lib/api-client";

/**
 * The Advance leg is the one tender that can be wrong in a way none of the others
 * can: it draws down money the pharmacy is already holding for a specific customer,
 * so overfilling it is not just a bill that won't balance — it is a promise the
 * server is certain to refuse. These tests pin the two things that keep the dialog
 * honest about that: the leg is capped at what is ACTUALLY held (re-read live, not
 * trusted from whatever the bill happened to carry in), and nothing lets a cashier
 * type past that cap into a state "Apply split" would accept.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function renderModal(props: Partial<Parameters<typeof TenderModal>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <TenderModal
      total={1000}
      initial={[]}
      hasCustomer
      customerId="cust_1"
      advanceAvailable={1000}
      onClose={onClose}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onClose };
}

beforeEach(() => {
  mockApi.get.mockResolvedValue({ data: { data: { advance: 1000 } } });
});

describe("TenderModal — Advance leg", () => {
  it("is disabled with no customer attached", () => {
    renderModal({ hasCustomer: false, customerId: undefined, advanceAvailable: 0 });

    expect(screen.getByLabelText("Advance amount")).toBeDisabled();
  });

  it("is disabled for a customer with nothing on deposit", async () => {
    mockApi.get.mockResolvedValue({ data: { data: { advance: 0 } } });
    renderModal({ advanceAvailable: 0 });

    await waitFor(() => expect(screen.getByLabelText("Advance amount")).toBeDisabled());
    expect(screen.getByText("No deposit held for this customer")).toBeInTheDocument();
  });

  it("re-reads the balance on open rather than trusting the stale prop", async () => {
    // The bill was built with an advance figure captured earlier; a till-mate spent
    // some of it in the meantime. The dialog must reflect what is ACTUALLY held now.
    mockApi.get.mockResolvedValue({ data: { data: { advance: 250 } } });
    renderModal({ advanceAvailable: 1000 });

    await waitFor(() => expect(screen.getByText("₹250.00 held on deposit")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Advance amount"), "500");

    expect(screen.getByText(/Only ₹250\.00 is held on deposit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply split" })).toBeDisabled();
  });

  it("\"Rest\" never fills the Advance leg past what is held", async () => {
    mockApi.get.mockResolvedValue({ data: { data: { advance: 300 } } });
    renderModal({ total: 1000, advanceAvailable: 300 });
    await waitFor(() => expect(screen.getByText("₹300.00 held on deposit")).toBeInTheDocument());

    const restButtons = screen.getAllByRole("button", { name: "Rest" });
    // MODES order: Cash, UPI, Card, On account, Advance.
    await userEvent.click(restButtons[4]!);

    expect(screen.getByLabelText("Advance amount")).toHaveValue("300");
    expect(screen.getByText(/Still to allocate/)).toBeInTheDocument();
  });

  it("balances a Cash + Advance split and confirms with both legs", async () => {
    mockApi.get.mockResolvedValue({ data: { data: { advance: 1000 } } });
    const { onConfirm } = renderModal({ total: 1000, advanceAvailable: 1000 });
    await waitFor(() => expect(screen.getByText("₹1000.00 held on deposit")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Advance amount"), "400");
    await userEvent.type(screen.getByLabelText("Cash amount"), "600");

    const confirm = screen.getByRole("button", { name: "Apply split" });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ mode: "ADVANCE", amount: 400 }),
        expect.objectContaining({ mode: "CASH", amount: 600 }),
      ]),
    );
  });

  it("a failed balance refetch keeps the seeded figure rather than blocking the till", async () => {
    mockApi.get.mockRejectedValue(new Error("network down"));
    renderModal({ advanceAvailable: 750 });

    // No await — the seeded prop must be usable immediately, and stay usable if the
    // refresh never lands.
    expect(screen.getByLabelText("Advance amount")).not.toBeDisabled();
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.getByText("₹750.00 held on deposit")).toBeInTheDocument();
  });
});
