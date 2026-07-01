import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting subscription backfill...");

  // Find all pharmacies
  const pharmacies = await prisma.pharmacy.findMany({
    include: {
      subscription: true,
      tenantSettings: true,
    },
  });

  console.log(`Found ${pharmacies.length} pharmacies.`);
  let backfilledSubscriptions = 0;
  let backfilledSettings = 0;

  for (const pharmacy of pharmacies) {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30); // 30 days from now

    await prisma.$transaction(async (tx) => {
      // 1. Backfill Subscription
      if (!pharmacy.subscription) {
        await tx.subscription.create({
          data: {
            pharmacyId: pharmacy.id,
            planName: "Free",
            status: "ACTIVE",
            billingCycle: "MONTHLY",
            amount: 0,
            autoRenew: true,
            validUntil,
          },
        });
        backfilledSubscriptions++;
      }

      // 2. Backfill TenantSettings
      if (!pharmacy.tenantSettings) {
        await tx.tenantSettings.create({
          data: {
            pharmacyId: pharmacy.id,
            doctorLimit: 5,
            staffLimit: 5,
            patientLimit: 500,
            storageLimit: 1024,
            enableBilling: true,
            enableInventory: true,
            enableEmr: false,
            enableCrm: false,
            enableWhatsapp: false,
            enableSms: false,
            enableApiAccess: false,
            enableOnlineBooking: false,
          },
        });
        backfilledSettings++;
      }
    });
  }

  console.log(`Backfill complete!`);
  console.log(`- Created ${backfilledSubscriptions} subscriptions`);
  console.log(`- Created ${backfilledSettings} tenant settings`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
