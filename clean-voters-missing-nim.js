// Hapus data di voters.csv yang NIM-nya ada di mismatch_missing_nim.csv
const fs = require('fs');
const path = require('path');

function parseCsv(content) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      if (current.length > 0 || row.length > 0) {
        row.push(current);
        rows.push(row);
      }
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((field) => {
          const value = field ?? '';
          if (/[",\n\r]/.test(value)) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(',')
    )
    .join('\n');
}

function normalizeNim(nim) {
  return String(nim || '').trim();
}

function main() {
  const votersPath = path.join(__dirname, 'voters.csv');
  const missingPath = path.join(__dirname, 'mismatch_missing_nim.csv');

  const votersRows = parseCsv(fs.readFileSync(votersPath, 'utf-8'));
  const missingRows = parseCsv(fs.readFileSync(missingPath, 'utf-8'));

  const votersHeader = votersRows[0] || [];
  const missingHeader = missingRows[0] || [];

  const votersNimIndex = votersHeader.findIndex((h) => h.trim().toLowerCase() === 'nim');
  const missingNimIndex = missingHeader.findIndex((h) => h.trim().toLowerCase() === 'nim');

  if (votersNimIndex === -1 || missingNimIndex === -1) {
    throw new Error('Kolom NIM tidak ditemukan di salah satu file CSV.');
  }

  const missingSet = new Set(
    missingRows.slice(1).map((row) => normalizeNim(row[missingNimIndex])).filter(Boolean)
  );

  const originalData = votersRows.slice(1);
  const filteredData = originalData.filter((row) => !missingSet.has(normalizeNim(row[votersNimIndex])));

  const removedCount = originalData.length - filteredData.length;
  const outputRows = [votersHeader, ...filteredData];

  fs.writeFileSync(votersPath, toCsv(outputRows) + '\n', 'utf-8');

  console.log(`✅ Total data awal voters.csv : ${originalData.length}`);
  console.log(`🗑️  Data terhapus             : ${removedCount}`);
  console.log(`📄 Total data akhir voters.csv: ${filteredData.length}`);
}

main();
