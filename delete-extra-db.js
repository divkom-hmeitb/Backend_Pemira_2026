// Program untuk menghapus data dari database yang ada di mismatch_extra_in_db.csv
// (data yang ada di database tapi TIDAK ada di voters.csv)
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

function parseCsv(content) {
  const lines = content.trim().split('\n');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Extract NIM (first field before comma)
    const match = line.match(/^(\d+)/);
    if (match) rows.push(match[1]);
  }
  return rows;
}

async function deleteExtraFromDb() {
  const csvPath = path.join(__dirname, 'mismatch_extra_in_db.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const nims = parseCsv(content);

  console.log(`📊 Found ${nims.length} NIM(s) to delete from database.\n`);

  let deleted = 0;
  let notFound = 0;
  const errors = [];

  for (const nim of nims) {
    try {
      const voter = await prisma.voter.findUnique({ where: { nim } });
      if (!voter) {
        console.log(`  ⚠️  NIM ${nim} not found in database, skipping.`);
        notFound++;
        continue;
      }
      await prisma.voter.delete({ where: { nim } });
      console.log(`  ✅ Deleted NIM ${nim} - ${voter.name}`);
      deleted++;
    } catch (err) {
      console.log(`  ❌ Error deleting NIM ${nim}: ${err.message}`);
      errors.push({ nim, error: err.message });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Deleted  : ${deleted}`);
  console.log(`⚠️  Not found: ${notFound}`);
  console.log(`❌ Errors   : ${errors.length}`);
  console.log('='.repeat(60));
}

deleteExtraFromDb().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
