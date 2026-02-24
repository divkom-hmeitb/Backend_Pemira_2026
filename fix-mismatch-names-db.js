// Benahi nama voter di DB berdasarkan voters.csv untuk NIM yang ada di mismatch_name_diff.csv
// NIM dipertahankan, hanya kolom name yang di-update
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

  return rows.filter((r) => r.some((cell) => (cell || '').trim().length > 0));
}

function getColumnIndex(header, columnName) {
  return header.findIndex((h) => (h || '').trim().toLowerCase() === columnName.toLowerCase());
}

function normalizeNim(value) {
  return String(value || '').trim();
}

function normalizeName(value) {
  return String(value || '').trim();
}

async function main() {
  const mismatchPath = path.join(__dirname, 'mismatch_name_diff.csv');
  const votersPath = path.join(__dirname, 'voters.csv');

  if (!fs.existsSync(mismatchPath)) {
    throw new Error('File mismatch_name_diff.csv tidak ditemukan.');
  }

  if (!fs.existsSync(votersPath)) {
    throw new Error('File voters.csv tidak ditemukan.');
  }

  const mismatchRows = parseCsv(fs.readFileSync(mismatchPath, 'utf-8'));
  const votersRows = parseCsv(fs.readFileSync(votersPath, 'utf-8'));

  const mismatchHeader = mismatchRows[0] || [];
  const votersHeader = votersRows[0] || [];

  const mismatchNimIdx = getColumnIndex(mismatchHeader, 'nim');
  const votersNimIdx = getColumnIndex(votersHeader, 'nim');
  const votersNameIdx = getColumnIndex(votersHeader, 'name');

  if (mismatchNimIdx === -1) {
    throw new Error('Kolom nim tidak ditemukan pada mismatch_name_diff.csv');
  }

  if (votersNimIdx === -1 || votersNameIdx === -1) {
    throw new Error('Kolom nim/name tidak ditemukan pada voters.csv');
  }

  const mismatchNims = new Set(
    mismatchRows
      .slice(1)
      .map((row) => normalizeNim(row[mismatchNimIdx]))
      .filter(Boolean)
  );

  const correctNameByNim = new Map();
  votersRows.slice(1).forEach((row) => {
    const nim = normalizeNim(row[votersNimIdx]);
    const name = normalizeName(row[votersNameIdx]);
    if (nim) {
      correctNameByNim.set(nim, name);
    }
  });

  let updated = 0;
  let alreadyCorrect = 0;
  let missingInVoters = 0;
  let missingInDb = 0;
  let failed = 0;

  for (const nim of mismatchNims) {
    const correctName = correctNameByNim.get(nim);

    if (!correctName) {
      console.log(`⚠️  NIM ${nim} tidak ada di voters.csv, skip.`);
      missingInVoters++;
      continue;
    }

    try {
      const existing = await prisma.voter.findUnique({ where: { nim } });

      if (!existing) {
        console.log(`⚠️  NIM ${nim} tidak ditemukan di DB, skip.`);
        missingInDb++;
        continue;
      }

      if (normalizeName(existing.name) === normalizeName(correctName)) {
        alreadyCorrect++;
        continue;
      }

      await prisma.voter.update({
        where: { nim },
        data: { name: correctName },
      });

      updated++;
      console.log(`✅ Updated NIM ${nim}: "${existing.name}" -> "${correctName}"`);
    } catch (error) {
      failed++;
      console.log(`❌ Gagal update NIM ${nim}: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(64));
  console.log(`📊 Total NIM mismatch target : ${mismatchNims.size}`);
  console.log(`✅ Berhasil di-update        : ${updated}`);
  console.log(`ℹ️  Sudah benar (skip)       : ${alreadyCorrect}`);
  console.log(`⚠️  Tidak ada di voters.csv  : ${missingInVoters}`);
  console.log(`⚠️  Tidak ada di DB          : ${missingInDb}`);
  console.log(`❌ Gagal update              : ${failed}`);
  console.log('='.repeat(64));
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
