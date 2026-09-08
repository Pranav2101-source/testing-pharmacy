import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "@/lib/api-client";
import { resolvePrescriptionToCart, buildCartItem, type BillablePrescription, type FefoBatch } from "./prescriptionToCart";
import type { DispensingAllocation, DispensingPlanLine } from "@pharmacy/types";

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

// ── Dispensing-plan mock builders ────────────────────────────────────────────
// resolvePrescriptionToCart now makes ONE call — GET /dispensing/prescriptions/{id}/plan —
// and the backend engine has already chosen batches + pack/loose. These build that shape.

function alloc(over: Partial<DispensingAllocation> = {}): DispensingAllocation {
  return {
    inventoryId: "batch-1", batchNumber: "B-1", expiryDate: "2027-01-01T00:00:00Z",
    saleUnit: "PACK", quantity: 1, unitsPerPack: 10, baseUnit: "TABLET",
    mrp: 20, unitMrp: 20, rate: 20, gstRate: 12, hsnCode: "3004",
    allowLooseSale: false, looseUnits: 0, availableStock: 5,
    taxableAmount: 17.86, cgst: 1.07, sgst: 1.07, igst: 0, amount: 20,
    ...over,
  };
}

function planLine(over: Partial<DispensingPlanLine> = {}): DispensingPlanLine {
  const allocations = over.allocations ?? [alloc()];
  const dispensed = allocations.reduce(
    (n, a) => n + (a.saleUnit === "LOOSE" ? a.quantity : a.quantity * (a.unitsPerPack ?? 1)), 0);
  return {
    medicineId: "med-1", localMedicineId: null, medicineName: "Paracetamol 500mg",
    schedule: null, requestedPieces: dispensed, dispensedPieces: dispensed,
    fullyAllocated: true, shortfallPieces: null, roundedUpToPieces: null,
    unmetReason: null, message: null,
    allocations,
    ...over,
  };
}

function planResponse(...lines: DispensingPlanLine[]) {
  return { data: { data: { strategy: "LILA_FEFO", lines } } };
}

/** A strip of 10 tablets, MRP 20/strip (per-piece MRP 2.00), loose selling enabled. */
function looseBatch(overrides: Partial<FefoBatch> = {}): FefoBatch {
  return {
    id: "batch-loose", batchNumber: "L-1", expiryDate: "2027-01-01T00:00:00Z", mrp: 20, available: 5, looseUnits: 0,
    medicine: { name: "Paracetamol 500mg", hsnCode: "3004", gstRate: 12, unitsPerPack: 10, baseUnit: "TABLET", allowLooseSale: true },
    ...overrides,
  };
}

beforeEach(() => { mockApi.get.mockReset(); });

describe("resolvePrescriptionToCart: the engine plan drives the cart", () => {
  it("prescribed 20, engine covers 18: bills 18 and reports the shortfall, does not fail the line", async () => {
    mockApi.get.mockResolvedValueOnce(planResponse(planLine({
      requestedPieces: 20, dispensedPieces: 18, fullyAllocated: false, shortfallPieces: 2,
      allocations: [alloc({ quantity: 18, unitsPerPack: 1, mrp: 20, unitMrp: 20, rate: 20 })],
    })));

    const result = await resolvePrescriptionToCart(rx(20));

    expect(mockApi.get).toHaveBeenCalledWith("/dispensing/prescriptions/rx_1/plan");
    expect(result.failures).toEqual([]);
    expect(result.partials).toEqual([{ medicineName: "Paracetamol 500mg", requested: 20, available: 18 }]);
    expect(result.roundedToPack).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantity).toBe(18);
    expect(result.items[0]!.saleUnit).toBe("PACK");
  });

  it("engine finds no sellable stock: the line fails, not a false partial", async () => {
    mockApi.get.mockResolvedValueOnce(planResponse(planLine({
      requestedPieces: 20, dispensedPieces: 0, fullyAllocated: false, shortfallPieces: 20,
      unmetReason: "NO_STOCK", allocations: [],
    })));

    const result = await resolvePrescriptionToCart(rx(20));

    expect(result.failures).toEqual(["Paracetamol 500mg"]);
    expect(result.partials).toEqual([]);
    expect(result.items).toHaveLength(0);
  });

  it("a network/server error on the plan call is reported as checkFailed, not a confirmed failure", async () => {
    mockApi.get.mockRejectedValueOnce(new Error("Network Error"));

    const result = await resolvePrescriptionToCart(rx(20));

    expect(result.checkFailed).toEqual(["Paracetamol 500mg"]);
    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(0);
  });

  it("a multi-batch allocation becomes multiple cart rows for the one prescribed line", async () => {
    mockApi.get.mockResolvedValueOnce(planResponse(planLine({
      requestedPieces: 35, dispensedPieces: 35, fullyAllocated: true,
      allocations: [
        alloc({ inventoryId: "b1", batchNumber: "FIRST", saleUnit: "LOOSE", quantity: 20, allowLooseSale: true }),
        alloc({ inventoryId: "b2", batchNumber: "SECOND", saleUnit: "LOOSE", quantity: 15, allowLooseSale: true }),
      ],
    })));

    const result = await resolvePrescriptionToCart(rx(35));

    expect(result.items.map((i) => i.batchNumber)).toEqual(["FIRST", "SECOND"]);
    expect(result.partials).toEqual([]);
  });
});

