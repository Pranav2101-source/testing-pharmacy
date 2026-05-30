import { prisma } from "../../src/client.js";
import { medicines } from "./medicines.js";

async function seed() {
  console.log("Seeding medicines...");
  let created = 0;

  for (const medicine of medicines) {
    await prisma.medicine.upsert({
      where:  { id: medicine.id },
      update: medicine,
      create: medicine,
    });
    created++;
  }

  console.log(`✓ Seeded ${created} medicines to Postgres.`);
  console.log("");
  console.log("⚠  Meilisearch is NOT seeded yet.");
  console.log("   Start the API then call:");
  console.log("   POST /api/medicines/reindex");
  console.log("   (owner token required — run this once to make search work)");
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
