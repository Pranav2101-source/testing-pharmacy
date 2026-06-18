import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../../.env") });

const { prisma } = await import("../../src/client.js") as any;

const pharmacies = await prisma.pharmacy.findMany({
  select: { id: true, name: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});

console.log("\nPharmacies in database:");
for (const p of pharmacies) {
  console.log(`  id: ${p.id}  name: "${p.name}"`);
}

await prisma.$disconnect();
