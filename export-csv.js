// Program untuk mengambil seluruh data dari tabel Voter dan mengekspor ke CSV
require('dotenv').config();
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || 'library';
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function exportToCsv() {
  console.log('📊 Fetching data from Voter table...\n');

  try {
    const voters = await prisma.voter.findMany({
      orderBy: { createdAt: 'desc' },
    });

    if (voters.length === 0) {
      console.log('❌ No data found in the table.');
      return;
    }

    console.log(`✅ Found ${voters.length} voter(s). Exporting to CSV...\n`);

    const headers = [
      'id',
      'nim',
      'name',
      'token',
      'isVoteCakahim',
      'kahimChoice',
      'isVoteCasenat',
      'senatorChoice',
      'votedDate',
      'votedTime',
      'cloudinaryUrl',
      'createdAt',
      'updatedAt',
    ];

    const rows = voters.map((voter) =>
      headers.map((header) => escapeCsvField(voter[header])).join(',')
    );

    const csvContent = [headers.join(','), ...rows].join('\n');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `voters_export_${timestamp}.csv`;
    const outputPath = path.join(__dirname, filename);

    fs.writeFileSync(outputPath, csvContent, 'utf-8');

    console.log(`✅ CSV exported successfully!`);
    console.log(`📁 File: ${outputPath}`);
    console.log(`📝 Total rows: ${voters.length}`);
  } catch (error) {
    console.error('🔥 Error exporting data:', error.message);
  }
}

exportToCsv().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
