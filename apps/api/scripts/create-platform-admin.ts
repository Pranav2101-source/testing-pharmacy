/**
 * One-time setup script — creates the first Platform Admin account.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/create-platform-admin.ts
 *
 * You will be prompted for a name, email, and password.
 * The account is created in the platform pharmacy (platform_checkup_support).
 */

import { createInterface } from "node:readline";
import { PrismaClient }    from "@pharmacy/database";
import bcrypt              from "bcryptjs";
import "dotenv/config";

const PLATFORM_PHARMACY_ID = "platform_checkup_support";

const db = new PrismaClient();

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n🔐  Checkup — Create Platform Admin\n");

  // Verify the platform pharmacy exists
  const pharmacy = await db.pharmacy.findUnique({ where: { id: PLATFORM_PHARMACY_ID } });
  if (!pharmacy) {
    console.error("❌  Platform pharmacy not found. Run database migrations first.");
    console.error("    cd packages/database && npx prisma migrate deploy");
    process.exit(1);
  }

  // Check if an admin already exists
  const existing = await db.user.findFirst({
    where: { pharmacyId: PLATFORM_PHARMACY_ID, role: "PLATFORM_ADMIN" },
  });
  if (existing) {
    console.log(`✅  A Platform Admin already exists: ${existing.name} (${existing.email})`);
    console.log("    To create another, use the Agents page inside the app.\n");
    rl.close();
    await db.$disconnect();
    return;
  }

  // Collect details
  const name     = (await prompt(rl, "Full name:   ")).trim();
  const email    = (await prompt(rl, "Email:       ")).trim().toLowerCase();
  const password = (await prompt(rl, "Password:    ")).trim();

  if (!name || !email || password.length < 8) {
    console.error("❌  Name and email are required. Password must be at least 8 characters.");
    rl.close();
    await db.$disconnect();
    process.exit(1);
  }

  const emailExists = await db.user.findFirst({ where: { email } });
  if (emailExists) {
    console.error(`❌  Email "${email}" is already registered.`);
    rl.close();
    await db.$disconnect();
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await db.user.create({
    data: {
      pharmacyId: PLATFORM_PHARMACY_ID,
      name,
      email,
      passwordHash,
      role: "PLATFORM_ADMIN",
    },
  });

  console.log(`\n✅  Platform Admin created!`);
  console.log(`    Name:  ${admin.name}`);
  console.log(`    Email: ${admin.email}`);
  console.log(`    Role:  PLATFORM_ADMIN`);
  console.log(`\n    Login at your app URL with these credentials.\n`);

  rl.close();
  await db.$disconnect();
}

main().catch((err) => {
  console.error("❌  Error:", err.message ?? err);
  process.exit(1);
});
