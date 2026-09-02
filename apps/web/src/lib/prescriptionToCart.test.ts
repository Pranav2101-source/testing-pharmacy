import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "@/lib/api-client";
import { resolvePrescriptionToCart, buildCartItem, roundUpConfirmMessage, type BillablePrescription, type FefoBatch } from "./prescriptionToCart";

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

/** A pack-only medicine (no structured pack size) — a "pack" already is the smallest unit. */
const packOnlyBatch: FefoBatch = {
  id: "batch-full", batchNumber: "B-1", expiryDate: "2027-01-01T00:00:00Z", mrp: 20, available: 18,
  medicine: { name: "Paracetamol 500mg", hsnCode: "3004", gstRate: 12 },
};

/** A strip of 10 tablets, MRP 20/strip (per-piece MRP 2.00), loose selling enabled. */
function looseBatch(overrides: Partial<FefoBatch> = {}): FefoBatch {
  return {
    id: "batch-loose", batchNumber: "L-1", expiryDate: "2027-01-01T00:00:00Z", mrp: 20, available: 5, looseUnits: 0,
    medicine: { name: "Paracetamol 500mg", hsnCode: "3004", gstRate: 12, unitsPerPack: 10, baseUnit: "TABLET", allowLooseSale: true },
    ...overrides,
  };
}

beforeEach(() => { mockApi.get.mockReset(); });

describe("resolvePrescriptionToCart: partial-fill fallback (pack-only medicine)", () => {
  it("prescribed 20, only 18 in stock: bills 18 and reports the shortfall, does not fail the line", async () => {
    mockApi.get
      .mockResolvedValueOnce({ data: { data: null } })         // strict quantity=20 -> no single batch covers it
      .mockResolvedValueOnce({ data: { data: packOnlyBatch } }); // fallback quantity=1 -> earliest-expiring batch, 18 available

    const result = await resolvePrescriptionToCart(rx(20));

    expect(mockApi.get).toHaveBeenNthCalledWith(1, "/inventory/fefo/med-1", { params: { quantity: 20 } });
    expect(mockApi.get).toHaveBeenNthCalledWith(2, "/inventory/fefo/med-1", { params: { quantity: 1 } });
    expect(result.failures).toEqual([]);
    expect(result.partials).toEqual([{ medicineName: "Paracetamol 500mg", requested: 20, available: 18 }]);
    expect(result.roundedToPack).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.quantity).toBe(18);
    expect(result.items[0]!.saleUnit).toBe("PACK");
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
    mockApi.get.mockResolvedValueOnce({ data: { data: { ...packOnlyBatch, available: 20 } } });

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
    // 20 tablets = 2 whole strips of 10 — must never turn into "20 strips".
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
    // 20 tablets (2 strips of 10) but only 1 sealed pack + 12 loose on the batch.
    // Shorting to "1 pack = 10" would leave the course half-filled for no reason.
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
    expect(item!.quantity).toBe(1); // 1 whole strip (10 tablets) handed over for an 8-tablet Rx
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

describe("resolvePrescriptionToCart: loose-aware end to end", () => {
  it("an 8-tablet line against a 10/strip loose-enabled medicine bills loose pieces, not 8 packs", async () => {
    mockApi.get.mockResolvedValueOnce({ data: { data: looseBatch() } });

    const result = await resolvePrescriptionToCart(rx(8));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.saleUnit).toBe("LOOSE");
    expect(result.items[0]!.quantity).toBe(8);
    expect(result.partials).toEqual([]);
    expect(result.roundedToPack).toEqual([]);
  });

  it("an 8-tablet line where this pharmacy cannot sell loose reports the pack round-up", async () => {
    const notLoose = looseBatch({ medicine: { ...looseBatch().medicine, allowLooseSale: false } });
    mockApi.get.mockResolvedValueOnce({ data: { data: notLoose } });

    const result = await resolvePrescriptionToCart(rx(8));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.saleUnit).toBe("PACK");
    expect(result.items[0]!.quantity).toBe(1);
    expect(result.roundedToPack).toEqual([{ medicineName: "Paracetamol 500mg", requested: 8, dispensed: 10 }]);
    expect(result.partials).toEqual([]);
  });

  it("a pharmacist-chosen substitute that rounds up to a full pack is reported too", async () => {
    // The substitute is built from a non-loose batch for an 8-tablet line -> 1 pack of 10.
    const sub = buildCartItem(
      looseBatch({ medicine: { ...looseBatch().medicine, allowLooseSale: false } }), null, 8)!;
    const result = await resolvePrescriptionToCart(rx(8), { "item-1": { action: "replace", cartItem: sub } });

    expect(result.items).toHaveLength(1);
    expect(result.roundedToPack).toEqual([
      { medicineName: "Paracetamol 500mg", requested: 8, dispensed: 10 },
    ]);
    expect(mockApi.get).not.toHaveBeenCalled(); // a replace never re-resolves
  });
});

describe("roundUpConfirmMessage", () => {
  it("is empty when nothing was rounded up", () => {
    expect(roundUpConfirmMessage([])).toBe("");
  });

  it("names every rounded line and the extra the patient pays for", () => {
    const msg = roundUpConfirmMessage([
      { medicineName: "Amox 250", requested: 8, dispensed: 10 },
      { medicineName: "Dolo 650", requested: 20, dispensed: 30 },
    ]);
    expect(msg).toContain("Amox 250: 10 instead of 8");
    expect(msg).toContain("Dolo 650: 30 instead of 20");
    expect(msg).toContain("the patient pays for the extra");
  });
});
