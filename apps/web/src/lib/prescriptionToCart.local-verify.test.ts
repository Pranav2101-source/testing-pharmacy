import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "@/lib/api-client";
import { resolvePrescriptionToCart, type BillablePrescription } from "./prescriptionToCart";

// Local-only verification for the quantity auto-adjustment (partial fill) fallback — NOT
// meant to be committed (see feedback_no_test_files_in_commits memory).

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { get: vi.fn() } };
});

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function rx(quantity: number): BillablePrescription {
  return {
    id: "rx_1",
    prescriptionNumber: "RX-000001",
    patientName: "Asha Verma",
    patientPhone: null,
    doctorName: "Dr. Rao",
    doctor: null,
    items: [{
      id: "item-1", medicineId: "med-1", medicineName: "Paracetamol 500mg",
      schedule: null, quantity, dispensedQty: 0,
    }],
  };
}

const fullBatch = {
  id: "batch-full", batchNumber: "B-1", expiryDate: "2027-01-01T00:00:00Z", mrp: 20, available: 18,
  medicine: { name: "Paracetamol 500mg", hsnCode: "3004", gstRate: 12 },
};

beforeEach(() => { mockApi.get.mockReset(); });

describe("resolvePrescriptionToCart: partial-fill fallback", () => {
  it("prescribed 20, only 18 in stock: bills 18 and reports the shortfall, does not fail the line", async () => {
    mockApi.get
      .mockResolvedValueOnce({ data: { data: null } })         // strict quantity=20 -> no single batch covers it
      .mockResolvedValueOnce({ data: { data: fullBatch } });   // fallback quantity=1 -> earliest-expiring batch, 18 available

    const result = await resolvePrescriptionToCart(rx(20));

    expect(mockApi.get).toHaveBeenNthCalledWith(1, "/inventory/fefo/med-1", { params: { quantity: 20 } });
    expect(mockApi.get).toHaveBeenNthCalledWith(2, "/inventory/fefo/med-1", { params: { quantity: 1 } });
    expect(result.failures).toEqual([]);
    expect(result.partials).toEqual([{ medicineName: "Paracetamol 500mg", requested: 20, available: 18 }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantity).toBe(18);
  });

  it("genuinely zero stock still fails the line, not a false partial", async () => {
    mockApi.get
      .mockResolvedValueOnce({ data: { data: null } })
      .mockResolvedValueOnce({ data: { data: null } });

    const result = await resolvePrescriptionToCart(rx(20));

    expect(result.failures).toEqual(["Paracetamol 500mg"]);
    expect(result.partials).toEqual([]);
    expect(result.items).toHaveLength(0);
  });

  it("full stock available: single lookup, no fallback call, no partial reported", async () => {
    mockApi.get.mockResolvedValueOnce({ data: { data: { ...fullBatch, available: 20 } } });

    const result = await resolvePrescriptionToCart(rx(20));

    expect(mockApi.get).toHaveBeenCalledTimes(1);
    expect(result.partials).toEqual([]);
    expect(result.items[0]!.quantity).toBe(20);
  });

  it("a network/server error checking stock is reported as checkFailed, not a confirmed failure", async () => {
    mockApi.get.mockRejectedValueOnce(new Error("Network Error"));

    const result = await resolvePrescriptionToCart(rx(20));

    expect(result.checkFailed).toEqual(["Paracetamol 500mg"]);
    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(0);
  });
});