describe("buildCartItem: piece count vs pack count for a loose-capable medicine", () => {
  it("a piece count that is NOT a whole pack, loose enabled: sold loose, quantity in pieces", () => {
    const item = buildCartItem(looseBatch(), null, 8);

    expect(item).not.toBeNull();
    expect(item!.saleUnit).toBe("LOOSE");
    expect(item!.quantity).toBe(8); // pieces, not a fabricated 8 packs
    expect(item!.unitsPerPack).toBe(10);
    // per-piece MRP 2.00, 8 pieces, 12% GST-inclusive -> taxable 14.29
    expect(item!.taxableAmount).toBeCloseTo(14.29, 2);
  });

  it("a piece count that IS a whole number of packs: sold as a pack, never loose", () => {
    const item = buildCartItem(looseBatch({ available: 5 }), null, 20);

    expect(item).not.toBeNull();
    expect(item!.saleUnit).toBe("PACK");
    expect(item!.quantity).toBe(2);
  });

  it("a whole-pack request already covered by an open remainder is sold loose, not as a new pack", () => {
    const item = buildCartItem(looseBatch({ available: 5, looseUnits: 10 }), null, 10);

    expect(item).not.toBeNull();
    expect(item!.saleUnit).toBe("LOOSE");
    expect(item!.quantity).toBe(10);
  });

  it("a whole-pack request with too few sealed packs is filled loose, not shorted to whole packs", () => {
    const item = buildCartItem(looseBatch({ available: 1, looseUnits: 12 }), null, 20);

    expect(item).not.toBeNull();
    expect(item!.saleUnit).toBe("LOOSE");
    expect(item!.quantity).toBe(20); // 12 loose + 8 cut from the last sealed strip
  });

  it("not a whole pack, loose disabled, enough whole packs on hand: rounds UP to the nearest pack", () => {
    const notLoose = looseBatch({ available: 5, medicine: { ...looseBatch().medicine, allowLooseSale: false } });
    const item = buildCartItem(notLoose, null, 8);

    expect(item).not.toBeNull();
    expect(item!.saleUnit).toBe("PACK");
    expect(item!.quantity).toBe(1);
  });

  it("not a whole pack, Schedule X (loose refused regardless of the opt-in): rounds up to a pack", () => {
    const item = buildCartItem(looseBatch({ available: 5 }), "X", 8);

    expect(item).not.toBeNull();
    expect(item!.saleUnit).toBe("PACK");
    expect(item!.quantity).toBe(1);
  });

  it("not a whole pack, loose disabled, less than one whole pack on the shelf: nothing sellable", () => {
    const notLoose = looseBatch({ available: 0, looseUnits: 4, medicine: { ...looseBatch().medicine, allowLooseSale: false } });
    expect(buildCartItem(notLoose, null, 8)).toBeNull();
  });

  it("loose enabled but the batch cannot cover the full piece count: capped, not overdrawn", () => {
    const item = buildCartItem(looseBatch({ available: 0, looseUnits: 5 }), null, 8);

    expect(item).not.toBeNull();
    expect(item!.saleUnit).toBe("LOOSE");
    expect(item!.quantity).toBe(5);
  });
});

describe("resolvePrescriptionToCart: loose vs pack round-up from the plan", () => {
  it("an 8-tablet line the engine bills loose ends up as loose pieces, no round-up reported", async () => {
    mockApi.get.mockResolvedValueOnce(planResponse(planLine({
      requestedPieces: 8, dispensedPieces: 8,
      allocations: [alloc({ saleUnit: "LOOSE", quantity: 8, allowLooseSale: true, unitMrp: 2, rate: 2 })],
    })));

    const result = await resolvePrescriptionToCart(rx(8));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.saleUnit).toBe("LOOSE");
    expect(result.items[0]!.quantity).toBe(8);
    expect(result.roundedToPack).toEqual([]);
  });

  it("an 8-tablet line the engine rounds up to a pack reports the round-up with medicineId/unitsPerPack", async () => {
    mockApi.get.mockResolvedValueOnce(planResponse(planLine({
      requestedPieces: 8, dispensedPieces: 10, roundedUpToPieces: 10,
      allocations: [alloc({ saleUnit: "PACK", quantity: 1, unitsPerPack: 10 })],
    })));

    const result = await resolvePrescriptionToCart(rx(8));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.saleUnit).toBe("PACK");
    expect(result.items[0]!.quantity).toBe(1);
    expect(result.roundedToPack).toEqual([{
      medicineName: "Paracetamol 500mg", requested: 8, dispensed: 10,
      medicineId: "med-1", unitsPerPack: 10, schedule: null,
    }]);
    expect(result.partials).toEqual([]);
  });

  it("a pharmacist-chosen substitute that rounds up to a full pack is reported too — no plan call for it", async () => {
    mockApi.get.mockResolvedValueOnce(planResponse()); // the engine still plans the (now-substituted) line; it is ignored
    const sub = buildCartItem(
      looseBatch({ medicine: { ...looseBatch().medicine, allowLooseSale: false } }), null, 8)!;
    const result = await resolvePrescriptionToCart(rx(8), { "item-1": { action: "replace", cartItem: sub } });

    expect(result.items).toHaveLength(1);
    expect(result.roundedToPack).toEqual([
      { medicineName: "Paracetamol 500mg", requested: 8, dispensed: 10 },
    ]);
  });
});
