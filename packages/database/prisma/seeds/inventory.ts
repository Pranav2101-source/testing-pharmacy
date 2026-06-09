import { prisma } from "../../src/client.js";

// Today = 2026-06-09 (current date in this project)
// Near-expiry  : ~2 months  → 2026-08-31
// Short-life   : ~6 months  → 2026-12-31
// Normal       : ~12 months → 2027-06-30
// Long-life    : ~24 months → 2028-06-30

type Batch = {
  batchNumber:  string;
  expiryDate:   Date;
  quantity:     number;
  purchaseRate: number;
  mrp:          number;
  location:     string;
};

type StockEntry = {
  medicineId: string;
  batches:    Batch[];
};

// Two batches on high-turnover items so FEFO ordering can be tested end-to-end.
const STOCK: StockEntry[] = [
  {
    medicineId: "paracetamol-500mg",
    batches: [
      { batchNumber: "PCM/24/001", expiryDate: new Date("2026-09-30"), quantity: 80,  purchaseRate: 10.50, mrp: 15.00, location: "R1-A1" },
      { batchNumber: "PCM/25/001", expiryDate: new Date("2027-06-30"), quantity: 200, purchaseRate: 10.50, mrp: 15.00, location: "R1-A1" },
    ],
  },
  {
    medicineId: "amoxicillin-500mg",
    batches: [
      { batchNumber: "AMX/25/001", expiryDate: new Date("2027-03-31"), quantity: 100, purchaseRate: 62.00, mrp: 85.00, location: "R2-A1" },
    ],
  },
  {
    medicineId: "metformin-500mg",
    batches: [
      { batchNumber: "MET/24/002", expiryDate: new Date("2026-08-31"), quantity: 50,  purchaseRate: 30.00, mrp: 45.00, location: "R2-A2" },
      { batchNumber: "MET/25/001", expiryDate: new Date("2027-08-31"), quantity: 150, purchaseRate: 30.00, mrp: 45.00, location: "R2-A2" },
    ],
  },
  {
    medicineId: "atorvastatin-10mg",
    batches: [
      { batchNumber: "ATV/25/001", expiryDate: new Date("2027-09-30"), quantity: 80,  purchaseRate: 88.00, mrp: 120.00, location: "R3-A1" },
    ],
  },
  {
    medicineId: "amlodipine-5mg",
    batches: [
      { batchNumber: "AML/25/001", expiryDate: new Date("2026-12-31"), quantity: 100, purchaseRate: 52.00, mrp: 75.00, location: "R3-A2" },
    ],
  },
  {
    medicineId: "pantoprazole-40mg",
    batches: [
      { batchNumber: "PAN/25/001", expiryDate: new Date("2026-11-30"), quantity: 90,  purchaseRate: 78.00, mrp: 110.00, location: "R4-A1" },
    ],
  },
  {
    medicineId: "cetirizine-10mg",
    batches: [
      { batchNumber: "CTZ/25/001", expiryDate: new Date("2027-07-31"), quantity: 120, purchaseRate: 17.00, mrp: 25.00, location: "R4-A2" },
    ],
  },
  {
    medicineId: "azithromycin-500mg",
    batches: [
      { batchNumber: "AZI/25/001", expiryDate: new Date("2027-02-28"), quantity: 60,  purchaseRate: 102.00, mrp: 145.00, location: "R2-B1" },
    ],
  },
  {
    medicineId: "omeprazole-20mg",
    batches: [
      { batchNumber: "OME/24/003", expiryDate: new Date("2026-08-31"), quantity: 30,  purchaseRate: 56.00, mrp: 80.00, location: "R4-B1" },
      { batchNumber: "OME/25/001", expiryDate: new Date("2027-10-31"), quantity: 80,  purchaseRate: 56.00, mrp: 80.00, location: "R4-B1" },
    ],
  },
  {
    medicineId: "cefixime-200mg",
    batches: [
      { batchNumber: "CEF/25/001", expiryDate: new Date("2027-04-30"), quantity: 70,  purchaseRate: 118.00, mrp: 165.00, location: "R2-B2" },
    ],
  },
  {
    medicineId: "montelukast-10mg",
    batches: [
      { batchNumber: "MTL/25/001", expiryDate: new Date("2027-05-31"), quantity: 90,  purchaseRate: 92.00, mrp: 130.00, location: "R5-A1" },
    ],
  },
  {
    medicineId: "ibuprofen-400mg",
    batches: [
      { batchNumber: "IBU/25/001", expiryDate: new Date("2027-06-30"), quantity: 150, purchaseRate: 21.00, mrp: 30.00, location: "R1-B1" },
    ],
  },
  {
    medicineId: "losartan-50mg",
    batches: [
      { batchNumber: "LST/24/002", expiryDate: new Date("2026-08-31"), quantity: 40,  purchaseRate: 63.00, mrp: 90.00, location: "R3-B1" },
      { batchNumber: "LST/25/001", expiryDate: new Date("2028-06-30"), quantity: 80,  purchaseRate: 63.00, mrp: 90.00, location: "R3-B1" },
    ],
  },
  {
    medicineId: "glimepiride-1mg",
    batches: [
      { batchNumber: "GLM/25/001", expiryDate: new Date("2027-01-31"), quantity: 70,  purchaseRate: 38.00, mrp: 55.00, location: "R3-B2" },
    ],
  },
  {
    medicineId: "dolo-650",
    batches: [
      { batchNumber: "DLO/25/001", expiryDate: new Date("2027-11-30"), quantity: 300, purchaseRate: 20.00, mrp: 30.00, location: "R1-A2" },
    ],
  },
  {
    medicineId: "ors-sachet",
    batches: [
      { batchNumber: "ORS/25/001", expiryDate: new Date("2027-08-31"), quantity: 200, purchaseRate: 9.50,  mrp: 15.00, location: "R5-B1" },
    ],
  },
  {
    medicineId: "vitamin-d3-60000iu",
    batches: [
      { batchNumber: "VTD/25/001", expiryDate: new Date("2027-03-31"), quantity: 100, purchaseRate: 52.00, mrp: 75.00, location: "R5-A2" },
    ],
  },
  {
    medicineId: "ranitidine-150mg",
    batches: [
      // Near-expiry batch — useful for testing expiry alert flows
      { batchNumber: "RAN/24/001", expiryDate: new Date("2026-07-31"), quantity: 25,  purchaseRate: 24.00, mrp: 35.00, location: "R4-C1" },
      { batchNumber: "RAN/25/001", expiryDate: new Date("2028-06-30"), quantity: 80,  purchaseRate: 24.00, mrp: 35.00, location: "R4-C1" },
    ],
  },
  {
    medicineId: "albendazole-400mg",
    batches: [
      { batchNumber: "ALB/25/001", expiryDate: new Date("2027-09-30"), quantity: 120, purchaseRate: 24.00, mrp: 35.00, location: "R5-B2" },
    ],
  },
  {
    medicineId: "multivitamin-tablet",
    batches: [
      { batchNumber: "MUL/25/001", expiryDate: new Date("2026-12-31"), quantity: 80,  purchaseRate: 245.00, mrp: 350.00, location: "R5-C1" },
      { batchNumber: "MUL/25/002", expiryDate: new Date("2028-06-30"), quantity: 100, purchaseRate: 245.00, mrp: 350.00, location: "R5-C1" },
    ],
  },
];

