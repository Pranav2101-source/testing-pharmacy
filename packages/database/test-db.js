const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$queryRaw`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pharmacies'`
  .then(console.log)
  .catch(console.error)
  .finally(() => prisma.$disconnect());
