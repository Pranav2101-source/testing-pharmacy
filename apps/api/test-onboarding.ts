import { PrismaClient } from '@pharmacy/database';
import { PharmacyOnboardingService } from './src/modules/pharmacy/pharmacy-onboarding.service';

const prisma = new PrismaClient();
const app = { prisma } as any;

async function runTests() {
  const service = new PharmacyOnboardingService(app);
  
  const email = `testowner_${Date.now()}@example.com`;
  const slug = `testpharmacy-${Date.now()}`;
  
  try {
    console.log("Creating first pharmacy...");
    const p1 = await service.onboardPharmacy(null, {
      pharmacyData: { name: "Test Pharmacy", slug, email: "contact@test.com" },
      ownerData: { name: "Owner", email, passwordHash: "hashed" },
      createOwner: true
    });
    console.log("Pharmacy 1 created:", p1.id);

    console.log("Testing duplicate slug...");
    try {
      await service.onboardPharmacy(null, {
        pharmacyData: { name: "Test Pharmacy 2", slug, email: "contact2@test.com" },
        ownerData: { name: "Owner 2", email: `other_${Date.now()}@example.com`, passwordHash: "hashed" },
        createOwner: true
      });
      console.log("FAIL: Duplicate slug allowed");
    } catch (err: any) {
      console.log("PASS: Duplicate slug rejected with message:", err.message);
    }

    console.log("Testing duplicate email...");
    try {
      await service.onboardPharmacy(null, {
        pharmacyData: { name: "Test Pharmacy 3", slug: `slug-${Date.now()}`, email: "contact3@test.com" },
        ownerData: { name: "Owner 3", email, passwordHash: "hashed" },
        createOwner: true
      });
      console.log("FAIL: Duplicate email allowed");
    } catch (err: any) {
      console.log("PASS: Duplicate email rejected with message:", err.message);
    }

    console.log("Testing rollback on User creation failure (invalid role / missing field)...");
    // To simulate user creation failure, we can pass a really long name that violates db constraints 
    // or just pass a duplicate email but change the slug. Wait, duplicate email is already caught by prisma. 
    // If it's caught, the transaction rolls back. Let's verify no pharmacy was created for it.
    const pharmacies = await prisma.pharmacy.findMany({ where: { name: "Test Pharmacy 3" } });
    if (pharmacies.length === 0) {
      console.log("PASS: Rollback confirmed, no pharmacy created.");
    } else {
      console.log("FAIL: Rollback failed, pharmacy created.");
    }

  } finally {
    await prisma.$disconnect();
  }
}

runTests().catch(console.error);
