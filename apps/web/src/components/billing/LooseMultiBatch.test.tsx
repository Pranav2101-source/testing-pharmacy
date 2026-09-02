import { describe, expect, it, vi } from "vitest";
import { planLooseSplit, loosePiecesOf, runLooseOverflow } from "./CartTable";
import type { InventoryBatch } from "./BatchPickerDialog";
import type { CartItem, NewCartItem } from "./useBillingStore";

/**
 * Spilling a cut-strip line that outgrew its batch onto the next FEFO batches.
 *
 * The planner is pure: it never touches the store or the network. Given what the
 * cart already holds and the batches on the shelf, it decides which batches to add
 * lines from — earliest-expiry first, so a near-expiry remainder gets drawn down
 * before a fresh strip is opened — and reports whatever it still can't fill.
 */

function batch(o: Partial<InventoryBatch> & { id: string }): InventoryBatch {
  return {
    batchNumber: o.id.toUpperCase(),
    expiryDate: "2027-06-01T00:00:00Z",
    mrp: 137,
    quantity: 0,
    looseUnits: 0,
    reservedQuantity: 0,
    medicine: { name: "Telma 40", hsnCode: "3004", gstRate: 12, isActive: true,
      unitsPerPack: 15, baseUnit: "TABLET", allowLooseSale: true },
    ...o,
  } as InventoryBatch;
}

const line: CartItem = {
  inventoryId: "A", medicineName: "Telma 40", hsnCode: "3004", schedule: null,
  batchNumber: "A", expiryDate: "2026-10-01T00:00:00Z",
  mrp: 137, quantity: 17, freeQty: 0, discount: 0, gstRate: 12,
  availableStock: 1, saleUnit: "LOOSE", unitsPerPack: 15, baseUnit: "TABLET",
  allowLooseSale: true, looseUnits: 2,
  rate: 9.13, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, amount: 0,
};

const cart = [{ inventoryId: "A", medicineName: "Telma 40", saleUnit: "LOOSE", quantity: 17 }];

describe("loosePiecesOf", () => {
  it("counts unreserved sealed packs opened up, plus the loose remainder", () => {
    expect(loosePiecesOf(batch({ id: "b", quantity: 3, looseUnits: 4, reservedQuantity: 1 }), 15)).toBe(34); // 2*15 + 4
  });
});

describe("planLooseSplit", () => {
  it("does nothing when the cart already covers the typed quantity", () => {
    const r = planLooseSplit(line, 17, cart, [batch({ id: "B", quantity: 5 })]);
    expect(r.lines).toEqual([]);
    expect(r.shortfall).toBe(0);
  });

  it("fills the overflow from one other batch", () => {
    // Want 40, cart has 17 -> 23 short. Batch B has 2 sealed packs = 30 pieces.
    const r = planLooseSplit(line, 40, cart, [batch({ id: "B", quantity: 2 })]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.inventoryId).toBe("B");
    expect(r.lines[0]!.quantity).toBe(23);
    expect(r.lines[0]!.saleUnit).toBe("LOOSE");
    expect(r.shortfall).toBe(0);
  });

  it("spreads across batches earliest-expiry first", () => {
    const soon = batch({ id: "SOON", quantity: 1, looseUnits: 0, expiryDate: "2026-11-01T00:00:00Z" }); // 15
    const later = batch({ id: "LATER", quantity: 5, expiryDate: "2028-01-01T00:00:00Z" });              // 75
    const r = planLooseSplit(line, 50, cart, [later, soon]); // 33 short
    expect(r.lines.map((l) => [l.inventoryId, l.quantity])).toEqual([["SOON", 15], ["LATER", 18]]);
    expect(r.shortfall).toBe(0);
  });

  it("reports what it still can't fill after every batch is used", () => {
    const r = planLooseSplit(line, 60, cart, [batch({ id: "B", quantity: 1, looseUnits: 3 })]); // 18 available, 43 short
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.quantity).toBe(18);
    expect(r.shortfall).toBe(43 - 18);
  });

  it("skips a batch already on the bill, an expired one, one with loose selling off, and a fuzzy-search false match", () => {
    const onBill = batch({ id: "A", quantity: 9 });
    const expired = batch({ id: "EXP", quantity: 9, expiryDate: "2020-01-01T00:00:00Z" });
    const notLoose = batch({ id: "NOLOOSE", quantity: 9, medicine: { ...batch({ id: "x" }).medicine, allowLooseSale: false } });
    const otherMed = batch({ id: "OTHER", quantity: 9, medicine: { ...batch({ id: "x" }).medicine, name: "Telma 40 H" } });
    const good = batch({ id: "GOOD", quantity: 2 }); // 30
    const r = planLooseSplit(line, 40, cart, [onBill, expired, notLoose, otherMed, good]);
    expect(r.lines.map((l) => l.inventoryId)).toEqual(["GOOD"]);
    expect(r.shortfall).toBe(0);
  });

  it("never splits a medicine with no real pack size", () => {
    const packOnly = { ...line, unitsPerPack: 1 };
    expect(planLooseSplit(packOnly, 100, cart, [batch({ id: "B", quantity: 9 })]).lines).toEqual([]);
  });
});

