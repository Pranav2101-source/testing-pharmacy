const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  try {
    const tenant = await prisma.pharmacy.findFirst();
    console.log("Success! Found tenant:", tenant ? tenant.id : "None");
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await prisma.$disconnect();
  }
}
test();
