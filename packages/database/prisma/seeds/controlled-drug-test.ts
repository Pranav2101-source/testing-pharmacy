/**
 * Seed: controlled drug billing test
 *
 * Adds Schedule H1 + X medicines with stock, one doctor, and one ACTIVE
 * prescription so the billing flag feature can be tested end-to-end.
 *
 * Run from repo root:
 *   pnpm --filter @pharmacy/database exec tsx prisma/seeds/controlled-drug-test.ts
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load root .env BEFORE the Prisma client is imported.
// Static imports are hoisted in ES modules, so prisma must be a dynamic import
// to ensure DATABASE_URL is set in process.env before PrismaClient initialises.
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../../.env") });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { prisma } = await import("../../src/client.js") as any;

// ── 1. New global medicines (H1 and X) ───────────────────────────────────────

const NEW_MEDICINES = [
  {
    id:           "tramadol-50mg",
    name:         "Tramadol 50mg",
    genericName:  "Tramadol HCL",
    manufacturer: "Sun Pharma",
    composition:  "Tramadol HCL 50mg",
    category:     "Opioid Analgesic",
    schedule:     "H1",
    hsnCode:      "30049099",
    gstRate:      12,
    form:         "tablet",
    strength:     "50mg",
    unit:         "strip",
    packSize:     "10 tablets",
  },
  {
    id:           "alprazolam-0.5mg",
    name:         "Alprazolam 0.5mg",
    genericName:  "Alprazolam",
    manufacturer: "Pfizer",
    composition:  "Alprazolam 0.5mg",
    category:     "Benzodiazepine",
    schedule:     "X",
    hsnCode:      "30049099",
    gstRate:      12,
    form:         "tablet",
    strength:     "0.5mg",
    unit:         "strip",
    packSize:     "10 tablets",
  },
];

// ── 2. Inventory batches for the new medicines ────────────────────────────────

const NEW_STOCK = [
  {
    medicineId:  "tramadol-50mg",
    batchNumber: "TRM/25/001",
    expiryDate:  new Date("2027-06-30"),
    quantity:    50,
    purchaseRate: 65.00,
    mrp:         95.00,
    location:    "R6-A1",
  },
  {
    medicineId:  "alprazolam-0.5mg",
    batchNumber: "ALP/25/001",
    expiryDate:  new Date("2027-09-30"),
    quantity:    30,
    purchaseRate: 28.00,
    mrp:         42.00,
    location:    "R6-A2",
  },
];

async function run() {
  // ── Medicines ───────────────────────────────────────────────────────────────
  console.log("Seeding controlled medicines (H1, X)...");
  for (const med of NEW_MEDICINES) {
    await prisma.medicine.upsert({
      where:  { id: med.id },
      update: med,
      create: med,
    });
    console.log(`  ✓ ${med.name} (Schedule ${med.schedule})`);
  }

  // ── Pharmacy ────────────────────────────────────────────────────────────────
  // Skip the internal platform pharmacy; use the real pharmacy account
  const pharmacy = await prisma.pharmacy.findFirst({
    where:   { id: { not: "platform_checkup_support" } },
    orderBy: { createdAt: "asc" },
  });
  if (!pharmacy) {
    console.error("\n✗ No pharmacy found. Register your pharmacy first, then re-run.");
    return;
  }
  console.log(`\nUsing pharmacy: "${pharmacy.name}" (${pharmacy.id})`);

  // ── Inventory batches ───────────────────────────────────────────────────────
  console.log("\nSeeding inventory batches...");
  for (const s of NEW_STOCK) {
    await prisma.inventory.upsert({
      where: {
        pharmacyId_medicineId_batchNumber: {
          pharmacyId:  pharmacy.id,
          medicineId:  s.medicineId,
          batchNumber: s.batchNumber,
        },
      },
      update: {
        quantity:     s.quantity,
        purchaseRate: s.purchaseRate,
        mrp:          s.mrp,
        location:     s.location,
        expiryDate:   s.expiryDate,
        status:       "ACTIVE",
      },
      create: {
        pharmacyId:      pharmacy.id,
        medicineId:      s.medicineId,
        batchNumber:     s.batchNumber,
        expiryDate:      s.expiryDate,
        quantity:        s.quantity,
        reservedQuantity: 0,
        purchaseRate:    s.purchaseRate,
        mrp:             s.mrp,
        location:        s.location,
        minimumStock:    10,
        reorderLevel:    5,
        status:          "ACTIVE",
      },
    });
    console.log(`  ✓ ${s.medicineId} batch ${s.batchNumber}`);
  }

  // ── Doctor ──────────────────────────────────────────────────────────────────
  console.log("\nSeeding test doctor...");
  const doctor = await prisma.doctor.upsert({
    where:  { id: "test-doctor-001" },
    update: {},
    create: {
      id:             "test-doctor-001",
      pharmacyId:     pharmacy.id,
      name:           "Dr. Rajesh Kumar",
      registrationNo: "MCI-12345",
      specialty:      "General Physician",
      clinic:         "Kumar Clinic",
      phone:          "9876543210",
      isActive:       true,
    },
  });
  console.log(`  ✓ ${doctor.name} (${doctor.registrationNo})`);

  // ── Prescription (ACTIVE) ───────────────────────────────────────────────────
  console.log("\nSeeding ACTIVE test prescription...");

  // Count existing prescriptions to derive the number
  const existingCount = await prisma.prescription.count({ where: { pharmacyId: pharmacy.id } });
  const rxNumber = `RX-${String(existingCount + 1).padStart(5, "0")}`;

  // Check if our test prescription already exists
  const existingRx = await prisma.prescription.findFirst({
    where: { pharmacyId: pharmacy.id, prescriptionNumber: { startsWith: "RX-TEST-" } },
  });

  if (existingRx) {
    console.log(`  ✓ Test prescription already exists: ${existingRx.prescriptionNumber}`);
  } else {
    const rx = await prisma.prescription.create({
      data: {
        pharmacyId:      pharmacy.id,
        prescriptionNumber: "RX-TEST-001",
        doctorId:        doctor.id,
        doctorName:      doctor.name,
        doctorRegNo:     doctor.registrationNo,
        patientName:     "Amit Sharma",
        patientAge:      35,
        patientPhone:    "9123456789",
        patientGender:   "Male",
        prescribedDate:  new Date("2026-06-18"),
        validUntil:      new Date("2026-09-18"),
        status:          "ACTIVE",
        notes:           "Test prescription for billing flow verification",
        items: {
          create: [
            {
              pharmacyId:   pharmacy.id,
              medicineName: "Tramadol 50mg",
              medicineId:   "tramadol-50mg",
              schedule:     "H1",
              quantity:     10,
              dosage:       "1 tablet twice daily",
              duration:     "5 days",
            },
            {
              pharmacyId:   pharmacy.id,
              medicineName: "Alprazolam 0.5mg",
              medicineId:   "alprazolam-0.5mg",
              schedule:     "X",
              quantity:     10,
              dosage:       "1 tablet at bedtime",
              duration:     "10 days",
            },
            {
              pharmacyId:   pharmacy.id,
              medicineName: "Amoxicillin 500mg",
              medicineId:   "amoxicillin-500mg",
              schedule:     "H",
              quantity:     10,
              dosage:       "1 capsule three times daily",
              duration:     "5 days",
            },
          ],
        },
      },
    });
    console.log(`  ✓ ${rx.prescriptionNumber} — ${rx.patientName} (ACTIVE)`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Test data ready. To test the billing flag:

  1. Go to Billing → New Bill
  2. Search and add any of these drugs:
     • Amoxicillin 500mg      → shows  [Sch H]   (amber)
     • Tramadol 50mg          → shows  [Sch H1]  (orange)
     • Alprazolam 0.5mg       → shows  [Sch X]   (red)
  3. Rx header turns amber "Rx Required"
  4. Search "RX-TEST-001" or "Amit" in the Rx field
  5. Select it → header turns green "✓ Linked"

  Also try: Paracetamol / Ibuprofen / Dolo-650 (OTC)
  → No flag should appear for those.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
