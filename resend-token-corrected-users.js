// Kirim ulang email info token untuk user yang sebelumnya mismatch nama
// Target NIM diambil dari mismatch_name_diff.csv
require('dotenv').config();
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || 'library';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const TOKEN_FILE = './token3.json';
const START_NIM = ''; // isi NIM untuk resume, atau '' untuk dari awal
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 2000;

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

function getColumnIndex(header, columnName) {
  return header.findIndex((h) => String(h || '').trim().toLowerCase() === columnName.toLowerCase());
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function getOAuthClientAndSender() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error(`File ${TOKEN_FILE} tidak ditemukan`);

  let tokenFile = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const { client_id, client_secret, redirect_uris } = tokenFile.web || tokenFile.installed;

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (!tokenFile.refresh_token) {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://mail.google.com/', 'https://www.googleapis.com/auth/userinfo.email'],
      prompt: 'consent',
    });

    console.log('\n⚠️ Refresh token belum ada. Buka URL berikut:');
    console.log(authUrl);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await new Promise((resolve) => rl.question('\nMasukkan code: ', resolve));
    rl.close();

    const { tokens } = await oauth2Client.getToken(code);
    tokenFile = { ...tokenFile, ...tokens };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenFile, null, 2));
    console.log('✅ Token baru disimpan ke token3.json');
  }

  oauth2Client.setCredentials({
    refresh_token: tokenFile.refresh_token,
    access_token: tokenFile.access_token,
    expiry_date: tokenFile.expiry_date,
  });

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data: userInfo } = await oauth2.userinfo.get();

  return {
    senderEmail: userInfo.email,
    clientId: client_id,
    clientSecret: client_secret,
    refreshToken: tokenFile.refresh_token,
    accessToken: tokenFile.access_token,
  };
}

async function runResend() {
  if (!fs.existsSync('./mismatch_name_diff.csv')) {
    throw new Error('File mismatch_name_diff.csv tidak ditemukan');
  }
  if (!fs.existsSync('./Target.json')) {
    throw new Error('File Target.json tidak ditemukan');
  }
  if (!fs.existsSync('./email-template.html')) {
    throw new Error('File email-template.html tidak ditemukan');
  }

  const mismatchRows = parseCsv(fs.readFileSync('./mismatch_name_diff.csv', 'utf8'));
  const mismatchHeader = mismatchRows[0] || [];
  const mismatchNimIndex = getColumnIndex(mismatchHeader, 'nim');
  if (mismatchNimIndex === -1) throw new Error('Kolom nim tidak ditemukan di mismatch_name_diff.csv');

  const mismatchNims = [
    ...new Set(
      mismatchRows
        .slice(1)
        .map((row) => String(row[mismatchNimIndex] || '').trim())
        .filter(Boolean)
    ),
  ];

  const rawTarget = fs.readFileSync('./Target.json', 'utf8');
  const targetList = JSON.parse(rawTarget);
  const targetByNim = new Map(targetList.map((student) => [String(student.nim).trim(), student]));

  const dbVoters = await prisma.voter.findMany({
    where: { nim: { in: mismatchNims } },
    select: { nim: true, name: true, token: true },
  });
  const dbByNim = new Map(dbVoters.map((v) => [v.nim, v]));

  const emailTemplate = fs.readFileSync('./email-template.html', 'utf8');

  let startIndex = 0;
  if (START_NIM) {
    const idx = mismatchNims.findIndex((nim) => nim === START_NIM);
    if (idx >= 0) {
      startIndex = idx;
      console.log(`🔁 Resume dari NIM ${START_NIM} (index ${startIndex})`);
    }
  }

  const targetNims = mismatchNims.slice(startIndex);

  const oauth = await getOAuthClientAndSender();
  console.log(`📧 Mengirim sebagai: ${oauth.senderEmail}`);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: oauth.senderEmail,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      refreshToken: oauth.refreshToken,
      accessToken: oauth.accessToken,
    },
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
  });

  await transporter.verify();
  console.log('✅ SMTP siap. Memulai resend...');

  const stats = {
    target: targetNims.length,
    sent: 0,
    failed: 0,
    missingTargetEmail: 0,
    missingDbToken: 0,
  };

  const failLogs = [];

  const chunks = chunkArray(targetNims, BATCH_SIZE);
  for (let batchIdx = 0; batchIdx < chunks.length; batchIdx++) {
    const batch = chunks[batchIdx];

    const tasks = batch.map(async (nim) => {
      const target = targetByNim.get(nim);
      const dbVoter = dbByNim.get(nim);

      if (!target || !target.email) {
        stats.missingTargetEmail++;
        console.log(`⚠️ Skip ${nim}: email tidak ditemukan di Target.json`);
        return;
      }

      if (!dbVoter || !dbVoter.token) {
        stats.missingDbToken++;
        console.log(`⚠️ Skip ${nim}: token tidak ditemukan di DB`);
        return;
      }

      const recipientName = dbVoter.name || target.name || nim;
      const html = emailTemplate
        .replace('{{NAMA_PENERIMA}}', recipientName)
        .replace('{{TOKEN}}', dbVoter.token);

      try {
        await transporter.sendMail({
          from: `"Panitia Pemira HME ITB" <${oauth.senderEmail}>`,
          to: target.email,
          subject: '[PENTING] Token Voting Pemira HME ITB 2026',
          html,
        });

        stats.sent++;
        console.log(`✅ Sent: ${nim} -> ${target.email}`);
      } catch (error) {
        stats.failed++;
        failLogs.push({ nim, email: target.email, error: error.message });
        console.log(`❌ Failed: ${nim} -> ${target.email} | ${error.message}`);
      }
    });

    await Promise.all(tasks);
    console.log(`⏳ Batch ${batchIdx + 1}/${chunks.length} selesai`);

    if (batchIdx < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  transporter.close();

  if (failLogs.length > 0) {
    const failCsv = ['nim,email,error', ...failLogs.map((f) => `"${f.nim}","${f.email}","${String(f.error).replace(/"/g, '""')}"`)];
    fs.writeFileSync('./resend_mismatch_failed.csv', failCsv.join('\n') + '\n', 'utf8');
    console.log('📁 Daftar gagal disimpan: resend_mismatch_failed.csv');
  }

  console.log('\n' + '='.repeat(66));
  console.log(`📊 Total target                : ${stats.target}`);
  console.log(`✅ Berhasil kirim              : ${stats.sent}`);
  console.log(`❌ Gagal kirim                 : ${stats.failed}`);
  console.log(`⚠️ Email tidak ditemukan       : ${stats.missingTargetEmail}`);
  console.log(`⚠️ Token DB tidak ditemukan    : ${stats.missingDbToken}`);
  console.log('='.repeat(66));
}

runResend()
  .catch((error) => {
    console.error('🔥 Error Fatal:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
