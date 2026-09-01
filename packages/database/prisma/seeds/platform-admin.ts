import bcrypt from "bcryptjs";
import { prisma } from "../../src/client.js";

/**
 * Local-dev only. Creates a PLATFORM_ADMIN you can actually log in as — production already has
 * one, but a fresh local database has none, so the Support / Tenants / Agents screens are
 * unreachable. Never runs on deploy (`pnpm db:seed` is a manual step).
 *
 * The BCrypt hash is produced with the same cost the Java API's BCryptPasswordEncoder uses (10),
 * and `$2a$`/`$2b$` hashes verify interchangeably there.
 */

// Fixed id of the platform pharmacy support staff belong to — seeded by 20260611000001_support_module.
const PLATFORM_PHARMACY_ID = "platform_checkup_support";

const ADMIN_ID = "seed_platform_admin";
const ADMIN_EMAIL = "admin@checkup.local";
const ADMIN_PASSWORD = "DevAdmin1234!";

export async function seedPlatformAdmin(): Promise<void> {
  // The support migration inserts this row; upsert is a no-op safety net for a DB built another way.
  await prisma.pharmacy.upsert({
    where: { id: PLATFORM_PHARMACY_ID },
    update: {},
    create: {
      id: PLATFORM_PHARMACY_ID,
      name: "Checkup Support Team",
      slug: "platform-support",
      isActive: true,
    },
  });

  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

  await prisma.user.upsert({
    where: { id: ADMIN_ID },
    update: { passwordHash, role: "PLATFORM_ADMIN", isActive: true, email: ADMIN_EMAIL },
    create: {
      id: ADMIN_ID,
      pharmacyId: PLATFORM_PHARMACY_ID,
      name: "Platform Admin",
      email: ADMIN_EMAIL,
      passwordHash,
      role: "PLATFORM_ADMIN",
      isActive: true,
    },
  });

  console.log(`\n  Platform admin ready — log in at /login:`);
  console.log(`    email:    ${ADMIN_EMAIL}`);
  console.log(`    password: ${ADMIN_PASSWORD}`);
  console.log(`  Then open Support → Agents to add support agents.\n`);
}
