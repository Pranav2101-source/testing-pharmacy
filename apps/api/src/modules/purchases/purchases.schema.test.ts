import { describe, it, expect } from "vitest";
import {
  poItemSchema,
  createPOSchema,
  updatePOSchema,
  listPOQuerySchema,
  approvePOSchema,
  sharePOSchema,
  grnItemSchema,
  createGRNSchema,
  updateGRNSchema,
  listGRNQuerySchema,
  autoSuggestQuerySchema,
  fromReorderSchema,
} from "./purchases.schema.js";

const validPOItem = {
  medicineId:   "med_1",
  medicineName: "Paracetamol 500mg",
  batchNumber:  "B001",
  expiryDate:   "2026-12-31T00:00:00.000Z",
  quantity:     10,
  purchaseRate: 5.5,
  mrp:          8.0,
  gstRate:      12,
};

// ── poItemSchema ──────────────────────────────────────────────────────────────

describe("poItemSchema", () => {
  it("accepts a valid PO item", () => {
    expect(() => poItemSchema.parse(validPOItem)).not.toThrow();
  });

  it("rejects mrp < purchaseRate", () => {
    const r = poItemSchema.safeParse({ ...validPOItem, mrp: 5.0, purchaseRate: 6.0 });
    expect(r.success).toBe(false);
  });

  it("accepts mrp === purchaseRate (boundary)", () => {
    const r = poItemSchema.safeParse({ ...validPOItem, mrp: 5.5, purchaseRate: 5.5 });
    expect(r.success).toBe(true);
  });

  it("rejects invalid gstRate (not in 0,5,12,18)", () => {
    expect(poItemSchema.safeParse({ ...validPOItem, gstRate: 10 }).success).toBe(false);
  });

  it("accepts all valid gstRates", () => {
    for (const rate of [0, 5, 12, 18]) {
      expect(poItemSchema.safeParse({ ...validPOItem, gstRate: rate }).success).toBe(true);
    }
  });

  it("rejects quantity = 0", () => {
    expect(poItemSchema.safeParse({ ...validPOItem, quantity: 0 }).success).toBe(false);
  });

  it("rejects non-integer quantity", () => {
    expect(poItemSchema.safeParse({ ...validPOItem, quantity: 1.5 }).success).toBe(false);
  });

  it("rejects purchaseRate = 0", () => {
    expect(poItemSchema.safeParse({ ...validPOItem, purchaseRate: 0 }).success).toBe(false);
  });

  it("rejects batchNumber longer than 50 chars", () => {
    expect(poItemSchema.safeParse({ ...validPOItem, batchNumber: "B".repeat(51) }).success).toBe(false);
  });

  it("rejects empty medicineName", () => {
    expect(poItemSchema.safeParse({ ...validPOItem, medicineName: "" }).success).toBe(false);
  });

  it("accepts empty medicineId (CSV-imported row — resolved server-side)", () => {
    expect(poItemSchema.safeParse({ ...validPOItem, medicineId: "" }).success).toBe(true);
  });
});

// ── createPOSchema ────────────────────────────────────────────────────────────

