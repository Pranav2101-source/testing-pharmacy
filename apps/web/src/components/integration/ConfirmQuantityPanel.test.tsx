import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmQuantityPanel from "./ConfirmQuantityPanel";
import { ToastProvider } from "@/hooks/useToast";
import { api } from "@/lib/api-client";

/**
 * A line the clinic sent "as directed" (no fixed quantity) is ingested as a `quantity: 0`
 * placeholder rather than rejected — see `PrescriptionItem.needsQuantityConfirmation`. This
 * panel is the only door that resolves it, mirroring ReviewIngestedItemsPanel's shape: show
 * only what needs a human, confirm in place, refresh on success.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { patch: vi.fn() } };
});

const mockApi = api as unknown as { patch: ReturnType<typeof vi.fn> };

function renderPanel(items: Parameters<typeof ConfirmQuantityPanel>[0]["items"], onConfirmed = vi.fn()) {
  return {
    onConfirmed,
    ...render(
      <ToastProvider>
        <ConfirmQuantityPanel prescriptionId="rx_1" items={items} onConfirmed={onConfirmed} />
      </ToastProvider>,
    ),
  };
}

beforeEach(() => {
  mockApi.patch.mockResolvedValue({ data: { data: {} } });
});

describe("ConfirmQuantityPanel", () => {
  it("renders nothing when every line already has a quantity", () => {
    renderPanel([{ id: "i1", medicineName: "Paracetamol", quantity: 10, dosage: null }]);

    expect(screen.queryByText(/need.*a quantity confirmed/i)).not.toBeInTheDocument();
  });

  it("shows only the lines with no quantity, not the ones already set", () => {
    renderPanel([
      { id: "i1", medicineName: "Paracetamol", quantity: 10, dosage: null },
      { id: "i2", medicineName: "Vitamin D3", quantity: 0, dosage: "as directed" },
    ]);

    expect(screen.getByText("1 line needs a quantity confirmed")).toBeInTheDocument();
    expect(screen.getByText("Vitamin D3")).toBeInTheDocument();
    expect(screen.queryByText("Paracetamol")).not.toBeInTheDocument();
  });

  it("the confirm button stays disabled until a positive whole number is entered", async () => {
    renderPanel([{ id: "i1", medicineName: "Vitamin D3", quantity: 0, dosage: null }]);

    const confirmButton = screen.getByRole("button", { name: /confirm/i });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByRole("spinbutton", { name: /quantity for vitamin d3/i }), "0");
    expect(confirmButton).toBeDisabled();

    await userEvent.clear(screen.getByRole("spinbutton", { name: /quantity for vitamin d3/i }));
    await userEvent.type(screen.getByRole("spinbutton", { name: /quantity for vitamin d3/i }), "6");
    expect(confirmButton).toBeEnabled();
  });

  it("confirming sends the quantity to the new endpoint and refreshes", async () => {
    const { onConfirmed } = renderPanel([{ id: "i1", medicineName: "Vitamin D3", quantity: 0, dosage: null }]);

    await userEvent.type(screen.getByRole("spinbutton", { name: /quantity for vitamin d3/i }), "6");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(mockApi.patch).toHaveBeenCalledWith("/prescriptions/rx_1/items/i1/quantity", { quantity: 6 });
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("a failed confirmation surfaces the real error and keeps the row so the pharmacist can retry", async () => {
    mockApi.patch.mockRejectedValueOnce({
      isAxiosError: true, response: { status: 400, data: { error: "This line's quantity is already confirmed" } },
    });
    renderPanel([{ id: "i1", medicineName: "Vitamin D3", quantity: 0, dosage: null }]);

    await userEvent.type(screen.getByRole("spinbutton", { name: /quantity for vitamin d3/i }), "6");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByText(/already confirmed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
  });

  it("shows the specific reason a quantity couldn't be calculated, not just a generic placeholder", () => {
    renderPanel([{
      id: "i1", medicineName: "Cough Syrup", quantity: 0, dosage: "10ml-0-10ml",
      quantityCalculationNote: "This medicine is measured in millilitres, not counted as whole units "
        + "— enter the quantity to dispense manually.",
    }]);

    expect(screen.getByText(/measured in millilitres/i)).toBeInTheDocument();
  });

  it("shows nothing extra for a line no calculation was ever attempted for", () => {
    renderPanel([{ id: "i1", medicineName: "Vitamin D3", quantity: 0, dosage: null, quantityCalculationNote: null }]);

    // Only the ordinary dosage caption — no per-line reason paragraph rendered underneath it.
    expect(screen.getByText("No dosage given · quantity not stated")).toBeInTheDocument();
    expect(screen.queryByText(/measured in|dosing pattern|not a plain daily schedule/i)).not.toBeInTheDocument();
  });

  it("blocks confirming a measured line when the typed count is the clinic's millilitre figure", async () => {
    const { onConfirmed } = renderPanel([{
      id: "i1", medicineName: "Cough Syrup 100ml", quantity: 0, dosage: "3ml-0-3ml",
      quantityCalculationNote: "The clinic prescribed 30 ml, but this medicine is measured in millilitres "
        + "with no pack size on record — enter the number of bottles to dispense (whole sealed bottles, "
        + "not the total millilitres).",
    }]);

    const input = screen.getByRole("spinbutton", { name: /number of bottles/i });

    // 30 = the clinic's mL figure typed in by mistake — hard-blocked.
    await userEvent.type(input, "30");
    expect(screen.getByText(/that's the 30 millilitres the clinic prescribed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();

    // 1 bottle — the real answer — is accepted.
    await userEvent.clear(input);
    await userEvent.type(input, "1");
    expect(screen.getByRole("button", { name: /confirm/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(mockApi.patch).toHaveBeenCalledWith("/prescriptions/rx_1/items/i1/quantity", { quantity: 1 });
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("multiple unconfirmed lines are resolved independently", async () => {
    renderPanel([
      { id: "i1", medicineName: "Vitamin D3", quantity: 0, dosage: null },
      { id: "i2", medicineName: "Zinc", quantity: 0, dosage: null },
    ]);

    expect(screen.getByText("2 lines need a quantity confirmed")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("spinbutton", { name: /quantity for zinc/i }), "3");
    await userEvent.click(screen.getAllByRole("button", { name: /confirm/i })[1]!);

    expect(mockApi.patch).toHaveBeenCalledWith("/prescriptions/rx_1/items/i2/quantity", { quantity: 3 });
    expect(mockApi.patch).not.toHaveBeenCalledWith("/prescriptions/rx_1/items/i1/quantity", expect.anything());
  });
});
