import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PrescriptionFulfilmentPanel from "./PrescriptionFulfilmentPanel";
import { useBillingStore } from "@/components/billing/useBillingStore";
import { api } from "@/lib/api-client";

/**
 * Lets a pharmacist say which prescribed line a cart line fulfils — needed only for a
 * SUBSTITUTION, where nothing links the sold medicine to the prescribed one by name. A line
 * the clinic sent with no usable quantity (see PrescriptionItem.needsQuantityConfirmation) is
 * ingested as `quantity: 0` rather than rejected, and the panel's original "not yet settled"
 * filter (`dispensedQty < quantity`) read that placeholder as `0 < 0 = false` — the same as
 * an already-fully-collected line. That made an unconfirmed line invisible here: a pharmacist
 * filling it had no way to attribute the sale at all. These tests cover that it is now visible,
 * labelled honestly (not "0 left"), and still attributable via the exact same PATCH.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function renderPanel(prescriptionId = "rx_1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionFulfilmentPanel prescriptionId={prescriptionId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useBillingStore.getState().clear();
  useBillingStore.getState().addItem({
    inventoryId: "inv-1", medicineName: "Azithromycin 500mg (Substitute)", hsnCode: "3004",
    schedule: null, batchNumber: "B-9001", expiryDate: "2027-12-31T00:00:00Z",
    mrp: 89, quantity: 1, discount: 0, gstRate: 12, availableStock: 40,
  });
});

describe("PrescriptionFulfilmentPanel: visibility", () => {
  it("renders nothing for a counter-written prescription (nobody to report to)", async () => {
    mockApi.get.mockResolvedValue({ data: { data: {
      id: "rx_1", externalTenantId: null,
      items: [{ id: "i1", medicineName: "Dolo 650", medicineId: "med_1", quantity: 10, dispensedQty: 0 }],
    } } });
    renderPanel();

    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByText(/prescribed lines/i)).not.toBeInTheDocument();
  });

  it("renders nothing once every prescribed line is already fully collected", async () => {
    mockApi.get.mockResolvedValue({ data: { data: {
      id: "rx_1", externalTenantId: "clinic_1",
      items: [{ id: "i1", medicineName: "Dolo 650", medicineId: "med_1", quantity: 10, dispensedQty: 10 }],
    } } });
    renderPanel();

    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByText(/prescribed lines/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Dolo 650")).not.toBeInTheDocument();
  });

  it("shows a partially-collected line with a real remaining count", async () => {
    mockApi.get.mockResolvedValue({ data: { data: {
      id: "rx_1", externalTenantId: "clinic_1",
      items: [{ id: "i1", medicineName: "Dolo 650", medicineId: "med_1", quantity: 10, dispensedQty: 4 }],
    } } });
    renderPanel();

    expect(await screen.findByText("Dolo 650")).toBeInTheDocument();
    expect(screen.getByText(/6 left/)).toBeInTheDocument();
  });

  it("names a pharmacist-settled measured line's remainder in bottles, not a fabricated 'ml'", async () => {
    // confirmQuantity stores the confirmed pack count as BOTH quantity and roundedPackCount —
    // "remaining" here is bottles, not mL, and formatMeasuredAmount's mL-shaped fallback would
    // otherwise call it "3 ml left" beside a bill that reads "3 bottles".
    mockApi.get.mockResolvedValue({ data: { data: {
      id: "rx_1", externalTenantId: "clinic_1",
      items: [{
        id: "i1", medicineName: "QA Held Tonic", medicineId: "med_3", quantity: 3, dispensedQty: 0,
        clinicalUom: "ML", roundedPackCount: 3,
      }],
    } } });
    renderPanel();

    expect(await screen.findByText("QA Held Tonic")).toBeInTheDocument();
    expect(screen.getByText(/3 bottles left/)).toBeInTheDocument();
    expect(screen.queryByText(/ml left/)).not.toBeInTheDocument();
  });
});

describe("PrescriptionFulfilmentPanel: an unconfirmed-quantity line", () => {
  it("is shown, not hidden as if already settled", async () => {
    mockApi.get.mockResolvedValue({ data: { data: {
      id: "rx_1", externalTenantId: "clinic_1",
      items: [{ id: "i1", medicineName: "Vitamin D3", medicineId: "med_2", quantity: 0, dispensedQty: 0 }],
    } } });
    renderPanel();

    expect(await screen.findByText("Vitamin D3")).toBeInTheDocument();
  });

  it("is labelled 'quantity not set', never '0 left'", async () => {
    mockApi.get.mockResolvedValue({ data: { data: {
      id: "rx_1", externalTenantId: "clinic_1",
      items: [{ id: "i1", medicineName: "Vitamin D3", medicineId: "med_2", quantity: 0, dispensedQty: 0 }],
    } } });
    renderPanel();

    expect(await screen.findByText(/quantity not set/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 left/)).not.toBeInTheDocument();
  });

  it("can still be attributed to a cart line through the same PATCH-backed store action", async () => {
    mockApi.get.mockResolvedValue({ data: { data: {
      id: "rx_1", externalTenantId: "clinic_1",
      items: [{ id: "i1", medicineName: "Vitamin D3", medicineId: "med_2", quantity: 0, dispensedQty: 0 }],
    } } });
    renderPanel();

    await screen.findByText("Vitamin D3");
    await userEvent.selectOptions(screen.getByRole("combobox"), "inv-1");

    expect(useBillingStore.getState().items[0]?.prescriptionItemId).toBe("i1");
  });
});
