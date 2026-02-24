// Ambil seluruh data (semua kolom) dari voters_export.csv
// berdasarkan NIM yang terdeteksi mismatch di mismatch_name_diff.csv
const fs = require('fs');
const path = require('path');

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

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const val = cell ?? '';
          if (/[",\n\r]/.test(val)) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        })
        .join(',')
    )
    .join('\n');
}

function getColumnIndex(header, columnName) {
  return header.findIndex((h) => (h || '').trim().toLowerCase() === columnName.toLowerCase());
}

function readFirstExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function main() {
  const mismatchPath = path.join(__dirname, 'mismatch_name_diff.csv');
  const exportPath = readFirstExisting([
    path.join(__dirname, 'voters_exports.csv'),
    path.join(__dirname, 'voters_export.csv'),
  ]);

  if (!fs.existsSync(mismatchPath)) {
    throw new Error('File mismatch_name_diff.csv tidak ditemukan.');
  }

  if (!exportPath) {
    throw new Error('File voters_exports.csv / voters_export.csv tidak ditemukan.');
  }

  const mismatchRows = parseCsv(fs.readFileSync(mismatchPath, 'utf-8'));
  const exportRows = parseCsv(fs.readFileSync(exportPath, 'utf-8'));

  const mismatchHeader = mismatchRows[0] || [];
  const exportHeader = exportRows[0] || [];

  const mismatchNimIdx = getColumnIndex(mismatchHeader, 'nim');
  const exportNimIdx = getColumnIndex(exportHeader, 'nim');

  if (mismatchNimIdx === -1) {
    throw new Error('Kolom nim tidak ditemukan pada mismatch_name_diff.csv');
  }

  if (exportNimIdx === -1) {
    throw new Error('Kolom nim tidak ditemukan pada file export');
  }

  const mismatchNims = new Set(
    mismatchRows
      .slice(1)
      .map((row) => (row[mismatchNimIdx] || '').trim())
      .filter(Boolean)
  );

  const matchedRows = exportRows
    .slice(1)
    .filter((row) => mismatchNims.has((row[exportNimIdx] || '').trim()));

  const foundNims = new Set(matchedRows.map((row) => (row[exportNimIdx] || '').trim()));
  const notFoundNims = [...mismatchNims].filter((nim) => !foundNims.has(nim));

  const outputRows = [exportHeader, ...matchedRows];
  const outputPath = path.join(__dirname, 'wrong_nim_rows_from_export.csv');
  fs.writeFileSync(outputPath, toCsv(outputRows) + '\n', 'utf-8');

  console.log(`📥 Source export file: ${path.basename(exportPath)}`);
  console.log(`📊 NIM mismatch terdeteksi : ${mismatchNims.size}`);
  console.log(`✅ Baris ditemukan         : ${matchedRows.length}`);
  console.log(`❌ NIM tidak ditemukan     : ${notFoundNims.length}`);
  console.log(`📁 Output                 : ${outputPath}`);

  if (notFoundNims.length > 0) {
    const missingPath = path.join(__dirname, 'wrong_nim_not_found_in_export.csv');
    fs.writeFileSync(missingPath, ['nim', ...notFoundNims].join('\n') + '\n', 'utf-8');
    console.log(`📁 NIM tidak ditemukan disimpan di: ${missingPath}`);
  }
}

main();
