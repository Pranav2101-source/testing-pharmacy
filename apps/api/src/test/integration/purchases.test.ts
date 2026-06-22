import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, registerTestPharmacy, bearer } from "../helpers.js";

let app:        FastifyInstance;
let token:      string;
let supplierId: string;

// An expiry date well beyond the 90-day near-expiry guard
const FAR_EXPIRY = new Date(Date.now() + 400 * 86_400_000).toISOString();

beforeAll(async () => {
  app = await createTestApp();
  const pharmacy = await registerTestPharmacy(app, `pur-${Date.now()}`);
  token = pharmacy.accessToken;

  // Create a supplier to use across all GRN / PO tests
  const res = await app.inject({
    method:  "POST",
    url:     "/api/v1/suppliers",
    headers: bearer(token),
    payload: { name: "Test Distributor", phone: "9000000001" },
  });
  supplierId = res.json().data.id as string;
});

afterAll(async () => { await app.close(); });

// ── Auth guards ───────────────────────────────────────────────────────────────

describe("POST /api/v1/purchases/grn — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/purchases/grn" });
    expect(res.statusCode).toBe(401);
  });
});

// ── GRN with a pre-existing medicine (known medicineId) ───────────────────────

describe("POST /api/v1/purchases/grn — known medicineId", () => {
  let medicineId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/medicines",
      headers: bearer(token),
      payload: { name: "Paracetamol 500mg Strip", gstRate: 12 },
    });
    medicineId = res.json().data.id as string;
  });

  it("creates a DRAFT GRN and returns 201", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [{
          medicineId,
          medicineName: "Paracetamol 500mg Strip",
          batchNumber:  "B001",
          expiryDate:   FAR_EXPIRY,
          receivedQty:  100,
          purchaseRate: 4.5,
          mrp:          8.0,
          gstRate:      12,
        }],
      },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.grnNumber).toMatch(/^GRN/);
    expect(data.status).toBe("DRAFT");
    expect(data.items).toHaveLength(1);
    expect(data.items[0].medicineId).toBe(medicineId);
  });
});

// ── GRN with empty medicineId (CSV-import path) ───────────────────────────────

describe("POST /api/v1/purchases/grn — empty medicineId auto-creates medicine", () => {
  const MEDICINE_NAME = `Amoxicillin 250mg Cap ${Date.now()}`;

  it("creates the GRN and auto-creates the missing medicine", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [{
          medicineId:   "",           // empty — simulates CSV import
          medicineName: MEDICINE_NAME,
          batchNumber:  "LOT001",
          expiryDate:   FAR_EXPIRY,
          receivedQty:  50,
          purchaseRate: 18.0,
          mrp:          32.0,
          gstRate:      12,
        }],
      },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.status).toBe("DRAFT");
    expect(data.items[0].medicineName).toBe(MEDICINE_NAME);
    // medicineId was filled in by the server
    expect(data.items[0].medicineId).toBeTruthy();
  });

  it("reuses the auto-created medicine on a second GRN (no duplicate created)", async () => {
    const res1 = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [{ medicineId: "", medicineName: MEDICINE_NAME, batchNumber: "LOT002", expiryDate: FAR_EXPIRY, receivedQty: 20, purchaseRate: 18.0, mrp: 32.0, gstRate: 12 }],
      },
    });
    const res2 = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [{ medicineId: "", medicineName: MEDICINE_NAME, batchNumber: "LOT003", expiryDate: FAR_EXPIRY, receivedQty: 30, purchaseRate: 18.0, mrp: 32.0, gstRate: 12 }],
      },
    });
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    const id1 = res1.json().data.items[0].medicineId;
    const id2 = res2.json().data.items[0].medicineId;
    expect(id1).toBe(id2); // same medicine record, not two separate ones
  });

  it("case-insensitive name match — does not create a duplicate for different casing", async () => {
    // First GRN uses mixed case
    const r1 = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [{ medicineId: "", medicineName: MEDICINE_NAME.toUpperCase(), batchNumber: "LOT004", expiryDate: FAR_EXPIRY, receivedQty: 10, purchaseRate: 18.0, mrp: 32.0, gstRate: 12 }],
      },
    });
    expect(r1.statusCode).toBe(201);
    const idFromUpperCase = r1.json().data.items[0].medicineId;
    // Must resolve to the same medicine created earlier
    const r2 = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [{ medicineId: "", medicineName: MEDICINE_NAME, batchNumber: "LOT005", expiryDate: FAR_EXPIRY, receivedQty: 10, purchaseRate: 18.0, mrp: 32.0, gstRate: 12 }],
      },
    });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().data.items[0].medicineId).toBe(idFromUpperCase);
  });
});

