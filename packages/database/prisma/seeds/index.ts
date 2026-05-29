import { prisma } from "../../src/client.js";
import { medicines } from "./medicines.js";

async function seed() {
  console.log("Seeding medicines...");
  let created = 0;

  for (const medicine of medicines) {
    await prisma.medicine.upsert({
      where: { id: medicine.id },
      update: medicine,
      create: medicine,
    });
    created++;
  }

  console.log(`✓ Seeded ${created} medicines.`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
