// broadcast.js
require('dotenv').config(); // Wajib di baris paling atas
process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || 'library';
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runBroadcast() {
  console.log("🚀 Mencoba menghubungkan ke database CockroachDB...");
  
  try {
    // 1. Validasi file JSON
    if (!fs.existsSync('./Voters.json')) {
      throw new Error("File Voters.json tidak ditemukan!");
    }
    const rawData = fs.readFileSync('./Voters.json');
    const dptList = JSON.parse(rawData);

    // Load email template
    if (!fs.existsSync('./email-template.html')) {
      throw new Error("File email-template.html tidak ditemukan!");
    }
    const emailTemplate = fs.readFileSync('./email-template.html', 'utf8');

    console.log(`📡 Memulai broadcast untuk ${dptList.length} mahasiswa HME...`);

    // Konfigurasi SMTP (Gunakan App Password 16 digit kamu)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      pool: true,
      maxConnections: 5,
      pool: {
        maxConnections: 5,
        maxMessages: Infinity,
      },
    });



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
    
    for (let i = 0; i < dptList.length; i += BATCH_SIZE) {
      const batch = dptList.slice(i, i + BATCH_SIZE);
      
      const batchOperations = batch.map(async (student) => {
        const token = generateToken();

        try {
          // 2. Simpan ke Database
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

          // Replace placeholders in template
          const personalizedEmail = emailTemplate
            .replace('{{NAMA_PENERIMA}}', student.name)
            .replace('{{TOKEN}}', token);

          // 3. Kirim Email with Background Image
          await transporter.sendMail({
            from: `"Panitia Pemira HME ITB" <${process.env.EMAIL_USER}>`,
            to: student.email,
            subject: '[PENTING] Token Voting Pemira HME ITB 2026',
            html: personalizedEmail,

          });

          console.log(`✅ Sukses: ${student.nim}`);
          return { nim: student.nim, status: 'success' };
        } catch (err) {
          console.error(`❌ Gagal di NIM ${student.nim}:`, err.message);
          return { nim: student.nim, status: 'failed', error: err.message };
        }
      });

      // Execute batch concurrently
      const batchResults = await Promise.allSettled(batchOperations);
      results.push(...batchResults.map(r => r.value || { status: 'error' }));
      
      console.log(`\n⏳ Batch ${Math.floor(i / BATCH_SIZE) + 1} selesai...`);
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