// ── GRN with multiple CSV items (mixed new + existing) ────────────────────────

describe("POST /api/v1/purchases/grn — mixed items (some known, some new)", () => {
  let knownMedicineId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/medicines",
      headers: bearer(token),
      payload: { name: "Metformin 500mg Strip", gstRate: 12 },
    });
    knownMedicineId = res.json().data.id as string;
  });

  it("resolves all items and returns 201", async () => {
    const newName = `Glimepiride 2mg Tab ${Date.now()}`;
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [
          { medicineId: knownMedicineId, medicineName: "Metformin 500mg Strip", batchNumber: "MF01", expiryDate: FAR_EXPIRY, receivedQty: 60, purchaseRate: 3.0, mrp: 5.5, gstRate: 12 },
          { medicineId: "",              medicineName: newName,                  batchNumber: "GL01", expiryDate: FAR_EXPIRY, receivedQty: 30, purchaseRate: 8.0, mrp: 14.0, gstRate: 5 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const items = res.json().data.items as Array<{ medicineId: string; medicineName: string }>;
    expect(items).toHaveLength(2);
    expect(items[0]!.medicineId).toBe(knownMedicineId);
    expect(items[1]!.medicineId).toBeTruthy();
    expect(items[1]!.medicineId).not.toBe("");
  });
});

// ── Validation failures ───────────────────────────────────────────────────────

describe("POST /api/v1/purchases/grn — validation", () => {
  it("returns 400 when supplierId is missing", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: { items: [{ medicineId: "x", medicineName: "X", batchNumber: "B", expiryDate: FAR_EXPIRY, receivedQty: 1, purchaseRate: 1, mrp: 2, gstRate: 12 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when items array is empty", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: { supplierId, items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when mrp < purchaseRate", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [{ medicineId: "x", medicineName: "X", batchNumber: "B", expiryDate: FAR_EXPIRY, receivedQty: 1, purchaseRate: 10, mrp: 5, gstRate: 12 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 422 when near-expiry stock is submitted without allowNearExpiry flag", async () => {
    const nearExpiry = new Date(Date.now() + 30 * 86_400_000).toISOString(); // 30 days — within 90-day guard
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        items: [{ medicineId: "", medicineName: `NearExpiry Drug ${Date.now()}`, batchNumber: "NE01", expiryDate: nearExpiry, receivedQty: 10, purchaseRate: 5, mrp: 8, gstRate: 12 }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/expire/i);
  });

  it("returns 201 when near-expiry stock is submitted with allowNearExpiry: true", async () => {
    const nearExpiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await app.inject({
      method:  "POST",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
      payload: {
        supplierId,
        allowNearExpiry: true,
        items: [{ medicineId: "", medicineName: `NearExpiry Drug Allowed ${Date.now()}`, batchNumber: "NE02", expiryDate: nearExpiry, receivedQty: 10, purchaseRate: 5, mrp: 8, gstRate: 12 }],
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ── List GRNs ─────────────────────────────────────────────────────────────────

describe("GET /api/v1/purchases/grn", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/purchases/grn" });
    expect(res.statusCode).toBe(401);
  });

  it("returns paginated DRAFT GRNs", async () => {
    const res = await app.inject({
      method:  "GET",
      url:     "/api/v1/purchases/grn",
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.items)).toBe(true);
  });
});
