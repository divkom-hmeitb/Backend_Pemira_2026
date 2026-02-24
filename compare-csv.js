// Program untuk mencocokkan data voters.csv dengan voters_export.csv
// dan menghasilkan CSV berisi data yang mismatch (ada di voters.csv tapi tidak ada di voters_export.csv)
const fs = require('fs');
const path = require('path');

function parseCsv(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles fields without internal commas/quotes)
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

// Normalisasi string untuk perbandingan (lowercase, trim extra spaces)
function normalize(str) {
  return (str || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ====== Main ======
const votersCsvPath = path.join(__dirname, 'voters.csv');
const exportCsvPath = path.join(__dirname, 'voters_export.csv');

const votersContent = fs.readFileSync(votersCsvPath, 'utf-8');
const exportContent = fs.readFileSync(exportCsvPath, 'utf-8');

const votersData = parseCsv(votersContent);
const exportData = parseCsv(exportContent);

console.log(`📊 voters.csv       : ${votersData.rows.length} rows`);
console.log(`📊 voters_export.csv: ${exportData.rows.length} rows\n`);

// Buat set dari voters_export.csv berdasarkan nim dan name (normalized)
const exportSetByNim = new Set();
const exportSetByNimName = new Set();

exportData.rows.forEach((row) => {
  const nim = normalize(row.nim);
  const name = normalize(row.name);
  exportSetByNim.add(nim);
  exportSetByNimName.add(`${nim}|${name}`);
});

// Cari data di voters.csv yang TIDAK ada di voters_export.csv
const missingByNim = []; // NIM tidak ditemukan di export
const mismatchName = []; // NIM ada tapi nama berbeda

votersData.rows.forEach((voter) => {
  const nim = normalize(voter.nim);
  const name = normalize(voter.name);

  if (!exportSetByNim.has(nim)) {
    // NIM tidak ada di database
    missingByNim.push(voter);
  } else if (!exportSetByNimName.has(`${nim}|${name}`)) {
    // NIM ada tapi nama tidak cocok
    const exportRow = exportData.rows.find((r) => normalize(r.nim) === nim);
    mismatchName.push({
      ...voter,
      exportName: exportRow ? exportRow.name : '',
    });
  }
});

// Juga cari data di export yang TIDAK ada di voters.csv
const votersSetByNim = new Set();
votersData.rows.forEach((row) => {
  votersSetByNim.add(normalize(row.nim));
});

const extraInExport = [];
exportData.rows.forEach((row) => {
  if (!votersSetByNim.has(normalize(row.nim))) {
    extraInExport.push(row);
  }
});

console.log('='.repeat(80));
console.log(`❌ NIM ada di voters.csv tapi TIDAK ada di database : ${missingByNim.length}`);
console.log(`⚠️  NIM sama tapi NAMA berbeda                      : ${mismatchName.length}`);
console.log(`➕ Ada di database tapi TIDAK ada di voters.csv      : ${extraInExport.length}`);
console.log('='.repeat(80));

// --- Output: Missing by NIM ---
if (missingByNim.length > 0) {
  console.log('\n--- NIM tidak ditemukan di database ---');
  missingByNim.forEach((v) => console.log(`  NIM: ${v.nim} | Name: ${v.name}`));

  const csvLines = ['name,nim'];
  missingByNim.forEach((v) => csvLines.push(`${v.name},${v.nim}`));
  const outPath = path.join(__dirname, 'mismatch_missing_nim.csv');
  fs.writeFileSync(outPath, csvLines.join('\n'), 'utf-8');
  console.log(`\n📁 Saved to: ${outPath}`);
}

// --- Output: Name mismatch ---
if (mismatchName.length > 0) {
  console.log('\n--- NIM sama tapi nama berbeda ---');
  mismatchName.forEach((v) =>
    console.log(`  NIM: ${v.nim} | voters.csv: "${v.name}" | database: "${v.exportName}"`)
  );

  const csvLines = ['nim,name_voters_csv,name_database'];
  mismatchName.forEach((v) => csvLines.push(`${v.nim},"${v.name}","${v.exportName}"`));
  const outPath = path.join(__dirname, 'mismatch_name_diff.csv');
  fs.writeFileSync(outPath, csvLines.join('\n'), 'utf-8');
  console.log(`\n📁 Saved to: ${outPath}`);
}

// --- Output: Extra in export ---
if (extraInExport.length > 0) {
  console.log('\n--- Ada di database tapi tidak ada di voters.csv ---');
  extraInExport.forEach((v) => console.log(`  NIM: ${v.nim} | Name: ${v.name}`));

  const csvLines = ['nim,name'];
  extraInExport.forEach((v) => csvLines.push(`${v.nim},"${v.name}"`));
  const outPath = path.join(__dirname, 'mismatch_extra_in_db.csv');
  fs.writeFileSync(outPath, csvLines.join('\n'), 'utf-8');
  console.log(`\n📁 Saved to: ${outPath}`);
}

// --- Output: Gabungan semua mismatch ---
const allMismatch = [
  ...missingByNim.map((v) => ({ nim: v.nim, name: v.name, type: 'NIM tidak ada di database' })),
  ...mismatchName.map((v) => ({
    nim: v.nim,
    name: v.name,
    type: `Nama berbeda (db: ${v.exportName})`,
  })),
  ...extraInExport.map((v) => ({
    nim: v.nim,
    name: v.name,
    type: 'NIM tidak ada di voters.csv (extra di database)',
  })),
];

if (allMismatch.length > 0) {
  const csvLines = ['nim,name,mismatch_type'];
  allMismatch.forEach((v) => csvLines.push(`${v.nim},"${v.name}","${v.type}"`));
  const outPath = path.join(__dirname, 'mismatch_all.csv');
  fs.writeFileSync(outPath, csvLines.join('\n'), 'utf-8');
  console.log(`\n📁 All mismatches saved to: ${outPath}`);
}

if (allMismatch.length === 0) {
  console.log('\n✅ Semua data cocok! Tidak ada mismatch.');
}

console.log('\n✅ Done.');