describe("createPOSchema", () => {
  const valid = { supplierId: "sup_1", items: [validPOItem] };

  it("accepts valid PO", () => {
    expect(() => createPOSchema.parse(valid)).not.toThrow();
  });

  it("rejects empty supplierId", () => {
    expect(createPOSchema.safeParse({ ...valid, supplierId: "" }).success).toBe(false);
  });

  it("rejects empty items array", () => {
    expect(createPOSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });

  it("rejects notes longer than 1000 chars", () => {
    expect(createPOSchema.safeParse({ ...valid, notes: "x".repeat(1001) }).success).toBe(false);
  });
});

// ── updatePOSchema ────────────────────────────────────────────────────────────

describe("updatePOSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    expect(() => updatePOSchema.parse({})).not.toThrow();
  });

  it("accepts partial update with only notes", () => {
    expect(updatePOSchema.safeParse({ notes: "Updated notes" }).success).toBe(true);
  });

  it("rejects items array with 0 items if provided", () => {
    expect(updatePOSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

// ── listPOQuerySchema ─────────────────────────────────────────────────────────

describe("listPOQuerySchema", () => {
  it("applies defaults page=1, limit=20", () => {
    const r = listPOQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
  });

  it("coerces string page/limit to numbers", () => {
    const r = listPOQuerySchema.parse({ page: "2", limit: "50" });
    expect(r.page).toBe(2);
    expect(r.limit).toBe(50);
  });

  it("rejects limit > 100", () => {
    expect(listPOQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("accepts valid PO status", () => {
    for (const s of ["DRAFT", "PENDING", "PARTIAL", "RECEIVED", "CANCELLED"]) {
      expect(listPOQuerySchema.safeParse({ status: s }).success).toBe(true);
    }
  });

  it("rejects invalid PO status", () => {
    expect(listPOQuerySchema.safeParse({ status: "APPROVED" }).success).toBe(false);
  });

  it("accepts valid approvalStatus", () => {
    for (const s of ["NOT_REQUIRED", "PENDING_APPROVAL", "APPROVED", "REJECTED"]) {
      expect(listPOQuerySchema.safeParse({ approvalStatus: s }).success).toBe(true);
    }
  });
});

// ── approvePOSchema ───────────────────────────────────────────────────────────

describe("approvePOSchema", () => {
  it("accepts approved=true", () => {
    expect(() => approvePOSchema.parse({ approved: true })).not.toThrow();
  });

  it("accepts approved=false with rejectionReason", () => {
    expect(approvePOSchema.safeParse({ approved: false, rejectionReason: "price too high" }).success).toBe(true);
  });

  it("rejects missing approved field", () => {
    expect(approvePOSchema.safeParse({}).success).toBe(false);
  });

  it("rejects rejectionReason longer than 500 chars", () => {
    expect(approvePOSchema.safeParse({ approved: false, rejectionReason: "x".repeat(501) }).success).toBe(false);
  });
});

// ── sharePOSchema ─────────────────────────────────────────────────────────────

describe("sharePOSchema", () => {
  it("accepts EMAIL method", () => {
    expect(() => sharePOSchema.parse({ method: "EMAIL", recipient: "sup@example.com" })).not.toThrow();
  });

  it("accepts WHATSAPP method", () => {
    expect(sharePOSchema.safeParse({ method: "WHATSAPP", recipient: "9876543210" }).success).toBe(true);
  });

  it("rejects invalid method", () => {
    expect(sharePOSchema.safeParse({ method: "SMS", recipient: "9876543210" }).success).toBe(false);
  });

  it("rejects empty recipient", () => {
    expect(sharePOSchema.safeParse({ method: "EMAIL", recipient: "" }).success).toBe(false);
  });
});

// ── grnItemSchema ─────────────────────────────────────────────────────────────

describe("grnItemSchema", () => {
  const validGRNItem = {
    medicineId:   "med_1",
    medicineName: "Paracetamol 500mg",
    batchNumber:  "B001",
    expiryDate:   "2026-12-31T00:00:00.000Z",
    receivedQty:  20,
    purchaseRate: 5.5,
    mrp:          8.0,
    gstRate:      12,
  };

  it("accepts a valid GRN item", () => {
    expect(() => grnItemSchema.parse(validGRNItem)).not.toThrow();
  });

  it("freeQty defaults to 0", () => {
    expect(grnItemSchema.parse(validGRNItem).freeQty).toBe(0);
  });

  it("discount defaults to 0", () => {
    expect(grnItemSchema.parse(validGRNItem).discount).toBe(0);
  });

  it("purchaseUnit defaults to UNIT", () => {
    expect(grnItemSchema.parse(validGRNItem).purchaseUnit).toBe("UNIT");
  });

  it("rejects receivedQty = 0", () => {
    expect(grnItemSchema.safeParse({ ...validGRNItem, receivedQty: 0 }).success).toBe(false);
  });

  it("accepts freeQty = 0 (nonnegative)", () => {
    expect(grnItemSchema.safeParse({ ...validGRNItem, freeQty: 0 }).success).toBe(true);
  });

  it("rejects freeQty < 0", () => {
    expect(grnItemSchema.safeParse({ ...validGRNItem, freeQty: -1 }).success).toBe(false);
  });

  it("rejects discount > 100", () => {
    expect(grnItemSchema.safeParse({ ...validGRNItem, discount: 101 }).success).toBe(false);
  });

  it("rejects mrp < purchaseRate", () => {
    expect(grnItemSchema.safeParse({ ...validGRNItem, mrp: 4.0, purchaseRate: 5.5 }).success).toBe(false);
  });

  it("accepts valid purchaseUnit values", () => {
    for (const u of ["BOX", "STRIP", "UNIT"]) {
      expect(grnItemSchema.safeParse({ ...validGRNItem, purchaseUnit: u }).success).toBe(true);
    }
  });

  it("accepts empty medicineId (CSV-imported row — resolved server-side)", () => {
    expect(grnItemSchema.safeParse({ ...validGRNItem, medicineId: "" }).success).toBe(true);
  });
});

// ── createGRNSchema ───────────────────────────────────────────────────────────

describe("createGRNSchema", () => {
  const validGRNItem = {
    medicineId: "med_1", medicineName: "Para", batchNumber: "B1",
    expiryDate: "2026-12-31T00:00:00.000Z", receivedQty: 10, purchaseRate: 5, mrp: 8, gstRate: 12,
  };
  const valid = { supplierId: "sup_1", items: [validGRNItem] };

  it("accepts valid GRN", () => {
    expect(() => createGRNSchema.parse(valid)).not.toThrow();
  });

  it("allowNearExpiry defaults to false", () => {
    expect(createGRNSchema.parse(valid).allowNearExpiry).toBe(false);
  });

  it("rejects empty items array", () => {
    expect(createGRNSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });
});

// ── listGRNQuerySchema ────────────────────────────────────────────────────────

describe("listGRNQuerySchema", () => {
  it("applies defaults", () => {
    const r = listGRNQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
  });

  it("accepts valid GRN status", () => {
    for (const s of ["DRAFT", "CONFIRMED", "CANCELLED"]) {
      expect(listGRNQuerySchema.safeParse({ status: s }).success).toBe(true);
    }
  });

  it("rejects invalid GRN status", () => {
    expect(listGRNQuerySchema.safeParse({ status: "PENDING" }).success).toBe(false);
  });

  it("coerces overdue string to boolean", () => {
    expect(listGRNQuerySchema.parse({ overdue: "true" }).overdue).toBe(true);
  });
});

// ── autoSuggestQuerySchema ────────────────────────────────────────────────────

describe("autoSuggestQuerySchema", () => {
  it("daysThreshold defaults to 30", () => {
    expect(autoSuggestQuerySchema.parse({}).daysThreshold).toBe(30);
  });

  it("coerces string daysThreshold to number", () => {
    expect(autoSuggestQuerySchema.parse({ daysThreshold: "14" }).daysThreshold).toBe(14);
  });

  it("rejects non-positive daysThreshold", () => {
    expect(autoSuggestQuerySchema.safeParse({ daysThreshold: "0" }).success).toBe(false);
  });
});

// ── fromReorderSchema ─────────────────────────────────────────────────────────

describe("fromReorderSchema", () => {
  const validItem = {
    medicineId: "med_1", medicineName: "Para",
    quantity: 10, purchaseRate: 5, mrp: 8, gstRate: 12,
  };

  it("accepts valid reorder input", () => {
    expect(() => fromReorderSchema.parse({ supplierId: "sup_1", items: [validItem] })).not.toThrow();
  });

  it("rejects empty items", () => {
    expect(fromReorderSchema.safeParse({ supplierId: "sup_1", items: [] }).success).toBe(false);
  });

  it("rejects invalid gstRate in items", () => {
    expect(
      fromReorderSchema.safeParse({ supplierId: "s1", items: [{ ...validItem, gstRate: 3 }] }).success
    ).toBe(false);
  });
});
