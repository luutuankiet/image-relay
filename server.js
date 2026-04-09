const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;
const STORE_DIR = '/tmp/image-relay';
const TTL_MS = (process.env.TTL_HOURS || 1) * 3600 * 1000;
const MAX_SIZE = (process.env.MAX_SIZE_MB || 10) * 1024 * 1024;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Ensure store directory exists
fs.mkdirSync(STORE_DIR, { recursive: true });

// In-memory index: key -> {filename, mime, created, size}
const index = new Map();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of index) {
    if (now - entry.created > TTL_MS) {
      try { fs.unlinkSync(path.join(STORE_DIR, key)); } catch {}
      index.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Upload: POST /upload
// Accepts raw binary body with Content-Type header
app.post('/upload', express.raw({ type: '*/*', limit: MAX_SIZE }), (req, res) => {
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'Empty body' });
  }

  const key = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const mime = req.headers['content-type'] || 'application/octet-stream';
  const ext = mime.includes('png') ? '.png' 
            : mime.includes('jpeg') || mime.includes('jpg') ? '.jpg'
            : mime.includes('gif') ? '.gif'
            : mime.includes('webp') ? '.webp'
            : mime.includes('svg') ? '.svg'
            : '';
  const filename = `${key}${ext}`;

  fs.writeFileSync(path.join(STORE_DIR, filename), req.body);
  index.set(filename, { mime, created: Date.now(), size: req.body.length });

  const url = `${BASE_URL}/i/${filename}`;
  console.log(`[upload] ${filename} (${req.body.length} bytes, ${mime}) -> ${url}`);
  res.json({ key, filename, url, size: req.body.length, ttl_seconds: TTL_MS / 1000 });
});

// Download: GET /i/:filename
app.get('/i/:filename', (req, res) => {
  const entry = index.get(req.params.filename);
  if (!entry) return res.status(404).json({ error: 'Not found or expired' });

  const filePath = path.join(STORE_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    index.delete(req.params.filename);
    return res.status(404).json({ error: 'File missing' });
  }

  res.set('Content-Type', entry.mime);
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(filePath);
});

// Health
app.get('/health', (req, res) => {
  res.json({ ok: true, stored: index.size, uptime: process.uptime() | 0 });
});

app.listen(PORT, () => {
  console.log(`[image-relay] listening on :${PORT}`);
  console.log(`[image-relay] base_url=${BASE_URL}, ttl=${TTL_MS/1000}s, max=${MAX_SIZE} bytes`);
});