export async function seedInventory() {
  const pharmacy = await prisma.pharmacy.findFirst({ orderBy: { createdAt: "asc" } });
  if (!pharmacy) {
    console.log("⚠  No pharmacy found — skipping inventory seed. Register a pharmacy first.");
    return 0;
  }

  let created = 0;
  let skipped = 0;

  for (const entry of STOCK) {
    // Verify medicine exists before inserting
    const medicine = await prisma.medicine.findUnique({ where: { id: entry.medicineId } });
    if (!medicine) {
      console.warn(`  ⚠ medicine "${entry.medicineId}" not found — skipping`);
      skipped++;
      continue;
    }

    for (const batch of entry.batches) {
      await prisma.inventory.upsert({
        where: {
          pharmacyId_medicineId_batchNumber: {
            pharmacyId:  pharmacy.id,
            medicineId:  entry.medicineId,
            batchNumber: batch.batchNumber,
          },
        },
        update: {
          quantity:     batch.quantity,
          purchaseRate: batch.purchaseRate,
          mrp:          batch.mrp,
          location:     batch.location,
          expiryDate:   batch.expiryDate,
          status:       "ACTIVE",
        },
        create: {
          pharmacyId:      pharmacy.id,
          medicineId:      entry.medicineId,
          batchNumber:     batch.batchNumber,
          expiryDate:      batch.expiryDate,
          quantity:        batch.quantity,
          reservedQuantity: 0,
          purchaseRate:    batch.purchaseRate,
          mrp:             batch.mrp,
          location:        batch.location,
          minimumStock:    10,
          reorderLevel:    5,
          status:          "ACTIVE",
        },
      });
      created++;
    }
  }

  return { created, skipped, pharmacyName: pharmacy.name };
}
