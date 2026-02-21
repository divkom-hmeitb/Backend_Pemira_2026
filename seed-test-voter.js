// seed-test-voter.js - Add one test voter without sending email
require('dotenv').config();
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || 'library';
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function seedTestVoter() {
  console.log("🌱 Seeding test voter...");
  
  try {
    const voter = await prisma.voter.upsert({
      where: { nim: "13223010" },
      update: { token: "QZ1VNS" },
      create: {
        nim: "13223010",
        name: "Gregorius Yoga Robianto",
        token: "QZ1VNS",
        isVoteCakahim: false,
        isVoteCasenat: false,
      },
    });

    console.log("✅ Test voter seeded:", voter);
  } catch (error) {
    console.error('❌ Error seeding:', error.message);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

seedTestVoter();
