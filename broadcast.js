// broadcast.js
require('dotenv').config(); // Untuk DATABASE_URL
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || 'library';
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// =============================================
// KONFIGURASI
// =============================================
const TOKEN_FILE = './token3.json';
const START_NIM = ""; // Kosongkan "" untuk mulai dari awal

async function runBroadcast() {
  console.log("🚀 Mencoba menghubungkan ke database...");
  
  try {
    // 1. Validasi file JSON
    if (!fs.existsSync('./Target.json')) {
      throw new Error("File Target.json tidak ditemukan!");
    }
    const rawData = fs.readFileSync('./Target.json');
    const dptList = JSON.parse(rawData);

    // --- PARAMETER RESUME ---
    let startIndex = 0;
    if (START_NIM) {
      const foundIndex = dptList.findIndex(student => student.nim === START_NIM);
      if (foundIndex !== -1) {
        startIndex = foundIndex;
        console.log(`🔍 Ditemukan NIM ${START_NIM} pada index ${startIndex}. Memulai dari sini...`);
      } else {
        console.warn(`⚠️ NIM ${START_NIM} tidak ditemukan di Target.json! Memulai dari awal (index 0).`);
      }
    }

    const targetDptList = dptList.slice(startIndex);

    // Load email template
    if (!fs.existsSync('./email-template.html')) {
      throw new Error("File email-template.html tidak ditemukan!");
    }
    const emailTemplate = fs.readFileSync('./email-template.html', 'utf8');

    console.log(`📡 Memulai broadcast untuk ${dptList.length} mahasiswa HME...`);

    // =============================================
    // OAUTH2: Semua dari token3.json, tanpa .env
    // =============================================
    if (!fs.existsSync(TOKEN_FILE)) {
      throw new Error(`File ${TOKEN_FILE} tidak ditemukan!`);
    }
    let tokenFile = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    const { client_id, client_secret, redirect_uris } = tokenFile.web || tokenFile.installed;

    const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Jika belum ada refresh_token, minta otorisasi interaktif
    if (!tokenFile.refresh_token) {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://mail.google.com/', 'https://www.googleapis.com/auth/userinfo.email'],
        prompt: 'consent'
      });

      console.log('\n⚠️  Refresh token belum ditemukan di token3.json.');
      console.log('🔗 Buka URL ini di browser:\n');
      console.log(authUrl);
      console.log('\nSetelah login, copy "code" dari URL redirect (mulai dari "4/...").\n');

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const code = await new Promise(resolve => rl.question('Masukkan kode di sini: ', resolve));
      rl.close();

      const { tokens } = await oauth2Client.getToken(code);
      // Simpan token ke token3.json tanpa menghapus kredensial web
      tokenFile = { ...tokenFile, ...tokens };
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenFile, null, 2));
      console.log('✅ Token berhasil disimpan di token3.json!\n');
    }

    oauth2Client.setCredentials({
      refresh_token: tokenFile.refresh_token,
      access_token: tokenFile.access_token,
      expiry_date: tokenFile.expiry_date
    });

    // Dapatkan email pengirim dari akun Google yang terotorisasi
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const senderEmail = userInfo.email;
    console.log(`📧 Mengirim sebagai: ${senderEmail}`);

    // Konfigurasi SMTP — nodemailer otomatis refresh access token
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: senderEmail,
        clientId: client_id,
        clientSecret: client_secret,
        refreshToken: tokenFile.refresh_token,
        accessToken: tokenFile.access_token
      },
      pool: true,
      maxConnections: 1,
      maxMessages: 100,
    });

    // Verifikasi koneksi SMTP
    await transporter.verify();
    console.log("✅ Koneksi SMTP Gmail (OAuth2) berhasil diverifikasi!");

    console.log("📥 Menarik data token dari database...");
    const existingVoters = await prisma.voter.findMany({
      select: { nim: true, token: true }
    });
    const tokenMap = new Map(existingVoters.map(v => [v.nim, v.token]));
    console.log(`✅ Berhasil menarik ${existingVoters.length} data dari database.`);

    const generateToken = (length = 6) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let token = '';
      for (let i = 0; i < length; i += 1) {
        token += chars[Math.floor(Math.random() * chars.length)];
      }
      return token;
    };

    // Process in concurrent batches of 10
    const BATCH_SIZE = 10;
    const results = [];
    
    console.log(`🚀 Melanjutkan pengiriman dari index ${startIndex} (Total target: ${targetDptList.length} mahasiswa)`);

    for (let i = 0; i < targetDptList.length; i += BATCH_SIZE) {
      const batch = targetDptList.slice(i, i + BATCH_SIZE);
      
      const batchOperations = batch.map(async (student, indexInBatch) => {
        const currentIndex = startIndex + i + indexInBatch;
        
        // Ambil token dari database jika ada, jika tidak buat baru
        let token = tokenMap.get(student.nim);
        let isNewToken = false;

        if (!token) {
          token = generateToken();
          isNewToken = true;
        }

        try {
          // Replace placeholders in template
          const personalizedEmail = emailTemplate
            .replace('{{NAMA_PENERIMA}}', student.name)
            .replace('{{TOKEN}}', token);

          // 1. Kirim Email terlebih dahulu
          await transporter.sendMail({
            from: `"Panitia Pemira HME ITB" <${senderEmail}>`,
            to: student.email,
            subject: '[PENTING] Token Voting Pemira HME ITB 2026',
            html: personalizedEmail,
          });

          // 2. Jika email sukses dan token baru (belum ada di DB), simpan ke Database
          if (isNewToken) {
            await prisma.voter.upsert({
              where: { nim: student.nim },
              update: { token: token },
              create: {
                nim: student.nim,
                name: student.name,
                token: token,
                isVoteCakahim: false,
                isVoteCasenat: false,
              },
            });
          }

          console.log(`✅ Sukses [Index: ${currentIndex}]: ${student.nim}`);
          return { nim: student.nim, status: 'success' };
        } catch (err) {
          console.error(`❌ Gagal [Index: ${currentIndex}] di NIM ${student.nim}:`, err.message);
          return { nim: student.nim, status: 'failed', error: err.message };
        }
      });

      // Execute batch concurrently
      const batchResults = await Promise.allSettled(batchOperations);
      results.push(...batchResults.map(r => r.value || { status: 'error' }));
      
      console.log(`\n⏳ Batch ${Math.floor(i / BATCH_SIZE) + 1} selesai...`);
      
      // Jeda 2 detik antar batch agar tidak dianggap spam oleh Gmail
      if (i + BATCH_SIZE < targetDptList.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    transporter.close(); // Close connection pool
    
    const successful = results.filter(r => r?.status === 'success').length;
    const failed = results.filter(r => r?.status === 'failed').length;
    
    console.log(`\n📊 Hasil Broadcast:`);
    console.log(`✅ Berhasil: ${successful}`);
    console.log(`❌ Gagal: ${failed}`);
    console.log("✨ Selesai!");
  } catch (error) {
    console.error('🔥 Error Fatal:', error.message);
  }
}

runBroadcast()
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });