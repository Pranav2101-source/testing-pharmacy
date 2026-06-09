import { prisma } from "../../src/client.js";
import { medicines } from "./medicines.js";
import { seedInventory } from "./inventory.js";

async function seed() {
  // ── 1. Medicines (global catalogue) ────────────────────────────────────────
  console.log("Seeding medicines...");
  let medCount = 0;
  for (const medicine of medicines) {
    await prisma.medicine.upsert({
      where:  { id: medicine.id },
      update: medicine,
      create: medicine,
    });
    medCount++;
  }
  console.log(`✓ ${medCount} medicines seeded`);

  // ── 2. Inventory (per-pharmacy stock) ───────────────────────────────────────
  console.log("\nSeeding inventory stock...");
  const result = await seedInventory();
  if (result === 0) {
    console.log("  Skipped — no pharmacy in DB yet.");
  } else {
    console.log(`✓ ${result.created} inventory batches seeded for "${result.pharmacyName}"`);
    if (result.skipped > 0) console.log(`  (${result.skipped} medicines skipped — not found in catalogue)`);
  }

  // ── 3. Post-seed instructions ────────────────────────────────────────────────
  console.log("");
  console.log("⚠  Meilisearch index is NOT populated yet.");
  console.log("   Start the API then call once:");
  console.log("   POST /api/medicines/reindex   (owner JWT required)");
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
