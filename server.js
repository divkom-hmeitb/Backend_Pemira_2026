const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Log to file (disable on serverless)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const logFile = isServerless ? null : path.join(__dirname, 'server-debug.log');
function log(...args) {
  const msg = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`;
  if (logFile) {
    try {
      fs.appendFileSync(logFile, msg);
    } catch (err) {
      // Avoid crashing in read-only environments
      console.warn('[LOG_WRITE_FAILED]', err.message);
    }
  }
  console.log(...args);
}

log('=== SERVER STARTING ===');

require('dotenv').config({ path: path.join(__dirname, '.env') });
log('Environment loaded');

process.env.PRISMA_CLIENT_ENGINE_TYPE = process.env.PRISMA_CLIENT_ENGINE_TYPE || 'library';
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

log('Creating database pool...');
const app = express();
app.use(cors());
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
log('Database client created');

// Early error logging
app.use((err, req, res, next) => {
  log('[EARLY_ERROR]', err.message);
  log('[EARLY_ERROR_STACK]', err.stack);
  next();
});

log('Adding JSON parser...');
app.use(express.json());
log('JSON parser added');

// Global logging middleware
app.use((req, res, next) => {
  log(`[${req.method}] ${req.path}`);
  if (req.path.includes('login') || req.path.includes('vote') || req.path.includes('is_')) {
    log('[REQUEST_BODY]', JSON.stringify(req.body));
  }
  next();
});

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    return next();
  });
}

const API_TOKEN = process.env.API_TOKEN || process.env.NEXT_PUBLIC_API_TOKEN;
log('[STARTUP] API_TOKEN loaded:', API_TOKEN ? 'YES' : 'NO', API_TOKEN ? `(value: ${API_TOKEN})` : '');
log('[STARTUP] All environment variables:', Object.keys(process.env).filter(k => k.includes('TOKEN') || k.includes('API')));

// Root route handler
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Pemira API Backend is running',
    version: '1.0.0'
  });
});

const isApiTokenValid = (req) => {
  if (!API_TOKEN) return true;
  const isValid = req.body && req.body.token === API_TOKEN;
  if (!isValid) {
    log('[TOKEN_CHECK] Failed:', {
      received: req.body?.token,
      expected: API_TOKEN,
      hasBody: !!req.body
    });
  }
  return isValid;
};

const rejectInvalidApiToken = (req, res) => {
  if (!isApiTokenValid(req)) {
    log('[TOKEN_REJECT] Invalid token, sending 401');
    res.status(401).json({ message: "Invalid Token" });
    return true; // Caller must return after this
  }
  return false;
};

// HALAMAN 1 : LOGIN PAGE
// --- HALAMAN 1: LOGIN (Hanya NIM & Token) ---
app.post('/login', async (req, res) => {
  const { nim, token } = req.body;
  console.log('POST /login body:', req.body);

  try {
    // Mencari baris yang NIM dan Token yang cocok
    const voter = await prisma.voter.findFirst({
      where: {
        nim: nim,
        token: token
      }
    });

    if (!voter) {
      return res.status(401).json({ 
        error: "NIM atau Token salah! Silakan cek kembali email ITB Anda." 
      });
    }

    // Voter Berhasil Login
    res.json({ 
      message: "Verifikasi Berhasil", 
      name: voter.name 
    });
    
  } catch (err) {
    console.error('POST /login error:', err);
    res.status(500).json({ error: "Terjadi kesalahan pada sistem" });
  }
});

// HALAMAN 2: CAMERA PAGE 
app.post('/upload-photo', async (req, res) => {
  const { nim, cloudinaryUrl } = req.body;
  try {
    await prisma.voter.update({
      where: { nim },
      data: { cloudinaryUrl }
    });
    res.json({ message: "Foto berhasil diverifikasi" });
  } catch (err) { res.status(500).json({ error: "Gagal menyimpan foto" }); }
});

// HALAMAN 3 : VOTING PAGE
app.post('/submit-ballot', async (req, res) => {
  const { nim, type, choice } = req.body; // type bisa 'kahim' atau 'senator'

  try {
    const voter = await prisma.voter.findUnique({ where: { nim: nim } });

    // Validasi apakah sudah memilih kategori tersebut
    if (type === 'kahim' && voter.isVoteCakahim) {
      return res.status(403).json({ error: "Anda sudah memilih Ketua Himpunan!" });
    }
    if (type === 'senator' && voter.isVoteCasenat) {
      return res.status(403).json({ error: "Anda sudah memilih Senator!" });
    }

    // Update berdasarkan tipe pilihan
    const updateData = type === 'kahim' 
      ? { kahimChoice: choice, isVoteCakahim: true } 
      : { senatorChoice: choice, isVoteCasenat: true };

    await prisma.voter.update({
      where: { nim: nim },
      data: {
        ...updateData,
        votedDate: new Date().toLocaleDateString('id-ID'),
        votedTime: new Date().toLocaleTimeString('id-ID'),
      }
    });

    res.json({ message: `Berhasil submit suara ${type}!` });
  } catch (err) {
    res.status(500).json({ error: "Gagal menyimpan suara" });
  }
});

// LIVE COUNT: hasil suara per kandidat
app.get('/live-counts', async (req, res) => {
  try {
    const kahimGroups = await prisma.voter.groupBy({
      by: ['kahimChoice'],
      where: { kahimChoice: { not: null } },
      _count: { _all: true },
    });

    const senatorGroups = await prisma.voter.groupBy({
      by: ['senatorChoice'],
      where: { senatorChoice: { not: null } },
      _count: { _all: true },
    });

    const kahimCounts = kahimGroups.reduce((acc, row) => {
      acc[row.kahimChoice] = row._count._all;
      return acc;
    }, {});

    const senatorCounts = senatorGroups.reduce((acc, row) => {
      acc[row.senatorChoice] = row._count._all;
      return acc;
    }, {});

    res.json({
      kahimCounts,
      senatorCounts,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil live count' });
  }
});

// --- API ROUTES (Untuk Frontend Next.js) ---

// TEST ENDPOINT - Just echo back the request
app.post('/api/test', (req, res) => {
  log('[API_TEST] Request received');
  log('[API_TEST] Body:', req.body);
  res.json({ 
    received: req.body,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/login', async (req, res) => {
  log('[API_LOGIN] Received request');
  const { username, pass } = req.body;
  log('[API_LOGIN] Body:', req.body);
  log('[API_LOGIN] Has token in body:', !!req.body.token);

  if (rejectInvalidApiToken(req, res)) {
    log('[API_LOGIN] Token validation failed, returning 401');
    return;
  }

  if (!username || !pass) {
    log('[API_LOGIN] Missing username or pass');
    return res.status(400).json({ message: "Username dan password harus diisi." });
  }

  try {
    log('[API_LOGIN] Attempting to query database');
    log('Attempting to find voter with NIM:', username);
    const voter = await prisma.voter.findFirst({
      where: {
        nim: username,
        token: pass
      }
    });
    log('Voter found:', voter);

    if (!voter) {
      log('No voter found with given NIM/Token');
      return res.status(401).json({ message: "NIM atau Token salah" });
    }

    if (voter.isVoteCakahim && voter.isVoteCasenat) {
      log('Voter already voted');
      return res.status(403).json({ message: "Anda sudah menggunakan hak suara!" });
    }

    log('Login successful for voter:', voter.name);
    return res.json({ ID: voter.nim, nama: voter.name });
  } catch (err) {
    log('[API_LOGIN] Caught error in try block');
    log('[API_LOGIN] Error message:', err.message);
    log('[API_LOGIN] Full error:', err);
    return res.status(500).json({ message: "Terjadi kesalahan pada sistem" });
  }
});

app.post('/api/is_there', async (req, res) => {
  const { username } = req.body;

  if (rejectInvalidApiToken(req, res)) return;

  try {
    const voter = await prisma.voter.findUnique({ where: { nim: username } });
    return res.json({ data: voter ? "true" : "false" });
  } catch (err) {
    return res.status(500).json({ message: "Terjadi kesalahan pada sistem" });
  }
});

app.post('/api/is_vote', async (req, res) => {
  const { username } = req.body;

  if (rejectInvalidApiToken(req, res)) return;

  try {
    const voter = await prisma.voter.findUnique({ where: { nim: username } });
    const hasVoted = Boolean(voter && voter.isVoteCakahim && voter.isVoteCasenat);
    return res.json({ data: hasVoted ? "true" : "false" });
  } catch (err) {
    return res.status(500).json({ message: "Terjadi kesalahan pada sistem" });
  }
});

app.post('/api/is_vote_specific', async (req, res) => {
  const { username, category } = req.body;

  if (rejectInvalidApiToken(req, res)) return;

  try {
    const voter = await prisma.voter.findUnique({ where: { nim: username } });

    if (!voter) return res.json({ data: "false" });

    if (category === 'kahim') {
      return res.json({ data: voter.isVoteCakahim ? "true" : "false" });
    }

    if (category === 'senator') {
      return res.json({ data: voter.isVoteCasenat ? "true" : "false" });
    }

    return res.status(400).json({ message: "Kategori tidak dikenal" });
  } catch (err) {
    return res.status(500).json({ message: "Terjadi kesalahan pada sistem" });
  }
});

app.post('/api/vote', async (req, res) => {
  const { username, pilihan, category } = req.body;

  if (rejectInvalidApiToken(req, res)) return;

  try {
    const voter = await prisma.voter.findUnique({ where: { nim: username } });

    if (!voter) {
      return res.status(404).json({ message: "Voter tidak ditemukan" });
    }

    if (category === 'kahim' && voter.isVoteCakahim) {
      return res.status(403).json({ message: "Anda sudah memilih Kahim!" });
    }

    if (category === 'senator' && voter.isVoteCasenat) {
      return res.status(403).json({ message: "Anda sudah memilih Senator!" });
    }

    const now = new Date();
    const updateData = category === 'kahim'
      ? { kahimChoice: pilihan, isVoteCakahim: true }
      : { senatorChoice: pilihan, isVoteCasenat: true };

    await prisma.voter.update({
      where: { nim: username },
      data: {
        ...updateData,
        votedDate: now.toLocaleDateString('id-ID'),
        votedTime: now.toLocaleTimeString('id-ID'),
      }
    });

    return res.json({ message: "Vote Berhasil" });
  } catch (err) {
    return res.status(500).json({ message: "Gagal menyimpan suara" });
  }
});

app.post('/api/save_attendance', async (req, res) => {
  const { username, imageUrl } = req.body;

  if (rejectInvalidApiToken(req, res)) return;

  try {
    await prisma.voter.update({
      where: { nim: username },
      data: { cloudinaryUrl: imageUrl }
    });
    return res.json({ message: "Foto Tersimpan" });
  } catch (err) {
    return res.status(500).json({ message: "Gagal menyimpan foto" });
  }
});

app.get('/api/live_count', async (req, res) => {
  try {
    // Count people who voted on BOTH cakahim and casenator
    const votedBoth = await prisma.voter.count({
      where: {
        AND: [
          { isVoteCakahim: true },
          { isVoteCasenat: true }
        ]
      }
    });

    return res.json({
      votedBoth: votedBoth
    });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengambil live count" });
  }
});

// Final error handler middleware
app.use((err, req, res, next) => {
  log('[FINAL_ERROR_HANDLER]', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  
  if (!res.headersSent) {
    res.status(500).json({ message: "Terjadi kesalahan pada sistem", error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  log(`Backend running on http://localhost:${PORT}`);
  console.log(`Backend running on http://localhost:${PORT}`);
});

// Handle connection pool errors
pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });
});