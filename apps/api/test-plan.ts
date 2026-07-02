import { SubscriptionsService } from './src/modules/platform/subscriptions.service.js';
import { PrismaClient } from '@pharmacy/database';
const prisma = new PrismaClient();
const app = { prisma } as any;

async function test() {
  const s = new SubscriptionsService(app);
  try {
    await s.changePlan('cmqy2209t0002xv6j97j5sybh', 'Standard', 'YEARLY', undefined, 'cmqy2209t0002xv6j97j5sabc');
  } catch(e) {
    console.error(e);
  }
}
test();
