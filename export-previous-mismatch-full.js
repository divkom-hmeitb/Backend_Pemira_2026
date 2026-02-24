// Ambil semua kolom dari DB untuk user yang sebelumnya mismatch
// Sumber NIM: mismatch_name_diff.csv
require('dotenv').config();
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || 'library';

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function parseCsv(content) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell || '').trim().length > 0));
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const val = cell === null || cell === undefined ? '' : String(cell);
          if (/[",\n\r]/.test(val)) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        })
        .join(',')
    )
    .join('\n');
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const mismatchPath = path.join(__dirname, 'mismatch_name_diff.csv');

  if (!fs.existsSync(mismatchPath)) {
    throw new Error('File mismatch_name_diff.csv tidak ditemukan.');
  }

  const mismatchRows = parseCsv(fs.readFileSync(mismatchPath, 'utf-8'));
  const header = mismatchRows[0] || [];
  const nimIndex = header.findIndex((h) => String(h).trim().toLowerCase() === 'nim');

  if (nimIndex === -1) {
    throw new Error('Kolom nim tidak ditemukan pada mismatch_name_diff.csv');
  }

  const nims = [...new Set(
    mismatchRows
      .slice(1)
      .map((row) => String(row[nimIndex] || '').trim())
      .filter(Boolean)
  )];

  console.log(`📊 Total NIM sebelumnya mismatch: ${nims.length}`);

  const allRows = [];
  const chunks = chunkArray(nims, 200);

  for (const chunk of chunks) {
    const data = await prisma.voter.findMany({
      where: { nim: { in: chunk } },
      orderBy: { nim: 'asc' },
    });
    allRows.push(...data);
  }

  const foundSet = new Set(allRows.map((row) => row.nim));
  const notFound = nims.filter((nim) => !foundSet.has(nim));

  const columns = [
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

  const csvRows = [
    columns,
    ...allRows.map((row) =>
      columns.map((col) => {
        const value = row[col];
        if (value instanceof Date) return value.toISOString();
        return value;
      })
    ),
  ];

  const outputPath = path.join(__dirname, 'previous_mismatch_users_full_from_db.csv');
  fs.writeFileSync(outputPath, toCsv(csvRows) + '\n', 'utf-8');

  console.log(`✅ Data ditemukan di DB: ${allRows.length}`);
  console.log(`❌ NIM tidak ditemukan : ${notFound.length}`);
  console.log(`📁 Output             : ${outputPath}`);

  if (notFound.length > 0) {
    const notFoundPath = path.join(__dirname, 'previous_mismatch_users_not_found.csv');
    fs.writeFileSync(notFoundPath, ['nim', ...notFound].join('\n') + '\n', 'utf-8');
    console.log(`📁 Daftar not found   : ${notFoundPath}`);
  }
}

main()
  .catch((error) => {
    console.error('🔥 Error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