describe("runLooseOverflow — fetch, plan, add, notify", () => {
  function notify() { return { info: vi.fn(), warning: vi.fn(), error: vi.fn() }; }

  it("fetches the medicine's batches and adds the spill lines, earliest-expiry first", async () => {
    const added: NewCartItem[] = [];
    const n = notify();
    const soon = batch({ id: "SOON", batchNumber: "TLM-SOON", quantity: 1, expiryDate: "2026-11-01T00:00:00Z" }); // 15
    const later = batch({ id: "LATER", batchNumber: "TLM-LATER", quantity: 5, expiryDate: "2028-01-01T00:00:00Z" }); // 75
    const fetchBatches = vi.fn().mockResolvedValue([later, soon]);

    await runLooseOverflow(line, 50, cart, { fetchBatches, addLine: (l) => added.push(l), notify: n });

    expect(fetchBatches).toHaveBeenCalledWith("Telma 40");
    expect(added.map((l) => [l.batchNumber, l.quantity, l.saleUnit]))
      .toEqual([["TLM-SOON", 15, "LOOSE"], ["TLM-LATER", 18, "LOOSE"]]); // 33 short, filled
    expect(n.info).toHaveBeenCalledWith(expect.stringContaining("Split across batches"));
  });

  it("warns and adds nothing when no other batch has loose stock", async () => {
    const added: NewCartItem[] = [];
    const n = notify();
    await runLooseOverflow(line, 40, cart, { fetchBatches: vi.fn().mockResolvedValue([]), addLine: (l) => added.push(l), notify: n });
    expect(added).toEqual([]);
    expect(n.warning).toHaveBeenCalledWith(expect.stringContaining("No other batch"));
  });

  it("warns about the remaining shortfall when the other batches still can't cover it", async () => {
    const added: NewCartItem[] = [];
    const n = notify();
    const small = batch({ id: "B", batchNumber: "TLM-B", quantity: 1, looseUnits: 3 }); // 18
    await runLooseOverflow(line, 60, cart, { fetchBatches: vi.fn().mockResolvedValue([small]), addLine: (l) => added.push(l), notify: n });
    expect(added).toHaveLength(1);
    expect(added[0]!.quantity).toBe(18);
    expect(n.warning).toHaveBeenCalledWith(expect.stringContaining("still 25")); // 43 short - 18 filled
  });

  it("does nothing for a pack line or a medicine with no real pack size", async () => {
    const n = notify();
    const fetchBatches = vi.fn();
    await runLooseOverflow({ ...line, saleUnit: "PACK" }, 40, cart, { fetchBatches, addLine: vi.fn(), notify: n });
    await runLooseOverflow({ ...line, unitsPerPack: 1 }, 40, cart, { fetchBatches, addLine: vi.fn(), notify: n });
    expect(fetchBatches).not.toHaveBeenCalled();
  });

  it("reports a fetch failure without adding anything", async () => {
    const n = notify();
    await runLooseOverflow(line, 40, cart, {
      fetchBatches: vi.fn().mockRejectedValue(new Error("network")),
      addLine: vi.fn(), notify: n,
    });
    expect(n.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't check other batches"));
  });
});
