// Kirim ulang email token untuk user yang sebelumnya mismatch
// Sumber data HANYA dari previous_mismatch_users_full_from_db.csv
require('dotenv').config();

const fs = require('fs');
const readline = require('readline');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const TOKEN_FILE = './token3.json';
const SOURCE_CSV = './previous_mismatch_users_full_from_db.csv';
const EMAIL_TEMPLATE_FILE = './email-template.html';
const START_NIM = ''; // isi NIM untuk resume, '' untuk dari awal
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 2000;

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

function deriveEmail(nim, rowEmail) {
  const email = String(rowEmail || '').trim();
  if (email) return email;
  return `${nim}@mahasiswa.itb.ac.id`;
}

async function getMailerAuth() {
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
  if (!fs.existsSync(SOURCE_CSV)) throw new Error(`File ${SOURCE_CSV} tidak ditemukan`);
  if (!fs.existsSync(EMAIL_TEMPLATE_FILE)) throw new Error(`File ${EMAIL_TEMPLATE_FILE} tidak ditemukan`);

  const rows = parseCsv(fs.readFileSync(SOURCE_CSV, 'utf8'));
  const header = rows[0] || [];

  const nimIdx = getColumnIndex(header, 'nim');
  const nameIdx = getColumnIndex(header, 'name');
  const tokenIdx = getColumnIndex(header, 'token');
  const emailIdx = getColumnIndex(header, 'email'); // optional

  if (nimIdx === -1 || nameIdx === -1 || tokenIdx === -1) {
    throw new Error('Kolom wajib nim/name/token tidak ditemukan di source CSV');
  }

  const allTargets = rows
    .slice(1)
    .map((row) => {
      const nim = String(row[nimIdx] || '').trim();
      const name = String(row[nameIdx] || '').trim();
      const token = String(row[tokenIdx] || '').trim();
      const email = deriveEmail(nim, emailIdx === -1 ? '' : row[emailIdx]);
      return { nim, name, token, email };
    })
    .filter((item) => item.nim);

  let startIndex = 0;
  if (START_NIM) {
    const idx = allTargets.findIndex((x) => x.nim === START_NIM);
    if (idx >= 0) {
      startIndex = idx;
      console.log(`🔁 Resume dari NIM ${START_NIM} (index ${startIndex})`);
    }
  }

  const targets = allTargets.slice(startIndex);
  const emailTemplate = fs.readFileSync(EMAIL_TEMPLATE_FILE, 'utf8');

  const auth = await getMailerAuth();
  console.log(`📧 Mengirim sebagai: ${auth.senderEmail}`);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: auth.senderEmail,
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      refreshToken: auth.refreshToken,
      accessToken: auth.accessToken,
    },
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
  });

  await transporter.verify();
  console.log(`✅ SMTP siap. Memulai resend untuk ${targets.length} user...`);

  const stats = {
    target: targets.length,
    sent: 0,
    failed: 0,
    missingToken: 0,
  };

  const failLogs = [];
  const chunks = chunkArray(targets, BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < chunks.length; batchIdx++) {
    const batch = chunks[batchIdx];

    await Promise.all(
      batch.map(async (target) => {
        if (!target.token) {
          stats.missingToken++;
          console.log(`⚠️ Skip ${target.nim}: token kosong`);
          return;
        }

        const html = emailTemplate
          .replace('{{NAMA_PENERIMA}}', target.name || target.nim)
          .replace('{{TOKEN}}', target.token);

        try {
          await transporter.sendMail({
            from: `"Panitia Pemira HME ITB" <${auth.senderEmail}>`,
            to: target.email,
            subject: '[PENTING] Token Voting Pemira HME ITB 2026',
            html,
          });

          stats.sent++;
          console.log(`✅ Sent: ${target.nim} -> ${target.email}`);
        } catch (error) {
          stats.failed++;
          failLogs.push({ nim: target.nim, email: target.email, error: error.message });
          console.log(`❌ Failed: ${target.nim} -> ${target.email} | ${error.message}`);
        }
      })
    );

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
  console.log(`📊 Total target             : ${stats.target}`);
  console.log(`✅ Berhasil kirim           : ${stats.sent}`);
  console.log(`❌ Gagal kirim              : ${stats.failed}`);
  console.log(`⚠️ Token kosong (skip)      : ${stats.missingToken}`);
  console.log('='.repeat(66));
}

runResend().catch((error) => {
  console.error('🔥 Error Fatal:', error.message);
  process.exitCode = 1;
});
