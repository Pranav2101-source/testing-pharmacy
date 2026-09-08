import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MedicineSearchCombobox } from "./MedicineSearchCombobox";
import { useBillingStore } from "./useBillingStore";
import { api } from "@/lib/api-client";
import type { MedicineSearchResult } from "@pharmacy/types";

/**
 * Billing search's "in-stock first" ranking and per-result stock/price display (see
 * MedicineService#quickSearch on the backend — this component only renders what the
 * API already computed, it never recomputes stock/loose/price itself). The backend
 * already partitions in-stock-before-out-of-stock; these tests cover what the
 * frontend does with the fields that partition produced: showing them, and still
 * wiring a selected result through to the cart exactly as before.
 */
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function medResult(overrides: Partial<MedicineSearchResult>): MedicineSearchResult {
  return {
    id: "med_1", name: "Paracetamol 500", genericName: "Paracetamol", manufacturer: "GSK",
    form: "Tablet", strength: "500mg", packSize: "10s", hsnCode: "3004", gstRate: 12,
    schedule: null,
    ...overrides,
  };
}

function renderCombobox(props: { lifa?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MedicineSearchCombobox lifa={props.lifa} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useBillingStore.getState().clear();
  mockApi.get.mockReset();
});

async function search(term: string, props: { lifa?: boolean } = {}) {
  renderCombobox(props);
  const input = screen.getByPlaceholderText(/Search by name/i);
  fireEvent.change(input, { target: { value: term } });
  // The component debounces 300ms before firing the query.
  await new Promise((r) => setTimeout(r, 350));
}

describe("MedicineSearchCombobox: stock-aware search results", () => {
  it("shows sellable-units breakdown for an in-stock, loose-sellable result", async () => {
    mockApi.get.mockResolvedValueOnce({
      data: {
        data: [medResult({
          id: "med_loose", name: "Crocin 500", inStock: true, availableQuantity: 42,
          looseUnitsOnHand: 0, sellableUnits: 420, unitsPerPack: 10, allowLooseSale: true,
          price: 45.5,
        })],
      },
    });

    await search("crocin");

    // Stock and price render as one combined pill (not two separate ones) —
    // keeps the row to a single line so the dropdown's height cap holds.
    expect(await screen.findByText("42×10=420 · ₹45.50")).toBeInTheDocument();
  });

  it("shows a plain pack count for an in-stock, non-loose result", async () => {
    mockApi.get.mockResolvedValueOnce({
      data: {
        data: [medResult({
          id: "med_pack", name: "Amoxicillin 250", inStock: true, availableQuantity: 6,
          allowLooseSale: false, price: 30,
        })],
      },
    });

    await search("amox");

    expect(await screen.findByText("6 in stock · ₹30.00")).toBeInTheDocument();
  });

  it("labels a zero-stock catalogue result as Out of stock rather than hiding it", async () => {
    mockApi.get.mockResolvedValueOnce({
      data: {
        data: [medResult({
          id: "med_oos", name: "Ibuprofen 400", inStock: false, availableQuantity: 0, price: null,
        })],
      },
    });

    await search("ibuprofen");

    expect(await screen.findByText("Out of stock")).toBeInTheDocument();
    // No price pill when the backend returned no price (nothing in stock to price).
    expect(screen.queryByText(/^₹/)).not.toBeInTheDocument();
  });

  it("selecting an in-stock result fetches its batch from the dispensing engine and adds it to the cart", async () => {
    mockApi.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === "/medicines/search") {
        return Promise.resolve({
          data: {
            data: [medResult({
              id: "med_add", name: "Dolo 650", inStock: true, availableQuantity: 20, price: 28,
            })],
          },
        });
      }
      if (url === "/dispensing/batches") {
        expect(config?.params).toEqual({ medicineId: "med_add" });
        return Promise.resolve({
          data: {
            data: [{
              id: "inv_1", batchNumber: "B1",
              expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
              mrp: 28, quantity: 20, looseUnits: 0, reservedQuantity: 0,
              medicine: { name: "Dolo 650", hsnCode: "3004", gstRate: 12, isActive: true },
            }],
          },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    await search("dolo");
    fireEvent.mouseDown(await screen.findByText("Dolo 650"));

    await waitFor(() => expect(useBillingStore.getState().items).toHaveLength(1));
    const item = useBillingStore.getState().items[0]!;
    expect(item.inventoryId).toBe("inv_1");
    expect(item.medicineName).toBe("Dolo 650");
    expect(item.mrp).toBe(28);
    expect(item.batchAutoSelected).toBe(true);
  });
});

/**
 * Batch ORDER is now the backend dispensing engine's job — GET /dispensing/batches
 * returns batches already sorted by the pharmacy's LILA/FEFO or LIFA strategy (see
 * DispensingService / DispensingIT for the ordering itself). The combobox must show
 * that order verbatim and must not re-sort, and picking a row other than the top
 * one records a pharmacist override.
 */
describe("MedicineSearchCombobox: shows the engine's batch order verbatim", () => {
  function mockBatches(...batches: Array<{ id: string; batchNumber: string; days: number; mrp: number; qty: number }>) {
    mockApi.get.mockImplementation((url: string) => {
      if (url === "/medicines/search") {
        return Promise.resolve({
          data: { data: [medResult({ id: "med_multi", name: "Ondem 4", inStock: true, availableQuantity: 15 })] },
        });
      }
      if (url === "/dispensing/batches") {
        return Promise.resolve({
          data: {
            data: batches.map((b) => ({
              id: b.id, batchNumber: b.batchNumber,
              expiryDate: new Date(Date.now() + b.days * 24 * 60 * 60 * 1000).toISOString(),
              mrp: b.mrp, quantity: b.qty, looseUnits: 0, reservedQuantity: 0,
              medicine: { name: "Ondem 4", hsnCode: "3004", gstRate: 12, isActive: true },
            })),
          },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });
  }

  it("renders batches in the exact order the backend returned them", async () => {
    // Backend returned NEW first (e.g. LIFA); the combobox must not flip it back to FEFO.
    mockBatches(
      { id: "inv_new", batchNumber: "NEW-EXPIRES-LATER", days: 300, mrp: 22, qty: 10 },
      { id: "inv_old", batchNumber: "OLD-EXPIRES-SOON", days: 60, mrp: 20, qty: 5 },
    );
    await search("ondem");
    fireEvent.mouseDown(await screen.findByText("Ondem 4"));

    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("NEW-EXPIRES-LATER");
    expect(options[1]).toHaveTextContent("OLD-EXPIRES-SOON");

    fireEvent.click(options[0]!);
    await waitFor(() => expect(useBillingStore.getState().items).toHaveLength(1));
    const item = useBillingStore.getState().items[0]!;
    expect(item.inventoryId).toBe("inv_new");
    expect(item.batchAutoSelected).toBe(true); // the top row = the engine's choice
  });

  it("picking a batch below the engine's top choice records a pharmacist override", async () => {
    mockBatches(
      { id: "inv_a", batchNumber: "ENGINE-TOP", days: 60, mrp: 20, qty: 5 },
      { id: "inv_b", batchNumber: "MANUAL-PICK", days: 300, mrp: 22, qty: 10 },
    );
    await search("ondem");
    fireEvent.mouseDown(await screen.findByText("Ondem 4"));

    const options = await screen.findAllByRole("option");
    fireEvent.click(options[1]!);
    await waitFor(() => expect(useBillingStore.getState().items).toHaveLength(1));
    const item = useBillingStore.getState().items[0]!;
    expect(item.inventoryId).toBe("inv_b");
    expect(item.batchAutoSelected).toBe(false);
  });
});
