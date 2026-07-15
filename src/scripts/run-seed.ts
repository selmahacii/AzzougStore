import { seedDatabase } from '../lib/seed';

async function run() {
  try {
    await seedDatabase();
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

run();
